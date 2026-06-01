-- V90-01 — Schema document_chunks para memory_summaries
CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 5,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_importance ON document_chunks(importance);
CREATE INDEX IF NOT EXISTS idx_ts ON document_chunks(ts);
CREATE INDEX IF NOT EXISTS idx_source ON document_chunks(source);
