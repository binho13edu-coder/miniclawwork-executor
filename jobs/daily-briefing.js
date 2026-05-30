'use strict';
require('dotenv').config();
const axios    = require('axios');
const Database = require('better-sqlite3');
const { Telegraf } = require('telegraf');
const { store }    = require('../core/finance');
const llmSkill    = require('../skills/llm');

const { preflight } = require('../core/db-preflight');
const { initJobSteps, logStep } = require('../core/job-steps');
const JOBS_DB  = './data/jobs.db';
const JOB_NAME = 'daily-briefing';
const TEST     = process.argv.includes('--test');

if (!preflight(JOBS_DB, JOB_NAME)) { console.error('[daily-briefing] DB preflight failed. Aborting.'); process.exit(1); }
initJobSteps();
const db = new Database(JOBS_DB);
db.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  last_run   TEXT,
  status     TEXT,
  locked     INTEGER DEFAULT 0,
  error      TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

function acquireLock() {
  const row   = db.prepare('SELECT locked, last_run FROM jobs WHERE name=?').get(JOB_NAME);
  const today = new Date().toISOString().slice(0, 10);
  if (row) {
    if (row.locked === 1)                                        return false;
    if (!TEST && row.last_run && row.last_run.startsWith(today)) return false;
    db.prepare('UPDATE jobs SET locked=1,status=?,updated_at=CURRENT_TIMESTAMP WHERE name=?')
      .run('running', JOB_NAME);
  } else {
    db.prepare('INSERT INTO jobs (name,locked,status) VALUES (?,1,?)').run(JOB_NAME,'running');
  }
  return true;
}

function releaseLock(status, err = null) {
  if (TEST || status !== 'ok') {
    db.prepare('UPDATE jobs SET locked=0,status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE name=?')
      .run(status, err, JOB_NAME);
    return;
  }

  db.prepare('UPDATE jobs SET locked=0,status=?,last_run=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE name=?')
    .run(status, new Date().toISOString(), err, JOB_NAME);
}

async function fetchBTC() {
  try {
    const r = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl,usd&include_24hr_change=true',
      { timeout: 8000 }
    );
    const d   = r.data.bitcoin;
    const brl = d.brl.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const chg = d.brl_24h_change.toFixed(2);
    return `₿ BTC: R$ ${brl} | 24h: ${chg >= 0 ? '📈' : '📉'} ${chg}%`;
  } catch { return '₿ BTC: indisponível'; }
}

async function fetchDolar() {
  try {
    const r = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=brl&include_24hr_change=true',
      { timeout: 8000 }
    );
    const d   = r.data.tether;
    const brl = d.brl.toLocaleString('pt-BR', { minimumFractionDigits: 4 });
    const chg = d.brl_24h_change.toFixed(2);
    return '💵 Dólar: R$ ' + brl + ' | 24h: ' + (chg >= 0 ? '📈' : '📉') + ' ' + chg + '%';
  } catch { return '💵 Dólar: indisponível'; }
}

function getFinance() {
  try {
    const b = store.balance();
    return [
      `💰 Receitas: R$ ${b.income.toFixed(2)}`,
      `💸 Despesas: R$ ${b.expense.toFixed(2)}`,
      `${b.balance >= 0 ? '🟢' : '🔴'} Saldo: R$ ${b.balance.toFixed(2)}`
    ].join('\n');
  } catch { return '💰 Finanças: indisponível'; }
}

function getContext() {
  try {
    const kdb  = new Database('./data/knowledge/documents.db', { readonly: true });
    const rows = kdb.prepare(`
      SELECT DISTINCT d.filename
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      ORDER BY dc.id DESC LIMIT 5
    `).all();
    kdb.close();
    if (!rows.length) return '📚 Contexto: sem documentos';
    return '📚 Docs recentes:\n' + rows.map(r => `• ${r.filename.slice(0,50)}`).join('\n');
  } catch { return '📚 Contexto: indisponível'; }
}

async function generateAnalysis(btc, dolar, finance) {
  try {
    const prompt = `Como analista operacional, analise os dados abaixo e gere uma analise 3/3/3:` + String.fromCharCode(10) + String.fromCharCode(10) +
      `DADOS:` + String.fromCharCode(10) +
      `${btc}` + String.fromCharCode(10) +
      `${dolar}` + String.fromCharCode(10) +
      `${finance}` + String.fromCharCode(10) + String.fromCharCode(10) +
      `FORMATO OBRIGATORIO (sem introducao, sem conclusao):` + String.fromCharCode(10) +
      `📌 Fatos: 3 fatos objetivos baseados apenas nos dados acima.` + String.fromCharCode(10) +
      `🔍 Observacoes: 3 observacoes sobre variacoes, tendencias ou anomalias.` + String.fromCharCode(10) +
      `⚡ Sugestoes: 3 sugestoes de acao concretas baseadas nos dados.` + String.fromCharCode(10) + String.fromCharCode(10) +
      `Regras: seja direto, uma frase por item, numerado 1-2-3 em cada secao.`;

    let analysis = await llmSkill.askLLM(prompt, { history: [], persona: 'Você é um analista operacional direto e objetivo. Gere análises concisas em formato 3/3/3.', maxHistoryTurns: 3 });

    if (!analysis || analysis.length < 50) {
      console.log('[V80-10] Analise vazia ou curta, tentando regenerar...');
      analysis = await llmSkill.askLLM(prompt, { history: [], persona: 'Você é um analista operacional direto e objetivo. Gere análises concisas em formato 3/3/3.', maxHistoryTurns: 3 });
    }

    if (!analysis || analysis.length < 50) {
      console.log('[V80-10] Segunda tentativa falhou, omitindo secao de analise.');
      return null;
    }

    return analysis;
  } catch (e) {
    console.error('[V80-10] Erro ao gerar analise:', e.message);
    return null;
  }
}

async function buildBriefing() {
  const jobId = 'daily-briefing-' + Date.now();
const d = new Date(); const pad = (n) => String(n).padStart(2, '0'); const brDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })); const now = pad(brDate.getDate()) + '/' + pad(brDate.getMonth()+1) + '/' + brDate.getFullYear() + ', ' + pad(brDate.getHours()) + ':' + pad(brDate.getMinutes());
  const [btc, dolar] = await Promise.all([fetchBTC(), fetchDolar()]);
  logStep(jobId, 'cripto', 'OK', 'BTC: ' + btc.slice(0, 30));
  const finance = getFinance();
  logStep(jobId, 'financas', 'OK', finance.slice(0, 50));
  const analysis = await generateAnalysis(btc, dolar, finance);
  const sections = [
    `📌 *Briefing Diário — MiniClawwork*`,
    `🕐 ${now}`,
    ``,
    `*1\\. Finanças*`,
    finance,
    ``,
    `*2\\. Cripto e Dólar*`,
    btc,
    dolar,
    ``,
    `*3\\. Contexto*`,
    getContext(),
    logStep(jobId, 'contexto', 'OK', 'Contexto carregado'),
    ``,
    `*4\\. Sistema*`,
    `✅ PM2 online | SQLite OK | Bot ativo`,
  ];
  if (analysis) {
    sections.push(``);
    logStep(jobId, 'analise', analysis ? 'OK' : 'FAIL', analysis ? 'Analise gerada' : 'Analise omitida');
    sections.push(`*5\\. Análise*`);
    sections.push(analysis);
  }
  return sections.join('\n');
}

async function run() {
  if (!acquireLock()) {
    console.log('⏭  Job já executado hoje ou locked. Abortando.');
    return;
  }
  try {
    const msg = await buildBriefing();
    if (TEST) {
      console.log('\n--- BRIEFING TEST ---\n');
      console.log(msg.replace(/\\/g, '').replace(/\*/g, ''));
      console.log('--- FIM ---\n');
    } else {
      const tg = new Telegraf(process.env.TELEGRAM_TOKEN);
      await tg.telegram.sendMessage(process.env.OWNER_ID, msg);
    }
    releaseLock('ok');
    console.log('✅ Briefing concluído.');
  } catch (err) {
    releaseLock('error', err.message);
    console.error('❌ Briefing falhou:', err.message);
    process.exit(1);
  }
}

run();
