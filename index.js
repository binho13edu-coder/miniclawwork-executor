const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');
const cryptoSkill = require('./skills/crypto');
const llmSkill    = require('./skills/llm');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

let state = { leads: [], selectedLead: null };
let conversationHistory = [];
let alertas = [];
let alertaIdCounter = 1;
const persona = "MiniClawwork. Objetivo e direto.";
const MAX_LEADS = 20;
const MAX_HISTORY_TURNS = 3;

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
            
            console.log("[RAW OUTPUT]", out);
            
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
                console.log("[JSON ERROR]", e.message);
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
            }
            if (fs.existsSync('res.zip')) fs.unlinkSync('res.zip');
        }
    } catch (e) { 
        console.error('[triggerAndWait]', e.message);
        ctx.reply("❌ " + e.message); 
    }
}

const askLLM = (t) => llmSkill.askLLM(t, {
  history: conversationHistory,
  persona,
  maxHistoryTurns: MAX_HISTORY_TURNS
});

const runLeads = (ctx, q) => {
    conversationHistory = [];
    state.selectedLead = null;
    const py = `
import requests, re, json, urllib.parse, warnings
from ddgs import DDGS
warnings.filterwarnings("ignore")
bl=['tripadvisor','facebook','instagram','linkedin','youtube','wikipedia','yelp','guiamais','telelistas','restaurantguru','glassdoor','gastroranking','doctoralia','boaconsulta','cronoshare','peritoanimal','encontra','hospitaleclinicas','clinicasbrasilia','rededorsaoluiz']
ebl=['contact@','info@linktomedia','nesx.co','example','test','sentry','wixpress','google','bing','images','png','jpg']
def is_fake(p):
    c = re.sub(r'\\D','',p)
    return len(c)<10 or len(c)>11 or any(x in c for x in ['123456','000000','111111','333333'])
leads, seen = [], set()
ddd = "61" if "brasília" in "${q}".lower() else None
print("DEBUG: iniciando DDGS")
with DDGS() as ddgs:
    results = list(ddgs.text("${q} contato telefone email site oficial", max_results=40))
print(f"DEBUG: resultados DDGS={len(results)}")
for r in results:
    u = r['href'].lower()
    dom = urllib.parse.urlparse(u).netloc.replace('www.','')
    print(f"DEBUG: analisando={r['href']}")
    if any(b in u for b in bl) or dom in seen: 
        print(f"DEBUG: bloqueado por blacklist ou duplicado")
        continue
    try:
        print("DEBUG: request start")
        res = requests.get(r['href'], timeout=6, headers={'User-Agent':'Mozilla/5.0'})
        print(f"DEBUG: status={res.status_code}")
        if res.status_code == 200:
            em = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', res.text)
            ph = re.findall(r'\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}', res.text)
            e = [x for x in em if not any(j in x.lower() for j in ebl)]
            p = [x for x in ph if not is_fake(x) and (not ddd or ddd in x)]
            print(f"DEBUG: emails={len(e)} telefones={len(p)}")
            if e or p:
                leads.append({"title":r['title'], "link":r['href'], "email":e[0] if e else "N/A", "phone":p[0] if p else "N/A"})
                seen.add(dom)
                print(f"DEBUG: lead adicionado={r['href']}")
    except Exception as ex:
        print(f"DEBUG: erro request={str(ex)}")
    if len(leads) >= 5: break
print(f"DEBUG: total leads={len(leads)}")
print(json.dumps(leads))`;
    triggerAndWait(ctx, py, "🔎 Scanner...", "🎯 Leads:\n\n");
};

const getCripto = async (ctx, ativo) => {
    const id = ativo.toUpperCase();
    const cids = {BTC:"bitcoin",ETH:"ethereum",BNB:"binancecoin",SOL:"solana",ADA:"cardano",XRP:"ripple"};
    const cid = cids[id] || id.toLowerCase();
    const py = `import requests
r=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=${cid}&vs_currencies=brl,usd&include_24hr_change=true",timeout=8)
d=r.json()["${cid}"]
brl=f"{d['brl']:,.2f}".replace(",","X").replace(".",",").replace("X",".")
chg=round(d['brl_24h_change'],2)
print(f"${id}: R$ {brl} / USD {d['usd']:,.2f} | 24h: {chg}%")`;
    await triggerAndWait(ctx, py, `${id}...`, "");
};

const analiseCripto = async (ctx, ativo) => {
    const id = ativo.toUpperCase();
    const cids = {BTC:"bitcoin",ETH:"ethereum",BNB:"binancecoin",SOL:"solana",ADA:"cardano",XRP:"ripple"};
    const cid = cids[id] || id.toLowerCase();
    const py = `import requests
r=requests.get("https://api.coingecko.com/api/v3/coins/${cid}/market_chart?vs_currency=brl&days=30",timeout=10)
prices=[p[1] for p in r.json()["prices"]]
def sma(d,n): return sum(d[-n:])/n if len(d)>=n else None
def rsi(d,n=14):
    g,l=[],[]
    for i in range(1,len(d)): x=d[i]-d[i-1]; g.append(max(x,0)); l.append(max(-x,0))
    ag=sum(g[-n:])/n; al=sum(l[-n:])/n
    return 100 if al==0 else round(100-100/(1+ag/al),1)
ma7=sma(prices,7); ma21=sma(prices,21); rv=rsi(prices); p=prices[-1]
tend="ALTA" if ma7 and ma21 and ma7>ma21 else "BAIXA"
sig="SOBREVENDIDO" if rv<30 else("SOBRECOMPRADO" if rv>70 else "NEUTRO")
def fmt(v): return f"{v:,.2f}".replace(",","X").replace(".",",").replace("X",".") if v else "N/A"
print(f"${id} 30d | R$ {fmt(p)} | MA7:{fmt(ma7)} | MA21:{fmt(ma21)} | RSI:{rv} | {tend} | {sig}")`;
    await triggerAndWait(ctx, py, `Analisando ${id}...`, "");
};

const dominanciaCripto = async (ctx) => {
    const py = `import requests
g=requests.get("https://api.coingecko.com/api/v3/global",timeout=8).json()["data"]
fg=requests.get("https://api.alternative.me/fng/",timeout=8).json()["data"][0]
print(f"BTC Dom: {g['market_cap_percentage']['btc']:.1f}% | ETH: {g['market_cap_percentage']['eth']:.1f}% | F&G: {fg['value']} ({fg['value_classification']})")`;
    await triggerAndWait(ctx, py, "Dominancia...", "");
};

const verificarAlertas = async () => {
    if (!alertas.length) return;
    const ids = {BTC:"bitcoin",ETH:"ethereum",BNB:"binancecoin",SOL:"solana",ADA:"cardano",XRP:"ripple"};
    for (const a of [...alertas]) {
        try {
            const cid = ids[a.ativo] || a.ativo.toLowerCase();
            const r = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cid}&vs_currencies=brl`, { timeout: 6000 });
            const preco = r.data[cid]?.brl;
            if (!preco) continue;
            if (a.operador === '<' ? preco < a.valor : preco > a.valor) {
                await bot.telegram.sendMessage(a.chatId, `🔔 ALERTA: ${a.ativo} ${a.operador} R$${a.valor.toLocaleString('pt-BR')}\nAtual: R$${preco.toLocaleString('pt-BR')}`);
                alertas = alertas.filter(x => x.id !== a.id);
            }
        } catch (e) { console.log('[alerta fail]', e.message); }
    }
};
setInterval(verificarAlertas, 2 * 60 * 1000);

bot.on('text', async (ctx) => {
    const t = ctx.message.text;
    const tl = t.toLowerCase().trim();
    let m;

    if (tl.includes("quem") && tl.includes("voc")) { conversationHistory = []; return ctx.reply(persona); }
    if (tl === "status") {
        conversationHistory = [];
        return ctx.reply(`Leads: ${state.leads.length}/${MAX_LEADS} | ${state.selectedLead?.title || 'Nenhum'}\nAlertas: ${alertas.length}`);
    }

    if ((m = tl.match(/^\/(cripto|cotacao)\s+(\w+)/))) return getCripto(ctx, m[2]);
    if ((m = tl.match(/^\/(analise|analisa)\s+(\w+)/))) return analiseCripto(ctx, m[2]);
    if (tl === '/dominancia' || tl === '/dom') return dominanciaCripto(ctx);

    if ((m = tl.match(/^\/alerta\s+(\w+)\s*([<>])\s*([\d.,]+)/))) {
        const ativo = m[1].toUpperCase(), op = m[2];
        const val = parseFloat(m[3].replace(/\./g,'').replace(',','.'));
        const id = alertaIdCounter++;
        alertas.push({ id, ativo, operador: op, valor: val, chatId: ctx.chat.id });
        return ctx.reply(`✅ Alerta #${id}: ${ativo} ${op} R$${val.toLocaleString('pt-BR')}`);
    }
    if (tl === '/alertas') {
        return ctx.reply(alertas.length ? "Alertas:\n" + alertas.map(a => `#${a.id} ${a.ativo} ${a.operador} R$${a.valor.toLocaleString('pt-BR')}`).join('\n') : "Nenhum alerta.");
    }
    if ((m = tl.match(/^\/cancela\s+(\d+)/))) {
        alertas = alertas.filter(a => a.id !== parseInt(m[1]));
        return ctx.reply(`🗑️ Alerta #${m[1]} removido.`);
    }

    if ((m = tl.match(/^(buscar|encontrar|procurar)\s+(.+)/i))) return runLeads(ctx, m[2]);
    if (tl.includes("analise o") && !tl.startsWith('/analise')) {
        const idx = parseInt(tl.match(/\d+/)?.[0] || '1');
        state.selectedLead = state.leads[idx - 1];
        return ctx.reply(state.selectedLead ? `Lead [${idx}]: ${state.selectedLead.title}\nEmail: ${state.selectedLead.email}\nFone: ${state.selectedLead.phone}` : "Lead nao encontrado.");
    }
    if (tl === "vale a pena?") {
        if (!state.selectedLead) return ctx.reply("Selecione um lead.");
        const score = state.selectedLead.email !== "N/A" ? 85 : 40;
        return ctx.reply(`Score: ${score}/100. ${score > 50 ? "Contato direto ok." : "Lead frio."}`);
    }

    if (tl.startsWith('/leads ')) return runLeads(ctx, t.slice(7));
    if (tl.startsWith('/exec ')) return triggerAndWait(ctx, t.slice(6), "⚙️...", "");
    if (tl === '/dolar') return triggerAndWait(ctx, `import requests\nprint(round(requests.get("https://open.er-api.com/v6/latest/USD").json()['rates']['BRL'],4))`, "💵...", "R$ ");
    if (tl === '/btc') return triggerAndWait(ctx, `import requests\nv=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl").json()['bitcoin']['brl']\nprint(f"R$ {v:,.0f}".replace(",","."))`, "₿...", "");

    ctx.reply(await askLLM(t));
});

bot.launch().then(() => console.log("MiniClawwork v3.9 - DEBUG MODE"));
