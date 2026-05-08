const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// State com memory cap
let state = { leads: [], selectedLead: null };
let conversationHistory = []; // Context window
const persona = "MiniClawwork. Objetivo e direto.";
const MAX_LEADS = 20;
const MAX_HISTORY_TURNS = 3;

async function triggerAndWait(ctx, code, statusText, outputPrefix) {
    try {
        const msg = await ctx.reply(statusText);
        await octokit.rest.actions.createWorkflowDispatch({
            owner: process.env.REPO_OWNER, 
            repo: process.env.REPO_NAME,
            workflow_id: 'code_executor.yml', 
            ref: 'main', 
            inputs: { code }
        });
        
        let runId;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const runs = await octokit.rest.actions.listWorkflowRuns({ 
                owner: process.env.REPO_OWNER, 
                repo: process.env.REPO_NAME, 
                workflow_id: 'code_executor.yml', 
                per_page: 1 
            });
            if (runs.data.workflow_runs[0]) { 
                runId = runs.data.workflow_runs[0].id; 
                break; 
            }
        }
        
        // ← FIX: Race condition guard
        if (!runId) throw new Error("⏱️ Workflow não iniciou em 45s");

        for (let i = 0; i < 40; i++) {
            const run = await octokit.rest.actions.getWorkflowRun({ 
                owner: process.env.REPO_OWNER, 
                repo: process.env.REPO_NAME, 
                run_id: runId 
            });
            if (run.data.status === 'completed') break;
            
            // ← FIX: Timeout explícito
            if (i === 39) throw new Error("⏱️ Timeout: GitHub Actions >2min");
            
            await new Promise(r => setTimeout(r, 3000));
        }

        const arts = await octokit.rest.actions.listWorkflowRunArtifacts({ 
            owner: process.env.REPO_OWNER, 
            repo: process.env.REPO_NAME, 
            run_id: runId 
        });
        
        if (arts.data.artifacts.length > 0) {
            const dl = await octokit.rest.actions.downloadArtifact({ 
                owner: process.env.REPO_OWNER, 
                repo: process.env.REPO_NAME, 
                artifact_id: arts.data.artifacts[0].id, 
                archive_format: 'zip' 
            });
            const res = await axios.get(dl.url, { responseType: 'arraybuffer' });
            fs.writeFileSync('res.zip', Buffer.from(res.data));
            const out = new AdmZip('res.zip').readAsText('output.txt');
            
            try {
                const jsonMatch = out.match(/\[.*\]/s);
                const data = JSON.parse(jsonMatch ? jsonMatch[0] : out);
                if (Array.isArray(data)) {
                    // ← FIX: Memory cap (max 20 leads)
                    state.leads = data.slice(0, MAX_LEADS).map((l, i) => ({ id: i + 1, ...l }));
                    state.selectedLead = state.leads[0] || null;
                    const txt = state.leads.map(l => `[${l.id}] ${l.title}\n🔗 ${l.link}\n📧 ${l.email}\n📞 ${l.phone}`).join('\n\n');
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + (txt || "Zero leads qualificados."));
                } else { 
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
                }
            } catch (e) { 
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
            }
            if (fs.existsSync('res.zip')) fs.unlinkSync('res.zip');
        }
    } catch (e) { 
        console.error('[triggerAndWait]', e.message); // ← FIX: Error logging
        ctx.reply("❌ Erro: " + e.message); 
    }
}

// ← FIX: Context window + error logging
const askLLM = async (t) => {
    conversationHistory.push({role:'user', content: t});
    
    // Janela deslizante: só últimas 3 interações (6 mensagens)
    const recent = conversationHistory.slice(-(MAX_HISTORY_TURNS * 2));
    const msgs = [{role:'system', content:persona}, ...recent];
    
    const call = async (u, k, m) => {
        const res = await axios.post(u, { 
            model: m, 
            messages: msgs, 
            temperature: 0.1,
            max_tokens: 150 // ← FIX: Limita resposta (economia)
        }, { 
            headers: { 'Authorization': `Bearer ${k}` }, 
            timeout: 10000 
        });
        return res.data.choices[0].message.content;
    };
    
    try { 
        const ans = await call('https://openrouter.ai/api/v1/chat/completions', process.env.OPENROUTER_API_KEY, 'meta-llama/llama-3.1-8b-instruct:free');
        conversationHistory.push({role:'assistant', content: ans});
        return ans;
    } catch (e1) {
        console.log('[OpenRouter fail]', e1.message); // ← FIX: Error logging
        try { 
            const ans = await call('https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, 'llama-3.1-8b-instant');
            conversationHistory.push({role:'assistant', content: ans});
            return ans;
        } catch (e2) {
            console.log('[Groq fail]', e2.message); // ← FIX: Error logging
            try { 
                const ans = await call('https://integrate.api.nvidia.com/v1/chat/completions', process.env.NVIDIA_API_KEY, 'meta/llama-3.1-8b-instruct');
                conversationHistory.push({role:'assistant', content: ans});
                return ans;
            } catch (e3) { 
                console.log('[NVIDIA fail]', e3.message); // ← FIX: Error logging
                return "⚠️ Offline."; 
            }
        }
    }
};

const runLeads = (ctx, q) => {
    const py = `
import requests, re, json, urllib.parse, warnings
from duckduckgo_search import DDGS
warnings.filterwarnings("ignore")
bl=['tripadvisor','facebook','instagram','linkedin','youtube','wikipedia','yelp','guiamais','telelistas','restaurantguru','glassdoor','gastroranking','doctoralia','boaconsulta','catalogo','guia','lista','melhores','top10','ranking','cronoshare','peritoanimal','encontra','hospitaleclinicas','clinicasbrasilia','rededorsaoluiz']
ebl=['contact@','info@linktomedia','nesx.co','example','test','sentry','wixpress','google','bing','images','png','jpg']
def is_fake(p):
    c = re.sub(r'\\D','',p)
    return len(c)<10 or len(c)>11 or any(x in c for x in ['123456','000000','111111','333333'])
leads, seen = [], set()
ddd = "61" if "brasília" in "${q}".lower() else None
with DDGS() as ddgs:
    results = list(ddgs.text("${q}", max_results=30))
    for r in results:
        u = r['href'].lower()
        dom = urllib.parse.urlparse(u).netloc.replace('www.','')
        if any(b in u for b in bl) or dom in seen: continue
        try:
            res = requests.get(u, timeout=6, headers={'User-Agent':'Mozilla/5.0'})
            if res.status_code == 200:
                em = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', res.text)
                ph = re.findall(r'\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}', res.text)
                e = [x for x in em if not any(j in x.lower() for j in ebl)]
                p = [x for x in ph if not is_fake(x) and (not ddd or ddd in x)]
                if e or p:
                    leads.append({"title":r['title'], "link":r['href'], "email":e[0] if e else "N/A", "phone":p[0] if p else "N/A"})
                    seen.add(dom)
        except: pass
        if len(leads) >= 5: break
print(json.dumps(leads))`;
    triggerAndWait(ctx, py, "🔎 Sniper Scanner...", "🎯 Leads:\n\n");
};

bot.on('text', async (ctx) => {
    const t = ctx.message.text;
    const tl = t.toLowerCase();
    
    // Hard router
    if (tl.includes("quem é você")) return ctx.reply(persona);
    if (tl === "status") return ctx.reply(`Leads: ${state.leads.length}/${MAX_LEADS} | Selecionado: ${state.selectedLead?.title || 'Nenhum'}`);
    
    const searchMatch = tl.match(/^(buscar|encontrar|procurar)\s+(.+)/i);
    if (searchMatch) return runLeads(ctx, searchMatch[2]);

    if (tl.includes("analise o")) {
        const idx = (tl.match(/\d+/) || [1])[0];
        state.selectedLead = state.leads[idx-1];
        return ctx.reply(state.selectedLead ? `Analisando: ${state.selectedLead.title}\nEmail: ${state.selectedLead.email}\nFone: ${state.selectedLead.phone}` : "Lead não encontrado.");
    }
    
    if (tl === "vale a pena?") {
        if (!state.selectedLead) return ctx.reply("Selecione um lead.");
        const score = state.selectedLead.email !== "N/A" ? 85 : 40;
        return ctx.reply(`Score: ${score}/100. ${score > 50 ? "Contato direto ok." : "Lead frio."}`);
    }
    
    if (tl.startsWith('/leads ')) return runLeads(ctx, t.slice(7));
    if (tl.startsWith('/exec ')) return triggerAndWait(ctx, t.slice(6), "⚙️...", "✅: ");
    if (tl === '/dolar') return triggerAndWait(ctx, `import requests\nprint(requests.get("https://open.er-api.com/v6/latest/USD").json()['rates']['BRL'])`, "💵...", "R$ ");
    if (tl === '/btc') return triggerAndWait(ctx, `import requests\nr=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl")\nval=r.json()['bitcoin']['brl']\nprint(f"{val:,.0f}".replace(",", "."))`, "₿...", "R$ ");

    const ans = await askLLM(t);
    ctx.reply(ans);
});

bot.launch().then(() => console.log("Bot Online v2 — Otimizado"));
