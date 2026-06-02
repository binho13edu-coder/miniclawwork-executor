const sanitize = require('./sanitize');

function init(db) {
    try {
        const columns = db.prepare("PRAGMA table_info(document_chunks)").all();
        const columnNames = columns.map(col => col.name);

        if (!columnNames.includes('importance')) {
            db.prepare("ALTER TABLE document_chunks ADD COLUMN importance INTEGER DEFAULT 5").run();
        }
        
        if (!columnNames.includes('source')) {
            db.prepare("ALTER TABLE document_chunks ADD COLUMN source TEXT DEFAULT 'llm'").run();
        }

        return true;
    } catch (err) {
        console.error("Error checking or migrating document_chunks schema:", err);
        return false;
    }
}

function saveCorrection(text, db) {
    try {
        const sanitizedText = sanitize.text(text);
        
        const stmt = db.prepare(`
            INSERT INTO document_chunks (document_id, chunk_index, content, importance, source)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const info = stmt.run(null, 0, sanitizedText, 10, 'admin_correction');
        
        return { success: true, id: info.lastInsertRowid };
    } catch (err) {
        console.error("Error saving correction:", err);
        return { success: false, error: err.message };
    }
}

const ensureSchema = init;

module.exports = {
    init,
    saveCorrection,
    ensureSchema
};

// V90-NEW-C — Listar e desfazer correções
const Database = require('better-sqlite3');
const path = require('path');
const DOCS_DB = path.join(__dirname, '..', 'data', 'documents.db');

function listCorrections(limit = 10) {
  const db = new Database(DOCS_DB);
  const rows = db.prepare('SELECT id, substr(content,1,60) as preview, ts FROM corrections ORDER BY ts DESC LIMIT ?').all(limit);
  db.close();
  return rows;
}

function deleteCorrection(id) {
  const db = new Database(DOCS_DB);
  const row = db.prepare('SELECT id, importance FROM corrections WHERE id = ?').get(id);
  if (!row) return { ok: false, error: 'Correção não encontrada' };
  if (row.importance > 10) return { ok: false, error: 'Correção protegida (importance > 10)' };
  db.prepare('DELETE FROM corrections WHERE id = ?').run(id);
  db.close();
  return { ok: true, id };
}

module.exports.listCorrections = listCorrections;
module.exports.deleteCorrection = deleteCorrection;
