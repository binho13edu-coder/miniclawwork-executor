/**
 * core/memory.js — MiniClawwork V6.3
 * Memoria persistente com SQLite nativo (better-sqlite3)
 * FIX: timestamps passados explicitamente no INSERT (sem DEFAULT strftime)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH     = process.env.MEMORY_DB_PATH    || path.join(__dirname, '../data/memory.db');
const DEFAULT_TTL = parseInt(process.env.MEMORY_TTL_DAYS   || '90', 10);
const MAX_RECALL  = parseInt(process.env.MEMORY_MAX_RECALL || '20', 10);

function now() { return Math.floor(Date.now() / 1000); }

function initDB() {
  const fs = require('fs');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT    NOT NULL,
      role           TEXT    NOT NULL,
      content        TEXT    NOT NULL,
      embedding_hint TEXT,
      importance     REAL    NOT NULL DEFAULT 0.5,
      created_at     INTEGER NOT NULL,
      accessed_at    INTEGER NOT NULL,
      ttl_days       INTEGER NOT NULL DEFAULT 90,
      is_archived    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS context_threads (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      thread_key TEXT    NOT NULL,
      summary    TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, thread_key)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, is_archived, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_hint ON memories(embedding_hint);
    CREATE INDEX IF NOT EXISTS idx_threads_user  ON context_threads(user_id);
  `);

  return db;
}

class MemoryStore {
  constructor() {
    this._db = initDB();
    this._prepareStatements();
    this._pruneExpired();
    setInterval(() => this._pruneExpired(), 24 * 60 * 60 * 1000).unref();
  }

  _prepareStatements() {
    this._stmts = {
      insert: this._db.prepare(`
        INSERT INTO memories (user_id, role, content, embedding_hint, importance, created_at, accessed_at, ttl_days)
        VALUES (@user_id, @role, @content, @embedding_hint, @importance, @created_at, @accessed_at, @ttl_days)
      `),
      updateAccessed: this._db.prepare(`
        UPDATE memories SET accessed_at = @ts WHERE id = @id
      `),
      recallByUser: this._db.prepare(`
        SELECT id, role, content, importance, created_at FROM memories
        WHERE user_id = @user_id AND is_archived = 0
          AND (created_at + ttl_days * 86400) > @now
        ORDER BY (importance * 0.7 + (accessed_at - created_at) * 0.00001) DESC
        LIMIT @limit
      `),
      recallByKeyword: this._db.prepare(`
        SELECT id, role, content, importance, created_at FROM memories
        WHERE user_id = @user_id AND is_archived = 0
          AND (embedding_hint LIKE @kw OR content LIKE @kw)
          AND (created_at + ttl_days * 86400) > @now
        ORDER BY importance DESC, created_at DESC
        LIMIT @limit
      `),
      upsertThread: this._db.prepare(`
        INSERT INTO context_threads (user_id, thread_key, summary, updated_at)
        VALUES (@user_id, @thread_key, @summary, @updated_at)
        ON CONFLICT(user_id, thread_key) DO UPDATE SET
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `),
      getThread: this._db.prepare(`
        SELECT summary, updated_at FROM context_threads
        WHERE user_id = @user_id AND thread_key = @thread_key
      `),
      listThreads: this._db.prepare(`
        SELECT thread_key, summary, updated_at FROM context_threads
        WHERE user_id = @user_id ORDER BY updated_at DESC
      `),
      archive: this._db.prepare(`UPDATE memories SET is_archived = 1 WHERE id = @id`),
      pruneExpired: this._db.prepare(`
        DELETE FROM memories WHERE is_archived = 0 AND (created_at + ttl_days * 86400) <= @now
      `),
      countByUser: this._db.prepare(`
        SELECT COUNT(*) as cnt FROM memories WHERE user_id = @user_id AND is_archived = 0
      `),
    };
  }

  _extractHint(text) {
    const stop = new Set(['de','a','o','e','que','um','uma','para','com','em','no','na','os','as','dos','das','por','se','ao','ou']);
    return text.toLowerCase()
      .replace(/[^a-z\\u00e0-\\u00fc\\s]/gi, ' ')
      .split(/\\s+/)
      .filter(w => w.length > 3 && !stop.has(w))
      .slice(0, 8)
      .join(' ');
  }

  remember(userId, role, content, opts = {}) {
    const ts = now();
    return this._stmts.insert.run({
      user_id:        String(userId),
      role,
      content,
      embedding_hint: this._extractHint(content),
      importance:     opts.importance ?? 0.5,
      created_at:     ts,
      accessed_at:    ts,
      ttl_days:       opts.ttlDays   ?? DEFAULT_TTL,
    });
  }

  recall(userId, opts = {}) {
    const limit   = opts.limit ?? MAX_RECALL;
    const ts      = now();
    const keyword = opts.keyword;
    let rows;

    if (keyword) {
      const kw = '%' + keyword.toLowerCase() + '%';
      rows = this._stmts.recallByKeyword.all({ user_id: String(userId), kw, now: ts, limit });
    } else {
      rows = this._stmts.recallByUser.all({ user_id: String(userId), now: ts, limit });
    }

    const updateBatch = this._db.transaction((ids) => {
      const ts2 = now();
      for (const id of ids) this._stmts.updateAccessed.run({ id, ts: ts2 });
    });
    updateBatch(rows.map(r => r.id));

    return rows.map(r => ({
      id:         r.id,
      role:       r.role,
      content:    r.content,
      importance: r.importance,
      createdAt:  new Date(r.created_at * 1000).toISOString(),
    }));
  }

  _tokenize(query) {
    const stop = new Set(['de','a','o','e','que','um','uma','para','com','em','no','na','os','as','dos','das','por','se','ao','ou']);
    return query.toLowerCase()
      .replace(/[^a-z\u00e0-\u00fc\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w))
      .slice(0, 6);
  }

  _recencyWeight(createdAt) {
    const age = now() - createdAt;
    if (age <= 7  * 86400) return 1.0;
    if (age <= 30 * 86400) return 0.5;
    if (age <= 90 * 86400) return 0.2;
    return 0;
  }

  recallHybrid(userId, query, opts = {}) {
    const limit  = opts.limit ?? MAX_RECALL;
    const ts     = now();
    const uid    = String(userId);
    const tokens = this._tokenize(query);
    if (!tokens.length) return this.recall(userId, { limit });
    const _fetch = (mode) => {
      const joinOp   = mode === 'AND' ? ' AND ' : ' OR ';
      const hintPart = tokens.map(() => 'embedding_hint LIKE ?').join(joinOp);
      const contPart = tokens.map(() => 'content LIKE ?').join(joinOp);
      const wilds    = tokens.map(t => `%${t}%`);
      const sql = `
        SELECT id, role, content, embedding_hint, importance, created_at
        FROM memories
        WHERE user_id = ? AND is_archived = 0
          AND (created_at + ttl_days * 86400) > ?
          AND ((${hintPart}) OR (${contPart}))
        LIMIT ?
      `;
      return this._db.prepare(sql).all(uid, ts, ...wilds, ...wilds, limit * 3);
    };

    let rows = _fetch('AND');
    if (!rows.length) rows = _fetch('OR');
    if (!rows.length) return this.recall(userId, { limit });

    const scored = rows.map(r => {
      const hint = (r.embedding_hint || '').toLowerCase();
      const body = r.content.toLowerCase();
      let hh = 0, ch = 0;
      for (const t of tokens) {
        if (hint.includes(t)) hh++;
        if (body.includes(t)) ch++;
      }
      return { ...r, _score: hh * 1.5 + ch * 0.7 + r.importance + this._recencyWeight(r.created_at) };
    });

    scored.sort((a, b) => b._score - a._score);
    const top = scored.slice(0, limit);

    const updateBatch = this._db.transaction((ids) => {
      const ts2 = now();
      for (const id of ids) this._stmts.updateAccessed.run({ id, ts: ts2 });
    });
    updateBatch(top.map(r => r.id));

    return top.map(r => ({
      id:        r.id,
      role:      r.role,
      content:   r.content,
      importance: r.importance,
      score:     parseFloat(r._score.toFixed(3)),
      createdAt: new Date(r.created_at * 1000).toISOString(),
    }));
  }

  recallAsMessages(userId, opts = {}) {
    return this.recall(userId, opts).map(m => ({ role: m.role, content: m.content }));
  }

  saveThread(userId, threadKey, summary) {
    return this._stmts.upsertThread.run({
      user_id: String(userId),
      thread_key: threadKey,
      summary,
      updated_at: now()
    });
  }

  getThread(userId, threadKey) {
    return this._stmts.getThread.get({ user_id: String(userId), thread_key: threadKey });
  }

  listThreads(userId) {
    return this._stmts.listThreads.all({ user_id: String(userId) });
  }

  archive(memoryId) {
    return this._stmts.archive.run({ id: memoryId });
  }

  stats(userId) {
    const { cnt } = this._stmts.countByUser.get({ user_id: String(userId) });
    return { userId, activeMemories: cnt, dbPath: DB_PATH };
  }

  _pruneExpired() {
    const result = this._stmts.pruneExpired.run({ now: now() });
    if (result.changes > 0) console.log('[Memory] Pruned ' + result.changes + ' expired memories');
    return result.changes;
  }

  close() { this._db.close(); }
}

const memory = new MemoryStore();

process.on('SIGINT',  () => { memory.close(); process.exit(0); });
process.on('SIGTERM', () => { memory.close(); process.exit(0); });

module.exports = { MemoryStore, memory };
