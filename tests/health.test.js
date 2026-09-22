const test = require('node:test');
const assert = require('node:assert/strict');
const { runHealthCheck } = require('../core/health');

test('health check valida runtime e LLM sem rede', async () => {
  const report = await runHealthCheck({
    root: process.cwd(),
    audit: false,
    llmCheck: async () => 'OK',
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.dependencies, true);
  assert.equal(report.checks.lockfile, true);
  assert.equal(report.llm.response, 'OK');
});

test('health check reprova LLM indisponível', async () => {
  const report = await runHealthCheck({
    root: process.cwd(),
    audit: false,
    llmCheck: async () => { throw new Error('offline'); },
  });
  assert.equal(report.ok, false);
  assert.equal(report.llm.available, false);
});
