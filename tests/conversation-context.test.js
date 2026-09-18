'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ConversationHistoryStore, isIsolatedTask } = require('../core/conversation-context');

describe('ConversationHistoryStore', () => {
  test('separa chats e limita mensagens', () => {
    const store = new ConversationHistoryStore({ maxMessages: 4 });
    store.append('a', 'u1', 'a1');
    store.append('b', 'u2', 'a2');
    store.append('a', 'u3', 'a3');
    store.append('a', 'u4', 'a4');
    assert.strictEqual(store.count('a'), 4);
    assert.strictEqual(store.count('b'), 2);
    assert.strictEqual(store.get('a')[0].content, 'u3');
  });
  test('aviso ocorre uma vez e limpeza o reinicia', () => {
    const store = new ConversationHistoryStore({ maxMessages: 2 });
    store.append('a', 'u', 'a');
    assert.strictEqual(store.shouldWarn('a'), true);
    assert.strictEqual(store.shouldWarn('a'), false);
    store.clear('a');
    assert.strictEqual(store.count('a'), 0);
  });
  test('reconhece tarefa isolada', () => {
    assert.strictEqual(isIsolatedTask('NOVA TAREFA ISOLADA — resolva'), true);
    assert.strictEqual(isIsolatedTask('tarefa comum'), false);
  });
});
