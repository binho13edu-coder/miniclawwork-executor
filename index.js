const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

if (!process.env.TELEGRAM_TOKEN || !process.env.GITHUB_TOKEN) {
  console.error('[FATAL] Missing TELEGRAM_TOKEN or GITHUB_TOKEN');
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { handlerTimeout: 90000 });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const REPO_OWNER = 'binho13edu-coder';
const REPO_NAME = 'miniclawwork-executor';
const OWNER_ID = parseInt(process.env.TELEGRAM_OWNER_ID || '0');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function triggerAndWait(code) {
  const taskId = require('crypto').randomUUID();
  const codeB64 = Buffer.from(code).toString('base64');

  await octokit.repos.createDispatchEvent({
    owner: REPO_OWNER, repo: REPO_NAME,
    event_type: 'run-python',
    client_payload: { code: codeB64, task_id: taskId }
  });

  await sleep(8000);

  for (let i = 0; i < 36; i++) {
    const runs = await octokit.actions.listWorkflowRunsForRepo({
      owner: REPO_OWNER, repo: REPO_NAME, per_page: 10
    });
    const run = runs.data.workflow_runs.find(r => r.display_title === taskId);
    if (!run) { await sleep(5000); continue; }

    if (run.status !== 'completed') { await sleep(5000); continue; }

    const artifacts = await octokit.actions.listWorkflowRunArtifacts({
      owner: REPO_OWNER, repo: REPO_NAME, run_id: run.id
    });
    const artifact = artifacts.data.artifacts.find(a => a.name.includes(taskId));
    if (!artifact) { await sleep(5000); continue; }

    const dl = await octokit.actions.downloadArtifact({
      owner: REPO_OWNER, repo: REPO_NAME,
      artifact_id: artifact.id, archive_format: 'zip'
    });

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(Buffer.from(dl.data));
    const entry = zip.getEntry('output.txt');
    return entry ? zip.readAsText(entry) : '❌ output.txt não encontrado';
  }
  return '⏱️ Timeout esperando resultado';
}

bot.command('start', ctx => ctx.reply('✅ MiniClawork online!'));
bot.command('ping', ctx => ctx.reply('pong!'));
bot.command('status', ctx => ctx.reply(`✅ Online\nRAM: ${Math.round(process.memoryUsage().rss/1024/1024)}MB`));

bot.command('exec', async ctx => {
  if (OWNER_ID && ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const code = ctx.message.text.replace('/exec', '').trim();
  if (!code) return ctx.reply('Uso: /exec <código python>');
  await ctx.reply('⏳ Executando...');
  try {
    const result = await triggerAndWait(code);
    logTask({query: code, result: result, status: (!result.startsWith('⏱️') && !result.startsWith('❌')) ? 'success' : 'error'});
    await ctx.reply(`✅ Resultado:\n${result}`);
  } catch (e) {
    await ctx.reply(`❌ Erro: ${e.message}`);
  }
});


const fs = require('fs');
const http = require('http');

// Healthcheck server
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', service: 'miniclawwork', uptime: process.uptime()}));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3001, () => console.log('Healthcheck em :3001'));

// Memory log
function logTask(data) {
  const path = './memory.json';
  let memory = [];
  try { memory = JSON.parse(fs.readFileSync(path)); } catch(e) {}
  memory.push({...data, timestamp: new Date().toISOString()});
  if (memory.length > 100) memory = memory.slice(-100);
  fs.writeFileSync(path, JSON.stringify(memory, null, 2));
}

bot.launch().then(() => console.log('Bot iniciado'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
