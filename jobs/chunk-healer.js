/**
 * jobs/chunk-healer.js — Auto-Healing Chunks (V90-NEW-Q)
 * Detecta e corrige chunks desatualizados, órfãos e duplicados
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DOCS_DB = path.join(__dirname, '..', 'data', 'documents.db');
const LOG_FILE = path.join(__dirname, '..', 'data', 'healer.log');

const AGE_DAYS = 60;
const IMPORTANCE_THRESHOLD = 5;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

function getDb() {
  if (!fs.existsSync(DOCS_DB)) {
    throw new Error('documents.db não encontrado');
  }
  return new Database(DOCS_DB);
}

function healOrphans() {
  const db = getDb();
  try {
    // Verificar se tabela documents existe
    const hasDocs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get();
    if (!hasDocs) {
      log('Tabela documents não existe, pulando órfãos');
      db.close();
      return 0;
    }

    const orphans = db.prepare(`
      SELECT dc.id, dc.document_id, dc.content 
      FROM document_chunks dc 
      LEFT JOIN documents d ON dc.document_id = d.id 
      WHERE d.id IS NULL
    `).all();

    if (!orphans.length) {
      log('Órfãos: 0 encontrados');
      db.close();
      return 0;
    }

    const ids = orphans.map(o => o.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM document_chunks WHERE id IN (${placeholders})`).run(...ids);
    log(`Órfãos: ${ids.length} deletados`);
    db.close();
    return ids.length;
  } catch(e) {
    log(`ERRO órfãos: ${e.message}`);
    db.close();
    return 0;
  }
}

function healOldChunks() {
  const db = getDb();
  try {
    // Adicionar coluna is_archived se não existir
    const hasArchived = db.prepare("PRAGMA table_info(document_chunks)").all().find(c => c.name === 'is_archived');
    if (!hasArchived) {
      db.prepare('ALTER TABLE document_chunks ADD COLUMN is_archived INTEGER DEFAULT 0').run();
      log('Coluna is_archived adicionada');
    }

    const old = db.prepare(`
      SELECT id, source, content, importance, ts 
      FROM document_chunks 
      WHERE ts < datetime('now', '-${AGE_DAYS} days') 
        AND importance <= ? 
        AND (is_archived IS NULL OR is_archived = 0)
    `).all(IMPORTANCE_THRESHOLD);

    if (!old.length) {
      log('Chunks antigos: 0 para arquivar');
      db.close();
      return 0;
    }

    const ids = old.map(o => o.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE document_chunks SET is_archived = 1 WHERE id IN (${placeholders})`).run(...ids);
    log(`Chunks antigos: ${ids.length} arquivados (>${AGE_DAYS} dias, importance<=${IMPORTANCE_THRESHOLD})`);
    db.close();
    return ids.length;
  } catch(e) {
    log(`ERRO chunks antigos: ${e.message}`);
    db.close();
    return 0;
  }
}

function healDuplicates() {
  const db = getDb();
  try {
    // Encontrar duplicados: mesmo content + source, manter o mais recente
    const dups = db.prepare(`
      SELECT id, source, content, ts,
        ROW_NUMBER() OVER (PARTITION BY source, content ORDER BY ts DESC) as rn
      FROM document_chunks
    `).all();

    const toDelete = dups.filter(d => d.rn > 1);
    if (!toDelete.length) {
      log('Duplicados: 0 encontrados');
      db.close();
      return 0;
    }

    const ids = toDelete.map(d => d.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM document_chunks WHERE id IN (${placeholders})`).run(...ids);
    log(`Duplicados: ${ids.length} deletados (mantido mais recente)`);
    db.close();
    return ids.length;
  } catch(e) {
    log(`ERRO duplicados: ${e.message}`);
    db.close();
    return 0;
  }
}

async function main() {
  log('=== Chunk Healer iniciado ===');
  const orphans = healOrphans();
  const archived = healOldChunks();
  const duplicates = healDuplicates();
  log(`=== Resumo: ${orphans} órfãos, ${archived} arquivados, ${duplicates} duplicados ===`);
  return { orphans, archived, duplicates };
}

if (require.main === module) {
  main().catch(e => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { healOrphans, healOldChunks, healDuplicates, main };
