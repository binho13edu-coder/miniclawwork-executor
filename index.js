const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const crypto = require('crypto');

// Configurações vindas do ambiente (PM2)
const config = {
    token: process.env.TELEGRAM_TOKEN,
    github: process.env.GITHUB_TOKEN,
    owner: process.env.REPO_OWNER,
    repo: process.env.REPO_NAME,
    admin: parseInt(process.env.OWNER_ID)
};

const bot = new Telegraf(config.token);
const octokit = new Octokit({ auth: config.github });

// Função para esperar o GitHub processar
const sleep = ms => new Promise(res => setTimeout(res, ms));

async function runTask(ctx, code) {
    const taskId = crypto.randomUUID();
    const sentMsg = await ctx.reply(`⏳ GitHub processando...\nID: ${taskId.slice(0,8)}`);

    try {
        // 1. Dispara o Workflow
        await octokit.repos.createDispatchEvent({
            owner: config.owner,
            repo: config.repo,
            event_type: 'run-python',
            client_payload: { 
                code: Buffer.from(code).toString('base64'),
                task_id: taskId 
            }
        });

        // 2. Polling (Espera concluir)
        let runId = null;
        for (let i = 0; i < 20; i++) {
            await sleep(5000);
            const runs = await octokit.actions.listWorkflowRunsForRepo({
                owner: config.owner,
                repo: config.repo,
                per_page: 5
            });
            
            const target = runs.data.workflow_runs.find(r => r.display_title === taskId);
            if (target && target.status === 'completed') {
                runId = target.id;
                break;
            }
        }

        if (!runId) return ctx.telegram.editMessageText(ctx.chat.id, sentMsg.message_id, null, "⏱️ Timeout no GitHub.");

        // 3. Baixa o Artefato
        const artifacts = await octokit.actions.listWorkflowRunArtifacts({
            owner: config.owner,
            repo: config.repo,
            run_id: runId
        });

        if (artifacts.data.artifacts.length === 0) throw new Error("Artefato não gerado.");

        const download = await octokit.actions.downloadArtifact({
            owner: config.owner,
            repo: config.repo,
            artifact_id: artifacts.data.artifacts[0].id,
            archive_format: 'zip'
        });

        const zip = new AdmZip(Buffer.from(download.data));
        const result = zip.readAsText("output.txt");

        await ctx.telegram.editMessageText(ctx.chat.id, sentMsg.message_id, null, `✅ Resultado:\n\n${result}`);

    } catch (err) {
        console.error(err);
        ctx.reply(`❌ Erro: ${err.message}`);
    }
}

bot.on('text', async (ctx) => {
    if (ctx.from.id !== config.admin) return ctx.reply("⛔ Acesso negado.");
    
    const msg = ctx.message.text;
    if (msg.startsWith('/exec ')) {
        const code = msg.replace('/exec ', '');
        return runTask(ctx, code);
    }
    
    if (msg.startsWith('/ask ')) {
        // Aqui você pode colocar a integração com LLM depois
        ctx.reply("Modo chat ainda sendo configurado. Use /exec para código.");
    }
});

bot.launch().then(() => console.log("🚀 Agente Online e Estável"));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
