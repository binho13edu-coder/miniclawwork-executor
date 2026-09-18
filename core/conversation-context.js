'use strict';

function isIsolatedTask(text) {
  return /^\s*nova tarefa isolada\b/i.test(String(text || ''));
}

class ConversationHistoryStore {
  constructor({ maxMessages = 12 } = {}) {
    this.maxMessages = Math.max(2, maxMessages);
    this.histories = new Map();
    this.warned = new Set();
  }
  _key(key) { return String(key); }
  get(key) { return [...(this.histories.get(this._key(key)) || [])]; }
  count(key) { return this.get(key).length; }
  append(key, userText, assistantText) {
    const k = this._key(key);
    const items = this.get(k);
    items.push(
      { role: 'user', content: String(userText) },
      { role: 'assistant', content: String(assistantText) }
    );
    this.histories.set(k, items.slice(-this.maxMessages));
    return this.get(k);
  }
  clear(key) {
    const k = this._key(key);
    this.histories.delete(k);
    this.warned.delete(k);
  }
  shouldWarn(key, threshold = this.maxMessages) {
    const k = this._key(key);
    if (this.count(k) < threshold || this.warned.has(k)) return false;
    this.warned.add(k);
    return true;
  }
}

module.exports = { ConversationHistoryStore, isIsolatedTask };
