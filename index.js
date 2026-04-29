const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function triggerAndWait(ctx, code) {
    try {
        const msg = await ctx.reply("⏳ Processando...");
        await octokit.rest.actions.createWorkflowDispatch({
            owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME,
            workflow_id: 'code_executor.yml', ref: 'main', inputs: { code: code }
        });
        await new Promise(r => setTimeout(r, 10000));
        const runs = await octokit.rest.actions.listWorkflowRuns({
            owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, workflow_id: 'code_executor.yml', per_page: 1
        });
        const runId = runs.data.workflow_runs[0].id;
        for(let i=0; i<30; i++) {
            const run = await octokit.rest.actions.getWorkflowRun({ owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, run_id: runId });
            if (run.data.status === 'completed') break;
            await new Promise(r => setTimeout(r, 3000));
        }
        const artifacts = await octokit.rest.actions.listWorkflowRunArtifacts({ owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, run_id: runId });
        if (artifacts.data.artifacts.length > 0) {
            const download = await octokit.rest.actions.downloadArtifact({ owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, artifact_id: artifacts.data.artifacts[0].id, archive_format: 'zip' });
            const response = await axios.get(download.url, { responseType: 'arraybuffer' });
            fs.writeFileSync('result.zip', Buffer.from(response.data));
            const zip = new AdmZip('result.zip');
            const output = zip.readAsText('output.txt');
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "✅ Resultado:\n\n" + output);
            fs.unlinkSync('result.zip');
        } else { ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "⚠️ Sem artefatos."); }
    } catch (e) { ctx.reply("❌ Erro: " + e.message); }
}

bot.command('exec', (ctx) => {
    const code = ctx.message.text.split(' ').slice(1).join(' ');
    if (code) triggerAndWait(ctx, code);
});
bot.launch();
