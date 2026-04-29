const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');

const BOT_TOKEN = "8735672138:AAGy9RNjCp01W5yF1hApKpOWDJo60WXaoVM";
const REPO_OWNER = 'binho13edu-coder';
const REPO_NAME = 'miniclawwork-executor';

const bot = new Telegraf(BOT_TOKEN);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function triggerAndWait(code) {
  const taskId = uuidv4();
  await octokit.repos.createDispatchEvent({
    owner: REPO_OWNER, repo: REPO_NAME,
    event_type: 'run-python',
    client_payload: { code: Buffer.from(code).toString('base64'), task_id: taskId }
  });

  await sleep(10000); 

  for (let i = 0; i < 20; i++) {
    const { data: { workflow_runs } } = await octokit.actions.listWorkflowRunsForRepo({
      owner: REPO_OWNER, repo: REPO_NAME, per_page: 5
    });
    
    const run = workflow_runs[0];
    if (run && run.status === 'completed') {
      const { data: { artifacts } } = await octokit.actions.listWorkflowRunArtifacts({
        owner: REPO_OWNER, repo: REPO_NAME, run_id: run.id
      });
      
      const artifact = artifacts.find(a => a.name.includes(taskId));
      if (artifact) {
        const { data: zipData } = await octokit.actions.downloadArtifact({
          owner: REPO_OWNER, repo: REPO_NAME, artifact_id: artifact.id, archive_format: 'zip'
        });
        const zip = new AdmZip(Buffer.from(zipData));
        const entry = zip.getEntry('output.txt');
        return entry ? entry.getData().toString('utf8') : "❌ output.txt vazio";
      }
    }
    await sleep(5000);
  }
  return '❌ Timeout esperando resultado';
}

bot.command('exec', async (ctx) => {
  const code = ctx.message.text.replace('/exec', '').trim();
  await ctx.reply('⏳ Executando...');
  try {
    const result = await triggerAndWait(code);
    await ctx.reply(`✅ Resultado:\n${result}`);
  } catch (err) {
    await ctx.reply(`❌ Erro: ${err.message}`);
  }
});

bot.launch().then(() => console.log('Bot iniciado e pronto para execução real!'));
