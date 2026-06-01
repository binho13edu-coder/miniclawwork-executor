const Database = require('better-sqlite3');
const path = require('path');
const { ask } = require('../core/llm');
const { logStep } = require('../core/job-steps');

const DOCS_DB = path.join(__dirname, '..', 'data', 'documents.db');

function initDocsDb() {
  const db = new Database(DOCS_DB);
  db.exec(`
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
  `);
  db.close();
}

async function summarizeMemory() {
  const jobId = 'memory-summarizer-' + new Date().toISOString().slice(0,10);
  logStep(jobId, 'inicio', 'ok', 'Job V90-01 iniciado');

  initDocsDb();
  const db = new Database(DOCS_DB);

  try {
    // 1. Buscar chunks antigos de baixa importância
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0,10);

    const oldChunks = db.prepare(
      `SELECT id, source, content, importance, ts FROM document_chunks
       WHERE importance < 5 AND ts < ? ORDER BY ts ASC LIMIT 100`
    ).all(cutoff);

    logStep(jobId, 'busca', 'ok', `Encontrados ${oldChunks.length} chunks antigos (importance < 5, ts < ${cutoff})`);

    if (oldChunks.length === 0) {
      logStep(jobId, 'fim', 'ok', 'Nenhum chunk elegível para compactação');
      db.close();
      return;
    }

    // 2. Agrupar por source (máx 10 por grupo)
    const groups = {};
    for (const chunk of oldChunks) {
      if (!groups[chunk.source]) groups[chunk.source] = [];
      if (groups[chunk.source].length < 10) groups[chunk.source].push(chunk);
    }

    logStep(jobId, 'agrupamento', 'ok', `${Object.keys(groups).length} grupos formados`);

    let totalProcessed = 0;
    let totalDeleted = 0;
    let totalCreated = 0;

    // 3. Compactar cada grupo
    for (const [source, chunks] of Object.entries(groups)) {
      const combined = chunks.map(c => `[${c.ts}] ${c.content}`).join('\n\n');
      const prompt = `Resuma esses registros em um único parágrafo denso e acionável, preservando fatos, valores e datas. Descarte redundâncias.\n\n${combined}`;

      try {
        const summary = await ask(prompt, { maxTokens: 500 });
        const insertStmt = db.prepare(
          `INSERT INTO document_chunks (source, content, importance, ts) VALUES (?, ?, 6, CURRENT_TIMESTAMP)`
        );
        insertStmt.run('memory_summary', summary);
        totalCreated++;

        // 4. Deletar chunks originais
        const ids = chunks.map(c => c.id);
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM document_chunks WHERE id IN (${placeholders})`).run(...ids);
        totalDeleted += ids.length;
        totalProcessed += ids.length;

        logStep(jobId, 'compactacao', 'ok', `Source ${source}: ${ids.length} chunks → 1 resumo`);
      } catch (e) {
        logStep(jobId, 'compactacao', 'erro', `Source ${source}: ${e.message}`);
      }
    }

    logStep(jobId, 'fim', 'ok', `Processados: ${totalProcessed}, Deletados: ${totalDeleted}, Criados: ${totalCreated}`);
    console.log(`[V90-01] memory_summaries: ${totalProcessed} processados, ${totalDeleted} deletados, ${totalCreated} criados`);

  } catch (e) {
    logStep(jobId, 'fim', 'erro', e.message);
    console.error('[V90-01] Erro:', e.message);
  } finally {
    db.close();
  }
}

// Exportar para uso manual ou via cron
module.exports = { summarizeMemory };

// Se executado diretamente, rodar imediatamente
if (require.main === module) {
  summarizeMemory().then(() => process.exit(0)).catch(() => process.exit(1));
}
