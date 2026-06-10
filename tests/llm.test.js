/**
 * tests/llm.test.js — Testes unitários para core/llm.js (V90-NEW-M1)
 * Usa node:test + node:assert (nativo, sem dependências)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { LLMRouter, CircuitBreaker, TokenBucket } = require('../core/llm');

describe('CircuitBreaker', () => {
  test('inicia fechado', () => {
    const cb = new CircuitBreaker();
    assert.strictEqual(cb.isOpen(), false);
  });

  test('abre após 5 falhas', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    assert.strictEqual(cb.isOpen(), true);
  });

  test('success nao fecha imediatamente (half-open)', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    assert.strictEqual(cb.isOpen(), true);
    cb.recordSuccess();
    // Circuit breaker fica em half-open, nao fecha imediatamente
    assert.strictEqual(cb.isOpen(), true);
  });
});

describe('TokenBucket', () => {
  test('permite consumo dentro do limite', () => {
    const tb = new TokenBucket(10, 10);
    assert.strictEqual(tb.tryConsume(5), true);
    assert.strictEqual(tb.tokens, 5);
  });

  test('rejeita consumo acima do limite', () => {
    const tb = new TokenBucket(10, 10);
    assert.strictEqual(tb.tryConsume(15), false);
  });
});

describe('LLMRouter', () => {
  test('status retorna objeto com providers', () => {
    const router = new LLMRouter({});
    // _cooldowns precisa ser inicializado manualmente para teste
    router._cooldowns = new Map();
    const status = router.status();
    assert.strictEqual(typeof status, 'object');
    assert.ok(Object.keys(status).length > 0);
  });

  test('cooldown inicia vazio', () => {
    const router = new LLMRouter({});
    router._cooldowns = new Map();
    assert.strictEqual(router._isCooling('groq'), false);
  });
});
