/**
 * jobs/goals-heartbeat.js — GOALS.md Heartbeat (V90-NEW-T)
 * Verifica a cada 6h se há goals pendentes com contexto relevante no KB
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Telegraf } = require('telegraf');
const { ask } = require('../core/llm');

const GOALS_PATH = path.join(__dirname, '..', 'GOALS.md');
const KNOWLEDGE_DB = path.join(__dirname, '..', 'data', 'knowledge', 'documents.db');
const CHECK_INTERVAL = 21600000; // 6h
const MAX_ALERTS = 3;

function parseGoals() {
  if (!fs.existsSync(GOALS_PATH)) return [];
  const content = fs.readFileSync(GOALS_PATH, 'utf8');
  const pending = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^- \[ \] (.+)$/);
    if (match) pending.push(match[1].trim());
  }
  return pending;
}

async function checkContext(goal) {
  if (!fs.existsSync(KNOWLEDGE_DB)) return null;
  try {
    const db = new Database(KNOWLEDGE_DB, { readonly: true });
    const words = goal.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 3);
    if (!words.length) { db.close(); return null; }
    const like = words.map(() => 'content LIKE ?').join(' OR ');
    const params = words.map(w => '%' + w + '%');
    const rows = db.prepare(`SELECT document_id, chunk_index, content FROM document_chunks WHERE (${like}) ORDER BY id DESC LIMIT 1`).all(...params);
    db.close();
    return rows.length ? rows[0] : null;
  } catch(e) {
    return null;
  }
}

async function sendAlert(goal, chunk) {
  const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
  const ownerId = parseInt(process.env.OWNER_ID, 10);
  if (isNaN(ownerId)) return;

  const msg = `🎯 [GOALS] Item pendente detectado:\n"${goal}"\n\n📚 Contexto relacionado:\n[Doc ${chunk.document_id}, chunk ${chunk.chunk_index}]: ${chunk.content.slice(0, 200)}...`;
  try {
    await bot.telegram.sendMessage(ownerId, msg);
    console.log(`[GOALS] Alerta enviado: ${goal.slice(0, 50)}`);
  } catch(e) {
    console.error('[GOALS] Erro ao enviar:', e.message);
  }
}

async function run() {
  console.log(`[GOALS] Heartbeat iniciado — ${new Date().toISOString()}`);
  const goals = parseGoals();
  if (!goals.length) {
    console.log('[GOALS] Nenhum item pendente');
    return;
  }

  let alertsSent = 0;
  for (const goal of goals) {
    if (alertsSent >= MAX_ALERTS) break;
    const chunk = await checkContext(goal);
    if (chunk) {
      await sendAlert(goal, chunk);
      alertsSent++;
    }
  }
  console.log(`[GOALS] ${alertsSent} alerta(s) enviado(s) de ${goals.length} pendente(s)`);
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('[GOALS] FATAL:', e.message);
    process.exit(1);
  });
}

module.exports = { run, parseGoals, checkContext };
