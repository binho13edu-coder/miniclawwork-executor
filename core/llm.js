/**
 * core/llm.js — MiniClawwork V6.3
 * Multi-LLM router com Circuit Breaker + Exponential Backoff + Token Bucket
 */

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
  _availableProviders() {
    return Object.values(PROVIDERS).sort((a, b) => a.priority - b.priority).filter(p => {
      if (!process.env[p.apiKeyEnv]) return false;
      if (this._breakers[p.name].isOpen()) return false;
      return true;
    });
  }
  async _callProvider(provider, messages, model, signal) {
    const apiKey = process.env[provider.apiKeyEnv];
    const body   = JSON.stringify({ model: model || provider.models[0], messages, max_tokens: 1024, stream: false });
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
          const result = await this._callProvider(provider, messages, opts.model, controller.signal);
          clearTimeout(timer); breaker.recordSuccess();
          return { content: result, provider: provider.name, model: opts.model || provider.models[0], attempt };
        } catch (err) {
          clearTimeout(timer);
          if (err.name === 'AbortError') err.code = 'TIMEOUT';
          if (err.fatal) { breaker.recordFailure(); lastError = err; break; }
          if (err.code === 'RATE_LIMIT' && err.retryAfterMs && attempt < this.maxRetries) {
            await sleep(err.retryAfterMs); attempt++; continue;
          }
          breaker.recordFailure(); lastError = err; attempt++;
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
    }]));
  }
}

const router = new LLMRouter();
module.exports = { LLMRouter, router, CircuitBreaker, TokenBucket };
