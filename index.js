// entire file content ...

async function triggerAndWait(ctx, code, statusText, outputPrefix) {
    try {
        const msg = await ctx.reply(statusText);
        await octokit.rest.actions.createWorkflowDispatch({
            owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME,
            workflow_id: 'code_executor.yml', ref: 'main', inputs: { code }
        });
        
        let runId;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const runs = await octokit.rest.actions.listWorkflowRuns({ 
                owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, 
                workflow_id: 'code_executor.yml', per_page: 1 
            });
            if (runs.data.workflow_runs[0]) { runId = runs.data.workflow_runs[0].id; break; }
        }
        
        console.log("[RUN ID]", runId); // Added for observability
        
        if (!runId) throw new Error("Workflow nao iniciou");

        for (let i = 0; i < 40; i++) {
            const run = await octokit.rest.actions.getWorkflowRun({ 
                owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, run_id: runId 
            });
            if (run.data.status === 'completed') break;
            if (i === 39) throw new Error("Timeout >2min");
            await new Promise(r => setTimeout(r, 3000));
        }

        const arts = await octokit.rest.actions.listWorkflowRunArtifacts({ 
            owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, run_id: runId 
        });
        
        if (arts.data.artifacts.length > 0) {
            const dl = await octokit.rest.actions.downloadArtifact({ 
                owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, 
                artifact_id: arts.data.artifacts[0].id, archive_format: 'zip' 
            });
            const res = await axios.get(dl.url, { responseType: 'arraybuffer' });
            fs.writeFileSync('res.zip', Buffer.from(res.data));
            const out = new AdmZip('res.zip').readAsText('output.txt');
            
            console.log("[RAW OUTPUT]", out); // Added for observability
            
            try {
                const jsonMatch = out.match(/\[.*\]/s);
                const data = JSON.parse(jsonMatch ? jsonMatch[0] : out);
                if (Array.isArray(data)) {
                    state.leads = data.slice(0, MAX_LEADS).map((l, i) => ({ id: i + 1, ...l }));
                    state.selectedLead = state.leads[0] || null;
                    const txt = state.leads.map(l => 
                        `[${l.id}] ${l.title}\n🔗 ${l.link}\n📧 ${l.email}\n📞 ${l.phone}`
                    ).join('\n\n');
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
                        outputPrefix + (txt || "Zero leads qualificados."));
                } else { 
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
                }
            } catch (e) {
                console.log("[JSON ERROR]", e.message); // Added for observability
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
            }
            if (fs.existsSync('res.zip')) fs.unlinkSync('res.zip');
        } else {
            console.log("[EMPTY ARTIFACT]"); // Added for observability
        }
    } catch (e) { 
        console.error('[triggerAndWait]', e.message);
        ctx.reply("❌ " + e.message); 
    }
}

// ... rest of code ...
