async function triggerAndWait(ctx, code) {
    try {
        const sanitizedCode = code.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        
        // Disparar Workflow com a estrutura correta de inputs
        await octokit.rest.actions.createWorkflowDispatch({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            workflow_id: 'code_executor.yml',
            ref: 'main',
            inputs: {
                code: sanitizedCode
            }
        });

        ctx.reply("✅ Workflow disparado, aguardando resultado...");
    } catch (err) {
        ctx.reply(`❌ Erro no trigger: ${err.message}`);
        console.error("Erro detalhado:", err);
    }
}
