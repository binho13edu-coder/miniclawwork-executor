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
    apiKeyEnv: 'GROQ_API_KEY', models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    priority: 1, rpmLimit: 30,
  },
  openrouter: {
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY', models: ['mistralai/mistral-7b-instruct', 'deepseek/deepseek-chat'],
    priority: 2, rpmLimit: 60,
  },
  deepseek: {
    name: 'deepseek', baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY', models: ['deepseek-chat'],
    priority: 3, rpmLimit: 60,
  },
  nvidia: {
    name: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY', models: ['meta/llama-3.1-8b-instruct'],
    priority: 4, rpmLimit: 40,
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
    for (const [key, cfg] of Object.entries(PROVIDERS)) {
      this._breakers[key] = new CircuitBreaker();
      this._buckets[key]  = new TokenBucket(cfg.rpmLimit, cfg.rpmLimit / 60);
    }
  }
  _isCooling(providerName) { // V90-NEW-K
    const lastFail = this._cooldowns.get(providerName);
    if (!lastFail) return false;
    return (Date.now() - lastFail) < 600000; // 10 min
  }

  _availableProviders() {
    return Object.values(PROVIDERS).sort((a, b) => a.priority - b.priority).filter(p => {
      if (!process.env[p.apiKeyEnv]) return false;
      if (this._breakers[p.name].isOpen()) return false;
      if (this._isCooling(p.name)) return false; // V90-NEW-K
      return true;
    });
  }
  async _callProvider(provider, messages, model, signal, maxTokens = 2048) {
    const apiKey = process.env[provider.apiKeyEnv];
    const body   = JSON.stringify({ model: model || provider.models[0], messages, max_tokens: maxTokens, stream: false });
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
    return data.choices?.[0]?.message?.content ?? '';
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
          const result = await this._callProvider(provider, messages, opts.model, controller.signal, opts.maxTokens || 2048);
          clearTimeout(timer); breaker.recordSuccess();
          return { content: result, provider: provider.name, model: opts.model || provider.models[0], attempt };
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
                const result = await this._callProvider(provider, compressed, opts.model, controller.signal, 512);
                clearTimeout(timer); breaker.recordSuccess();
                return { content: result, provider: provider.name, model: opts.model || provider.models[0], attempt, compressed: true };
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
  return crypto.createHash('sha256').update(prompt + JSON.stringify(options)).digest('hex');
}

function isCacheable(response) {
  return typeof response === 'string'
    && response.length > 20
    && !response.includes('Nao consegui processar');
}
// ==================================

const router = new LLMRouter();

function getFewShots(prompt, limit = 3) { // V90-NEW-L
  if (!db) return [];
  try {
    const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    if (!words.length) return [];
    const like = words.map(() => 'example_input LIKE ?').join(' OR ');
    const params = words.map(w => '%' + w + '%');
    const rows = db.prepare(`SELECT example_input, example_output FROM few_shots WHERE (${like}) AND score > 0 ORDER BY score DESC, ts DESC LIMIT ?`).all(...params, limit);
    return rows;
  } catch(e) {
    console.warn('[FEW-SHOT] Erro:', e.message);
    return [];
  }
n}

async function ask(prompt, options = {}) {
  try {
    if (db) {
      const hash = cacheHash(prompt, options);
      const cached = db.prepare("SELECT response FROM llm_cache WHERE hash = ?").get(hash);
      if (cached) {
        db.prepare(
          "UPDATE llm_cache SET hits = hits + 1, last_hit = CURRENT_TIMESTAMP WHERE hash = ?"
        ).run(hash);
        return cached.response;
      }
    }

    const messages = [];
    const soulPrompt = getSoulPrompt();
    const personaSnippet = options.persona && PERSONAS[options.persona] ? PERSONAS[options.persona].prompt : ""; // V80-13 + V90-NEW-S
    // V90-NEW-L: injetar few-shots como prefixo do system prompt
    const fewShots = getFewShots(prompt, 3);
    let fewShotText = '';
    if (fewShots.length) {
      fewShotText = fewShots.map((fs, i) => 'Exemplo ' + (i+1) + ':\nEntrada: ' + fs.example_input.slice(0,150) + '\nSaida: ' + fs.example_output.slice(0,150)).join('\n\n') + '\n\n';
    }
    if (soulPrompt) {
      messages.push({ role: 'system', content: (personaSnippet ? personaSnippet + "\n\n" : "") + fewShotText + soulPrompt, _fewShot: !!fewShots.length }); // V80-13 + V90-NEW-L
    }
    messages.push({ role: 'user', content: prompt });
    const result = await router.chat(messages, options);
    const response = result.content;

    if (db && isCacheable(response)) {
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
};
