/**
 * tests/llm.test.js — Testes unitários para core/llm.js (V90-NEW-M1)
 * Usa node:test + node:assert (nativo, sem dependências)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { LLMRouter, CircuitBreaker, TokenBucket, enforceOutputContract, requiresMathVerification, classifyTask, buildIndependentReviewPrompt } = require('../core/llm');

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
    test('modelo externo nao vaza para o provider seguinte', () => {
      const router = new LLMRouter({});
      const provider = { models: ['modelo-compativel'] };
      assert.strictEqual(router._resolveModel(provider, 'modelo-invalido'), 'modelo-compativel');
      assert.strictEqual(router._resolveModel(provider, 'modelo-compativel'), 'modelo-compativel');
    });

    test('normaliza contrato parcial sem inventar calculo', () => {
      const prompt = 'NOVA TAREFA ISOLADA — responda em exatamente 3 linhas:\nUm serviço custa R$120 e recebeu desconto de 15%. Qual é o valor final?\nDados:\nCálculo:\nResposta:';
      const raw = 'Cálculo:\nPreço original = R$120\nDesconto = 15% de R$120 = R$18\nValor final = R$120 - R$18 = R$102\n\nResposta: R$102.';
      assert.strictEqual(
        enforceOutputContract(raw, prompt),
        'Dados: Um serviço custa R$120 e recebeu desconto de 15%. Qual é o valor final?\nCálculo: Preço original = R$120 Desconto = 15% de R$120 = R$18 Valor final = R$120 - R$18 = R$102\nResposta: R$102.'
      );
    });

    test('ativa verificador apenas para matematica com contrato estrito', () => {
      assert.strictEqual(requiresMathVerification('responda em exatamente 3 linhas:\nR$120 com 15% de desconto'), true);
      assert.strictEqual(requiresMathVerification('responda em exatamente 3 linhas:\nexplique o produto'), false);
      assert.strictEqual(requiresMathVerification('calcule 15% de R$120'), true);
    });

});


describe('Politica de raciocinio V2', () => {
  test('tarefa isolada bloqueia heranca de contexto', () => {
    const policy = classifyTask('NOVA TAREFA ISOLADA — calcule 15% de R$120');
    assert.strictEqual(policy.isolated, true);
    assert.strictEqual(policy.criticalReasoning, true);
    assert.strictEqual(policy.temperature, 0.1);
  });

  test('maximin e Bayes ativam revisao mesmo sem contrato de linhas', () => {
    assert.strictEqual(requiresMathVerification('Em até 115 palavras: calcule o posterior e decida por maximin.'), true);
  });

  test('revisor recebe o enunciado, nao a resposta primaria', () => {
    const prompt = 'Prior D=20%. Escolha por maximin.';
    const review = buildIndependentReviewPrompt(prompt);
    assert.ok(review.includes(prompt));
    assert.ok(!review.includes('RESPOSTA_PRIMARIA_SECRETA'));
    assert.ok(review.includes('pior payoff bruto por estado'));
  });
});


describe('Revisao Bayes e auditoria', () => {
  test('exige produto das evidencias e custo fixo da auditoria', () => {
    const review = buildIndependentReviewPrompt('Dois sensores + independentes; auditoria custa R$16.');
    assert.ok(review.includes('P(E|H)=P(e|H)^n'));
    assert.ok(review.includes('EV(auditar)=−c+p·ganho_favorável'));
    assert.ok(review.includes('Nunca some likelihoods'));
  });
});

describe('Protecao de resposta vazia', () => {
  test('router rejeita HTTP 200 sem content', async () => {
    const previousFetch = global.fetch;
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '' } }] })
    });
    const router = new LLMRouter({});
    const provider = { name: 'teste', baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_EMPTY_PROVIDER_KEY', models: ['teste-modelo'] };
    try {
      await assert.rejects(
        router._callProvider(provider, [], 'teste-modelo', undefined, 20, 0.1),
        /Resposta vazia: teste/
      );
    } finally {
      global.fetch = previousFetch;
    }
  });
});
