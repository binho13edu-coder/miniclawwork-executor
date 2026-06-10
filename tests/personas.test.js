/**
 * tests/personas.test.js — Testes para core/personas.js (V90-NEW-M1)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { PERSONAS } = require('../core/personas');

describe('PERSONAS', () => {
  test('todas as personas têm prompt e preferredModel', () => {
    for (const [key, val] of Object.entries(PERSONAS)) {
      assert.ok(val.prompt, `Persona ${key} sem prompt`);
      assert.ok(val.preferredModel, `Persona ${key} sem preferredModel`);
    }
  });

  test('financial usa deepseek', () => {
    assert.strictEqual(PERSONAS.financial.preferredModel, 'deepseek/deepseek-chat');
  });

  test('leads usa llama-3.3-70b', () => {
    assert.strictEqual(PERSONAS.leads.preferredModel, 'llama-3.3-70b-versatile');
  });
});
