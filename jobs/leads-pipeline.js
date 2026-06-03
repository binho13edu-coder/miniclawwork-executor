/**
 * jobs/leads-pipeline.js — V90-NEW-B
 * Verifica leads com follow-up vencido e envia alerta
 * Roda: segunda 7h BRT (cron no ecosystem.config.js)
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');
const { Telegraf } = require('telegraf');

const LEADS_DB = path.join(__dirname, '..', 'data', 'leads.db');
const OWNER_ID = process.env.OWNER_ID;

function getOverdueLeads() {
  const db = new sqlite3(LEADS_DB);
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, nome, empresa, resultado, followup_ts
    FROM leads
    WHERE followup_ts IS NOT NULL
      AND followup_ts < ?
      AND resultado NOT IN ('fechado', 'perdido')
    ORDER BY followup_ts ASC
  `).all(now);
  db.close();
  return rows;
}

function getPipelineSummary() {
  const db = new sqlite3(LEADS_DB);
  const rows = db.prepare(`
    SELECT resultado, COUNT(*) as cnt
    FROM leads
    GROUP BY resultado
    ORDER BY cnt DESC
  `).all();
  db.close();
  return rows;
}

async function sendAlert(bot) {
  const overdue = getOverdueLeads();
  if (!overdue.length) {
    console.log('[leads-pipeline] Nenhum follow-up vencido.');
    return;
  }

  let msg = '⚠️ *Leads aguardando follow-up:*\n\n';
  overdue.forEach(l => {
    msg += `• #${l.id} *${l.nome}* (${l.empresa || 'N/A'})\n`;
    msg += `  Status: ${l.resultado} | Follow-up: ${l.followup_ts.slice(0,10)}\n\n`;
  });
  msg += `Total: ${overdue.length} lead(s) vencido(s).`;

  try {
    await bot.telegram.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' });
    console.log(`[leads-pipeline] Alerta enviado: ${overdue.length} leads`);
  } catch (e) {
    console.error('[leads-pipeline] Erro ao enviar:', e.message);
  }
}

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !OWNER_ID) {
    console.error('[leads-pipeline] TELEGRAM_BOT_TOKEN ou OWNER_ID não configurados');
    process.exit(1);
  }

  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  await sendAlert(bot);
  process.exit(0);
}

main();
