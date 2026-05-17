const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'sqlite');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'backup-sqlite.log');
const DB_DIR = path.join(__dirname, '..', 'data');

const dbs = [
  { name: 'transactions', file: 'finance/transactions.db' },
  { name: 'jobs', file: 'jobs.db' },
  { name: 'documents', file: 'knowledge/documents.db' },
  { name: 'memory', file: 'memory.db' },
];

const KEEP = 7;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function backupOne(cfg) {
  const src = path.join(DB_DIR, cfg.file);
  if (!fs.existsSync(src)) {
    log(`SKIP: ${cfg.name} — nao encontrado`);
    return false;
  }
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
  const dest = path.join(BACKUP_DIR, `${ts}_${cfg.name}.db`);
  try {
    const db = new Database(src);
    db.prepare(`VACUUM INTO ?`).run(dest);
    db.close();
    log(`OK: ${cfg.name} -> ${path.basename(dest)}`);
    return true;
  } catch (err) {
    log(`FAIL: ${cfg.name} — ${err.message}`);
    return false;
  }
}

function rotate(cfg) {
  const suffix = `_${cfg.name}.db`;
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(suffix))
    .map(f => ({ name: f, path: path.join(BACKUP_DIR, f) }))
    .sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs);
  while (files.length > KEEP) {
    const old = files.pop();
    fs.unlinkSync(old.path);
    log(`ROTATE: removido ${old.name}`);
  }
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

let ok = 0, fail = 0;
for (const cfg of dbs) {
  if (backupOne(cfg)) { rotate(cfg); ok++; } else { fail++; }
}

log(`Resumo: ${ok} ok, ${fail} falha(s)`);
process.exit(fail > 0 ? 1 : 0);
