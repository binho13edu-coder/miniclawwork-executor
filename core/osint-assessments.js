const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'osint_assessments.db');

function openDatabase(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS osint_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      authorized_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      headers_json TEXT NOT NULL,
      dns_summary_json TEXT NOT NULL,
      tech_json TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      report TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_osint_assessments_domain_created
      ON osint_assessments(domain, created_at DESC);
  `);
  return db;
}

function saveAssessment(data, dbPath = DEFAULT_DB_PATH) {
  if (!data || !/^[a-z0-9.-]+$/i.test(data.domain || '')) {
    throw new Error('Domínio inválido para auditoria.');
  }

  const db = openDatabase(dbPath);
  try {
    const result = db.prepare(`
      INSERT INTO osint_assessments (
        owner_id, domain, authorized_at, headers_json, dns_summary_json,
        tech_json, findings_json, report
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(data.ownerId),
      data.domain.toLowerCase(),
      data.authorizedAt,
      JSON.stringify(data.headers || {}),
      JSON.stringify(data.dnsSummary || {}),
      JSON.stringify(data.tech || {}),
      JSON.stringify(data.findings || []),
      String(data.report || '')
    );
    return { id: result.lastInsertRowid };
  } finally {
    db.close();
  }
}

function getLatestAssessment(domain, dbPath = DEFAULT_DB_PATH) {
  const db = openDatabase(dbPath);
  try {
    return db.prepare(`
      SELECT id, owner_id, domain, authorized_at, created_at,
             headers_json, dns_summary_json, tech_json, findings_json, report
      FROM osint_assessments
      WHERE domain = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(String(domain).toLowerCase()) || null;
  } finally {
    db.close();
  }
}


function getRecentAssessments(domain, limit = 2, dbPath = DEFAULT_DB_PATH) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 2, 10));
  const db = openDatabase(dbPath);
  try {
    return db.prepare(`
      SELECT id, owner_id, domain, authorized_at, created_at,
             headers_json, dns_summary_json, tech_json, findings_json, report
      FROM osint_assessments
      WHERE domain = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(String(domain).toLowerCase(), safeLimit);
  } finally {
    db.close();
  }
}

module.exports = { saveAssessment, getLatestAssessment, getRecentAssessments };
