const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const fs = require('fs');
const http = require('http');
const async = require('async');

// === CONFIGURAÇÃO ===
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'binho13edu-coder';
const REPO_NAME = process.env.REPO_NAME || 'miniclawwork-executor';
const OWNER_ID = process.env.OWNER_ID ? parseInt(process.env.OWNER_ID) : null;

if (!BOT_TOKEN) {
  console.error('TELEGRAM_TOKEN não definido');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN não definido');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// === HEALTHCHECK ===
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'miniclawwork', uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3001, () => console.log('Healthcheck em :3001'));

// === MEMORY LOG ===
function logTask(data) {
  const path = './memory.json';
  let memory = [];
  try { memory = JSON.parse(fs.readFileSync(path)); } catch(e) {}
  memory.push({ ...data, timestamp: new Date().toISOString() });
  if (memory.length > 100) memory = memory.slice(-100);
  fs.writeFileSync(path, JSON.stringify(memory, null, 2));
}

// === FUNÇÃO ORIGINAL DE EXECUÇÃO (com polling e artifact) ===
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function triggerAndWait(code) {
  const taskId = require('crypto').randomUUID();
  const codeB64 = Buffer.from(code).toString('base64');

  await octokit.repos.createDispatchEvent({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    event_type: 'run-python',
    client_payload: { code: codeB64, task_id: taskId }
  });

  await sleep(8000);

  for (let i = 0; i < 36; i++) {
    const runs = await octokit.actions.listWorkflowRunsForRepo({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      per_page: 10
    });
    const run = runs.data.workflow_runs.find(r => r.display_title === taskId);
    if (!run) { await sleep(5000); continue; }

    if (run.status !== 'completed') { await sleep(5000); continue; }

    const artifacts = await octokit.actions.listWorkflowRunArtifacts({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      run_id: run.id
    });
    const artifact = artifacts.data.artifacts.find(a => a.name.includes(taskId));
    if (!artifact) { await sleep(5000); continue; }

    const dl = await octokit.actions.downloadArtifact({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      artifact_id: artifact.id,
      archive_format: 'zip'
    });

    const zip = new AdmZip(Buffer.from(dl.data));
    const entry = zip.getEntry('output.txt');
    if (!entry) return '❌ output.txt não encontrado';
    return zip.readAsText(entry);
  }
  return '⏱️ Timeout esperando resultado';
}

// === FILA ANTI‑COLISÃO (concorrência = 1) ===
const taskQueue = async.queue(async (task) => {
  const { code, reply } = task;
  try {
    const result = await triggerAndWait(code);
    const status = (!result.startsWith('⏱️') && !result.startsWith('❌')) ? 'success' : 'error';
    logTask({ query: code, result, status });
    await reply(`✅ Resultado:\n${result}`);
  } catch (err) {
    logTask({ query: code, result: err.message, status: 'error' });
    await reply(`❌ Erro: ${err.message}`);
  }
}, 1);

// === COMANDOS DO BOT ===
bot.command('start', ctx => ctx.reply('✅ MiniClawwork online!'));
bot.command('ping', ctx => ctx.reply('pong!'));
bot.command('status', ctx => ctx.reply(`✅ Online\nRAM: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`));

bot.command('exec', async (ctx) => {
  if (OWNER_ID && ctx.from.id !== OWNER_ID) {
    return ctx.reply('⛔ Acesso negado.');
  }
  const code = ctx.message.text.replace('/exec', '').trim();
  if (!code) {
    return ctx.reply('Uso: /exec <código python>');
  }
  await ctx.reply('⏳ Tarefa enfileirada. Aguarde...');
  taskQueue.push({ code, reply: (msg) => ctx.reply(msg) });
});

// === INICIALIZAÇÃO ===

bot.command('history', (ctx) => {
  if (OWNER_ID && ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  let memory = [];
  try { memory = JSON.parse(fs.readFileSync('./memory.json')); } catch(e) {}
  if (!memory.length) return ctx.reply('Nenhuma execução registrada.');
  const last5 = memory.slice(-5).reverse();
  const msg = last5.map((t, i) => 
    `${i+1}. [${t.status}] ${t.query.substring(0,40)}\n    → ${t.result.trim().substring(0,40)}\n    ${t.timestamp}`
  ).join('\n\n');
  ctx.reply(`📋 Últimas execuções:\n\n${msg}`);
});


bot.command('clear', (ctx) => {
  if (OWNER_ID && ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  fs.writeFileSync('./memory.json', '[]');
  ctx.reply('🗑️ Histórico limpo.');
});

bot.launch().then(() => console.log('Bot iniciado'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
