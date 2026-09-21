const { PERSONAS } = require("./personas"); // V80-13
/**
 * core/llm.js — MiniClawwork V8.0 (V80-03)
 * Multi-LLM router com Circuit Breaker + Exponential Backoff + Token Bucket + Cache SQLite
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const PROVIDERS = {
  groq: {
    name: 'groq', baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY', models: ['openai/gpt-oss-120b', 'groq/compound'],
    priority: 1, rpmLimit: 30,
  },
  openrouter: {
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY', models: ['meta-llama/llama-3.1-8b-instruct'],
    priority: 2, rpmLimit: 60,
  },
  deepseek: {
    name: 'deepseek', baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY', models: ['deepseek-chat'],
    priority: 3, rpmLimit: 60,
  },
  nvidia: {
    name: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY', models: ['nvidia/llama-3.1-nemotron-70b-instruct'],
    priority: 4, rpmLimit: 40, enabled: false,
  },
};

class CircuitBreaker {
  constructor(opts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.successThreshold = opts.successThreshold ?? 2;
    this.openTimeout      = opts.openTimeout      ?? 30000;
    this.halfOpenMaxCalls = opts.halfOpenMaxCalls  ?? 2;
    this._state = 'CLOSED'; this._failures = 0; this._successes = 0;
    this._openedAt = null;  this._halfOpenUsed = 0;
  }
  get state() { return this._state; }
  isOpen() {
    if (this._state === 'OPEN') {
      if (Date.now() - this._openedAt >= this.openTimeout) {
        this._state = 'HALF_OPEN'; this._halfOpenUsed = 0; this._successes = 0;
        return false;
      }
      return true;
    }
    if (this._state === 'HALF_OPEN') return this._halfOpenUsed >= this.halfOpenMaxCalls;
    return false;
  }
  recordSuccess() {
    this._failures = 0;
    if (this._state === 'HALF_OPEN') {
      this._successes++;
      if (this._successes >= this.successThreshold) { this._state = 'CLOSED'; this._halfOpenUsed = 0; }
    }
  }
  recordFailure() {
    this._failures++;
    if (this._state === 'HALF_OPEN') { this._state = 'OPEN'; this._openedAt = Date.now(); return; }
    if (this._failures >= this.failureThreshold) { this._state = 'OPEN'; this._openedAt = Date.now(); }
  }
  toJSON() { return { state: this._state, failures: this._failures, successes: this._successes, openedAt: this._openedAt }; }
}

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    this.capacity = capacity; this.tokens = capacity;
    this.refillRate = refillPerSecond; this.lastRefill = Date.now();
  }
  _refill() {
    const now = Date.now(); const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
  tryConsume(cost = 1) { this._refill(); if (this.tokens >= cost) { this.tokens -= cost; return true; } return false; }
  waitMs(cost = 1) { this._refill(); if (this.tokens >= cost) return 0; return ((cost - this.tokens) / this.refillRate) * 1000; }
}

function calcBackoff(attempt, baseMs = 500, maxMs = 16000, jitter = true) {
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return Math.floor(exp + (jitter ? Math.random() * 0.3 * exp : 0));
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class LLMRouter {
  constructor(opts = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs  = opts.timeoutMs  ?? 25000;
    this._breakers  = {};
    this._buckets   = {};
 this._lastErrors = {};
    for (const [key, cfg] of Object.entries(PROVIDERS)) {
      this._breakers[key] = new CircuitBreaker();
      this._buckets[key]  = new TokenBucket(cfg.rpmLimit, cfg.rpmLimit / 60);
    }
  }
  _resolveModel(provider, requestedModel) {
    return requestedModel && provider.models.includes(requestedModel)
      ? requestedModel
      : provider.models[0];
  }

  _isCooling(providerName) { // V90-NEW-K
    if (!this._cooldowns) this._cooldowns = new Map();
    const lastFail = this._cooldowns.get(providerName);
    if (!lastFail) return false;
    return (Date.now() - lastFail) < 600000; // 10 min
  }

  _availableProviders() {
    return Object.values(PROVIDERS).sort((a, b) => a.priority - b.priority).filter(p => {
      if (p.enabled === false) return false;
      if (!process.env[p.apiKeyEnv]) return false;
      if (this._breakers[p.name].isOpen()) return false;
      if (this._isCooling(p.name)) return false; // V90-NEW-K
      return true;
    });
  }
  async _callProvider(provider, messages, model, signal, maxTokens = 2048, temperature) {
    const apiKey = process.env[provider.apiKeyEnv];
    const payload = { model: model || provider.models[0], messages, max_tokens: maxTokens, stream: false };
    if (typeof temperature === 'number') payload.temperature = temperature;
    const body = JSON.stringify(payload);
    const res    = await fetch(`${provider.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body, signal,
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      const err = new Error(`Rate limit: ${provider.name}`);
      err.code = 'RATE_LIMIT'; err.retryAfterMs = retryAfter * 1000; throw err;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => String(res.status));
      const err  = new Error(`HTTP ${res.status}: ${provider.name} — ${text}`);
      err.code   = 'HTTP_ERROR'; err.status = res.status;
      if (res.status >= 400 && res.status < 500) err.fatal = true;
      throw err;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        const err = new Error(`Resposta vazia: ${provider.name}`);
        err.code = 'EMPTY_RESPONSE';
        err.fatal = true;
        err.finishReason = data.choices?.[0]?.finish_reason;
        throw err;
      }
      return content;
  }
  _compressPrompt(messages) { // V90-NEW-P
    // Truncar system prompt para 500 chars, remover few-shots, manter user
    return messages.map(m => {
      if (m.role === 'system') {
        return { ...m, content: m.content.slice(0, 500) + (m.content.length > 500 ? '... [truncado]' : '') };
      }
      return m;
    }).filter(m => !(m.role === 'system' && m._fewShot));
  }

  async chat(messages, opts = {}) {
    const providers = this._availableProviders();
    if (providers.length === 0) throw new Error('[LLMRouter] Nenhum provider disponível.');
    let lastError;
    for (const provider of providers) {
      const bucket = this._buckets[provider.name]; const breaker = this._breakers[provider.name];
      const waitMs = bucket.waitMs(1);
      if (waitMs > 3000) continue;
      if (waitMs > 0) await sleep(waitMs);
      let attempt = 0;
      while (attempt <= this.maxRetries) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          bucket.tryConsume(1);
          const selectedModel = this._resolveModel(provider, opts.model);
          const result = await this._callProvider(provider, messages, selectedModel, controller.signal, opts.maxTokens || 2048, opts.temperature);
          clearTimeout(timer); breaker.recordSuccess();
      delete this._lastErrors[provider.name];
          const responseMeta = { content: result, provider: provider.name, model: selectedModel, attempt };
// V90-NEW-V: registrar provider usado
try { const metrics = require('./metrics'); metrics.track(`llm_provider:${provider.name}`, attempt); } catch(e) {}
return responseMeta;
        } catch (err) {
          clearTimeout(timer);
          const e = err.name === 'AbortError'
    ? Object.assign(new Error(err.message || 'Timeout'), { code: 'TIMEOUT' })
    : err;
          if (e.fatal) { breaker.recordFailure(); lastError = e; break; }
          // V90-NEW-P: Self-Correction 429 -> prompt comprimido
          if (e.code === 'RATE_LIMIT') {
            if (attempt === 0 && !opts._compressed) {
              console.warn(`[LLMRouter] 429 -> tentando com prompt comprimido...`);
              const compressed = this._compressPrompt(messages);
              try {
                bucket.tryConsume(1);
                const selectedModel = this._resolveModel(provider, opts.model);
                const result = await this._callProvider(provider, compressed, selectedModel, controller.signal, 512, opts.temperature);
                clearTimeout(timer); breaker.recordSuccess();
      delete this._lastErrors[provider.name];
                return { content: result, provider: provider.name, model: selectedModel, attempt, compressed: true };
              } catch (err2) {
                clearTimeout(timer);
                console.warn(`[LLMRouter] 429 compressao falhou -> cooldown`);
              }
            }
            if (e.retryAfterMs && attempt < this.maxRetries) {
              await sleep(err.retryAfterMs); attempt++; continue;
            }
          }
          breaker.recordFailure(); lastError = e; attempt++;
          if (attempt <= this.maxRetries) await sleep(calcBackoff(attempt));
        }
      }
      if (breaker.state === 'OPEN') console.warn(`[LLMRouter] Circuit OPEN: ${provider.name} — fallback ao proximo`);
    }
    const error = new Error(`[LLMRouter] Todos os providers falharam. Ultimo erro: ${lastError?.message}`);
    error.breakers = Object.fromEntries(Object.entries(this._breakers).map(([k, v]) => [k, v.toJSON()]));
    throw error;
  }
  status() {
    return Object.fromEntries(Object.entries(this._breakers).map(([name, b]) => [name, {
      circuitBreaker: b.toJSON(),
      rateLimitTokens: Math.floor(this._buckets[name].tokens),
      apiKeySet: !!process.env[PROVIDERS[name].apiKeyEnv],
      cooldownMs: this._isCooling(name) ? 600000 - (Date.now() - this._cooldowns.get(name)) : 0,
      lastError: this._lastErrors[name] || null,
    }]));
  }
}

// === SOUL.md injection (V80-NEW-G) ===
let soulPromptCache = null;

function getSoulPrompt() {
  if (soulPromptCache !== null) return soulPromptCache;
  try {
    const soulPath = path.join(__dirname, '..', 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      soulPromptCache = fs.readFileSync(soulPath, 'utf8');
    } else {
      console.warn('[SOUL] SOUL.md not found. Continuing without injection.');
      soulPromptCache = '';
    }
  } catch (error) {
    console.warn('[SOUL] Error reading SOUL.md:', error.message);
    soulPromptCache = '';
  }
  return soulPromptCache;
}

try { getSoulPrompt(); } catch (e) { console.warn('[SOUL] Boot cache failed:', e.message); }
// =====================================

// === LLM Cache SQLite (V80-03) ===
const dbPath = path.join(__dirname, '..', 'data', 'llm_cache.db');
let db = null;

function initCache() {
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        hash TEXT PRIMARY KEY,
        prompt TEXT,
        response TEXT,
        hits INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_hit DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const deleted = db.prepare(
      "DELETE FROM llm_cache WHERE last_hit < datetime('now', '-24 hours')"
    ).run();
    if (deleted.changes > 0) {
      console.log(`[CACHE] TTL cleanup: ${deleted.changes} entrada(s) expirada(s) removida(s)`);
    }
    console.log('[CACHE] llm_cache.db inicializado. WAL mode ativo.');
  } catch (e) {
    console.warn('[CACHE] Falha ao inicializar cache:', e.message);
    db = null;
  }
}

function getCacheStats() {
  if (!db) return { total_entries: 0, total_hits: 0, hit_rate: '0.00%' };

  try {
    const entriesRow = db.prepare("SELECT COUNT(*) AS count FROM llm_cache").get();
    const hitsRow = db.prepare("SELECT SUM(hits) AS total FROM llm_cache").get();

    const total_entries = entriesRow ? entriesRow.count : 0;
    const total_sum_hits = (hitsRow && hitsRow.total) ? hitsRow.total : 0;

    const actual_hits = Math.max(0, total_sum_hits - total_entries);
    const hit_rate = total_sum_hits > 0
      ? ((actual_hits / total_sum_hits) * 100).toFixed(2) + '%'
      : '0.00%';

    return { total_entries, total_hits: actual_hits, hit_rate };
  } catch (e) {
    console.warn('[CACHE] Erro ao obter stats:', e.message);
    return { total_entries: 0, total_hits: 0, hit_rate: '0.00%' };
  }
}

function cacheHash(prompt, options) {
  return crypto.createHash('sha256')
    .update(prompt + JSON.stringify(options) + getSoulPrompt() + '|reasoning-policy-v2')
    .digest('hex');
}

function classifyTask(prompt) {
  const text = String(prompt || '');
  const lower = text.toLowerCase();
  const isolated = /^\s*nova tarefa isolada\b/i.test(text);
  const strictOutput = /\b(exatamente|em até|no máximo|no maximo)\s+\d+\s+(linhas?|palavras?|itens?)/i.test(text);
  const reasoningSignals = /\b(bayes|posterior|prior|fréchet|frechet|maximin|minimax|valor esperado|probabilidade|independência|independencia|correlaç|correlac|restriç|restric|otimiza|payoff|decisão robusta|decisao robusta)\b|%|r\$/i;
  const criticalReasoning = reasoningSignals.test(lower);

  return {
    isolated,
    strictOutput,
    criticalReasoning,
    temperature: criticalReasoning ? 0.1 : 0.4,
  };
}

function buildIndependentReviewPrompt(prompt) {
  return prompt + `

PROTOCOLO DE REVISÃO INDEPENDENTE:
Resolva exclusivamente o enunciado acima, do zero. Não houve resposta anterior para confirmar. Identifique dados, restrições e objetivo antes do cálculo.
Para n evidências/sensores condicionalmente independentes com o mesmo resultado, use a verossimilhança conjunta P(E|H)=P(e|H)^n (ou o produto de cada evidência); calcule P(H,E)=P(H)·P(E|H) e normalize Bayes pelo total de todas as hipóteses. Nunca some likelihoods como se já fossem posterior.
Para uma auditoria de custo fixo c que revela o estado e executa apenas no estado favorável, use EV(auditar)=−c+p·ganho_favorável: o custo ocorre em todos os estados, e o prejuízo da execução no estado desfavorável não ocorre. Não use c·p.
Em incerteza posterior, calcule o valor esperado de cada ação como função da posterior e compare o mínimo dentro do intervalo permitido; não substitua isso pelo pior payoff bruto por estado.
Antes de finalizar, faça uma segunda checagem explícita: mostre na resposta uma fórmula ou substituição numérica independente e seu resultado; nunca escreva apenas 'confere' ou 'verificação confirma'. Não assuma independência, correlação, dados externos ou premissas não fornecidas.
Entregue somente a resposta final no formato, limite e idioma exigidos pelo enunciado; se houver número exato de linhas, emita exatamente esse número.`;
}
function enforceOutputContract(response, prompt) {
  const match = String(prompt || '').match(/\bexatamente\s+(\d+)\s+linhas?\b/i);
  if (!match || typeof response !== 'string') return response;

  const count = Number(match[1]);
  const promptLines = String(prompt).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labels = promptLines.filter(line => /^[^:]{1,40}:$/.test(line)).slice(-count);
  if (count < 1 || labels.length !== count) return response;

  const lines = response.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const lower = value => value.toLowerCase();
  const starts = labels.map(label => lines.findIndex(line => lower(line).startsWith(lower(label))));
  if (starts.every(index => index < 0)) return response;

  const question = promptLines.slice(1)
    .filter(line => !labels.some(label => lower(line) === lower(label)))
    .join(' ')
    .trim();

  return labels.map((label, index) => {
    const startAt = starts[index];
    const nextAt = starts.slice(index + 1).find(position => position >= 0);
    let body = '';

    if (startAt < 0) {
      body = index === 0 ? question : '';
    } else {
      body = lines.slice(startAt, nextAt ?? lines.length)
        .map((line, lineIndex) => {
          if (lineIndex === 0 && lower(line).startsWith(lower(label))) line = line.slice(label.length);
          return line.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '').trim();
        })
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return body ? `${label} ${body}` : label;
  }).join('\n');
}

function requiresMathVerification(prompt) {
  return classifyTask(prompt).criticalReasoning;
}

function isCacheable(response) {
  return typeof response === 'string'
    && response.length > 20
    && !response.includes('Nao consegui processar');
}

// Few-shots ficam suspensos até existir tabela, curadoria e testes próprios.
function getFewShots() {
  return [];
}

const router = new LLMRouter();

function buildBaseMessages(soulPrompt, personaSnippet) {
  const systemParts = [soulPrompt, personaSnippet].filter(Boolean);
  return systemParts.length
    ? [{ role: 'system', content: systemParts.join('\n\n') }]
    : [];
}

async function ask(prompt, options = {}) {
  try {
    const profile = classifyTask(prompt);

    // Política v2: não reutiliza cache em tarefas isoladas ou de raciocínio crítico.
    // Respostas antigas v1 ficam automaticamente invalidadas pela nova hash.
    const allowCache = false;
    if (allowCache && db) {
      const hash = cacheHash(prompt, options);
      const cached = db.prepare("SELECT response FROM llm_cache WHERE hash = ?").get(hash);
      if (cached) {
        db.prepare(
          "UPDATE llm_cache SET hits = hits + 1, last_hit = CURRENT_TIMESTAMP WHERE hash = ?"
        ).run(hash);
        return enforceOutputContract(cached.response, prompt);
      }
    }

    const soulPrompt = getSoulPrompt();
    const personaSnippet = typeof options.persona === 'string'
      ? (PERSONAS[options.persona]?.prompt || options.persona)
      : '';

    const maxHistoryTurns = Math.max(1, options.maxHistoryTurns ?? 3);
    const history = profile.isolated
      ? []
      : (Array.isArray(options.history)
        ? options.history.slice(-(maxHistoryTurns * 2)).filter(m =>
            m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
        : []);

    const requestOptions = {
      ...options,
      temperature: typeof options.temperature === 'number'
        ? options.temperature
        : profile.temperature,
      maxTokens: Math.max(options.maxTokens || 0, profile.criticalReasoning ? 4096 : 0),
    };

    const messages = buildBaseMessages(soulPrompt, personaSnippet);
    messages.push(...history);
    if (!history.some(m => m.role === 'user' && m.content === prompt)) {
      messages.push({ role: 'user', content: prompt });
    }

    const primary = await router.chat(messages, requestOptions);
    let response = primary.content;
    let independentlyReviewed = false;

    if (profile.criticalReasoning) {
      const reviewMessages = buildBaseMessages(soulPrompt, personaSnippet);
      reviewMessages.push({ role: 'user', content: buildIndependentReviewPrompt(prompt) });

      try {
        const reviewed = await router.chat(reviewMessages, requestOptions);
        response = reviewed.content;
        independentlyReviewed = true;
      } catch (reviewError) {
        console.warn('[LLM REVIEW] indisponivel; entregando resposta primaria:', reviewError.message);
      }
    }

    response = enforceOutputContract(response, prompt);

    // Fase 1: cache apenas é permitido para respostas revisadas e não isoladas.
    if (db && independentlyReviewed && !profile.isolated && isCacheable(response)) {
      const hash = cacheHash(prompt, options);
      db.prepare(`
        INSERT INTO llm_cache (hash, prompt, response)
        VALUES (?, ?, ?)
        ON CONFLICT(hash) DO UPDATE SET
          response = excluded.response,
          hits = excluded.hits + 1,
          last_hit = CURRENT_TIMESTAMP
      `).run(hash, prompt, response);
    }

    return response;
  } catch (e) {
    console.error('[ASK ERROR]', e.message, e.breakers || '');
    return "Nao consegui processar agora. Tente em instantes.";
  }
}

module.exports = {
  LLMRouter,
  router,
  CircuitBreaker,
  TokenBucket,
  ask,
  getSoulPrompt,
  initCache,
  getCacheStats,
  enforceOutputContract,
  requiresMathVerification,
  classifyTask,
  buildIndependentReviewPrompt,
};
