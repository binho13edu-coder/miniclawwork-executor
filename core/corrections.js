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
