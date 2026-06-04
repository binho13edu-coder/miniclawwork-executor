/**
 * jobs/memory-trimmer.js — Trimmer TLDR (V90-NEW-A)
 * Comprime chunks antigos de baixa importância via LLM antes de deletar
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DOCS_DB = path.join(__dirname, '..', 'data', 'documents.db');
const MEMORY_DB = path.join(__dirname, '..', 'data', 'memory.db');
const LOG_FILE = path.join(__dirname, '..', 'data', 'trimmer.log');

// Thresholds
const IMPORTANCE_THRESHOLD = 5;      // Só comprime chunks com importance < 5
const AGE_DAYS = 30;                  // Só comprime chunks com mais de 30 dias
const MIN_CHARS_FOR_TLDR = 200;       // Só comprime se o chunk tiver > 200 chars
const MAX_TLDR_LENGTH = 300;        // TLDR máximo de 300 chars

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

function now() { return Math.floor(Date.now() / 1000); }

function daysAgo(days) {
  return now() - (days * 24 * 60 * 60);
}

async function trimDocuments() {
  if (!fs.existsSync(DOCS_DB)) {
    log('documents.db não encontrado, pulando');
    return { compressed: 0, deleted: 0 };
  }

  const db = new Database(DOCS_DB);
  
  // Verificar se tabela existe
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_chunks'").get();
  if (!tables) {
    log('Tabela document_chunks não existe, pulando');
    db.close();
    return { compressed: 0, deleted: 0 };
  }

  // Buscar chunks candidatos: baixa importância, antigos, grandes
  const candidates = db.prepare(`
    SELECT id, source, content, importance, ts 
    FROM document_chunks 
    WHERE importance <= ? 
      AND ts < datetime('now', '-${AGE_DAYS} days')
      AND LENGTH(content) > ?
    ORDER BY ts ASC
  `).all(IMPORTANCE_THRESHOLD, MIN_CHARS_FOR_TLDR);

  log(`Candidatos encontrados: ${candidates.length}`);

  if (candidates.length === 0) {
    db.close();
    return { compressed: 0, deleted: 0 };
  }

  let compressed = 0;
  let deleted = 0;

  // Agrupar por source para gerar TLDRs coerentes
  const bySource = {};
  candidates.forEach(c => {
    if (!bySource[c.source]) bySource[c.source] = [];
    bySource[c.source].push(c);
  });

  for (const [source, chunks] of Object.entries(bySource)) {
    log(`Processando source: ${source} (${chunks.length} chunks)`);

    // Combinar conteúdo dos chunks
    const combined = chunks.map(c => c.content).join('\n\n---\n\n');
    
    // Gerar TLDR via LLM (se disponível) ou heurística simples
    let tldr;
    try {
      // Tentar usar LLM do MiniClawwork
      const { ask } = require('../core/llm');
      const prompt = `Resuma o seguinte conteúdo em 2-3 frases curtas, mantendo apenas o conhecimento essencial:\n\n${combined.slice(0, 2000)}`;
      tldr = await ask(prompt, { persona: 'system', maxTokens: 150, temperature: 0.3 });
      if (!tldr || tldr.length > MAX_TLDR_LENGTH) {
        // Fallback: primeiras e últimas frases
        const sentences = combined.split(/[.!?]+/).filter(s => s.trim().length > 20);
        tldr = sentences.slice(0, 2).join('. ') + '.';
      }
    } catch(e) {
      // Fallback sem LLM: primeiras frases
      const sentences = combined.split(/[.!?]+/).filter(s => s.trim().length > 20);
      tldr = '[TLDR] ' + sentences.slice(0, 2).join('. ') + '.';
      log(`LLM indisponível, usando fallback para ${source}`);
    }

    // Inserir TLDR como novo chunk
    try {
      db.prepare(`
        INSERT INTO document_chunks (source, content, importance, ts, para_category) 
        VALUES (?, ?, ?, datetime('now'), ?)
      `).run(
        source + '_tldr',
        tldr,
        Math.min(IMPORTANCE_THRESHOLD + 1, 7), // Aumenta importância do TLDR
        'compressed'
      );
      compressed++;

      // Deletar chunks originais
      const ids = chunks.map(c => c.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM document_chunks WHERE id IN (${placeholders})`).run(...ids);
      deleted += ids.length;

      log(`Source ${source}: ${ids.length} chunks → 1 TLDR (${tldr.length} chars)`);
    } catch(e) {
      log(`ERRO ao processar ${source}: ${e.message}`);
    }
  }

  db.close();
  log(`Resumo: ${compressed} TLDRs criados, ${deleted} chunks removidos`);
  return { compressed, deleted };
}

async function trimMemory() {
  if (!fs.existsSync(MEMORY_DB)) {
    log('memory.db não encontrado, pulando');
    return { compressed: 0, deleted: 0 };
  }

  const db = new Database(MEMORY_DB);
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get();
  if (!tables) {
    log('Tabela memories não existe, pulando');
    db.close();
    return { compressed: 0, deleted: 0 };
  }

  // Buscar memórias antigas de baixa importância
  const candidates = db.prepare(`
    SELECT id, content, created_at 
    FROM memories 
    WHERE created_at < datetime('now', '-${AGE_DAYS} days')
    ORDER BY created_at ASC
    LIMIT 50
  `).all();

  log(`Memórias candidatas: ${candidates.length}`);

  // Para memórias, simplesmente deletar as muito antigas (sem TLDR por enquanto)
  let deleted = 0;
  if (candidates.length > 20) {
    const toDelete = candidates.slice(0, candidates.length - 20); // Manter últimas 20
    const ids = toDelete.map(c => c.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);
    deleted = ids.length;
    log(`${deleted} memórias antigas removidas (mantidas últimas 20)`);
  }

  db.close();
  return { compressed: 0, deleted };
}

async function main() {
  log('=== Trimmer TLDR iniciado ===');
  
  const docsResult = await trimDocuments();
  const memResult = await trimMemory();
  
  log(`=== Finalizado ===`);
  log(`Docs: ${docsResult.compressed} comprimidos, ${docsResult.deleted} deletados`);
  log(`Memórias: ${memResult.deleted} deletadas`);
}

// Se executado diretamente
if (require.main === module) {
  main().catch(e => {
    log(`FATAL: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { trimDocuments, trimMemory, main };
