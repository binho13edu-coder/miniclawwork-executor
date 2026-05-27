require('dotenv').config();
// Validação defensiva
const REQUIRED_ENV = ['TELEGRAM_TOKEN','GITHUB_TOKEN','OWNER_ID','OPENROUTER_API_KEY'];
console.log('Env OK | OWNER_ID:', process.env.OWNER_ID);

const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');
const cryptoSkill = require('./skills/crypto');
const llmSkill    = require('./skills/llm');
const coreRouter = require('./core/router');
const { handleFinance } = require('./core/finance');
const { buildStatus } = require('./skills/status');
const { memory } = require('./core/memory');
const { ingestDocument } = require('./core/intake.js');
const { execSync } = require('child_process');
const { guard, throttle } = require('./core/command-guard');
const helpManifest = require('./core/help-manifest');
const corrections = require('./core/corrections');
const feedback = require('./core/feedback');
const metrics = require('./core/metrics');
const agents = require('./core/agents');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN, { handlerTimeout: 300000 });
const OWNER_ID = parseInt(process.env.OWNER_ID);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

let state = { leads: [], selectedLead: null };
let conversationHistory = [];
let alertas = [];
let alertaIdCounter = 1;
const persona = "INSTRUÇÃO OBRIGATÓRIA: Seu nome é MiniClawwork. Você é um agente operacional Telegram criado pelo Fábio. PROIBIDO mencionar LLaMA, Meta, ChatGPT, Gemini, OpenAI ou qualquer tecnologia subjacente. Se alguém perguntar quem você é, responda EXATAMENTE: Sou o MiniClawwork, agente operacional do Fábio. Minhas funções: busca de leads B2B, registro financeiro, monitoramento de cripto e respostas gerais. Responda sempre em português, de forma direta e sem enrolação. INSTRUÇÃO ANTI-ALUCINAÇÃO: Se não tiver certeza sobre uma informação factual, responda exatamente: Não tenho dados suficientes para responder isso com precisão. Nunca invente nomes, empresas, datas ou fatos técnicos.";
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
            const res = await axios.get(dl.url, { responseType: 'arraybuffer', timeout: 30000 });
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
                        `[${l.id}] ${l.title}\n🔗 ${l.link}\n📧 ${l.email}\n📞 ${l.phone} [⭐${l.score||0}${l.breakdown ? ": " + l.breakdown : ""}]${l.tag ? " " + l.tag : ""}`
                    ).join('\n\n');
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
                        outputPrefix + (txt || "Zero leads qualificados."));
                } else { 
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
                }
            } catch (e) {
                // saída texto puro — não é erro
                await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, outputPrefix + out); 
            }
            if (fs.existsSync('res.zip')) fs.unlinkSync('res.zip');
        }
    } catch (e) { 
        console.error('[triggerAndWait]', e.message);
        ctx.reply("❌ " + e.message); 
    }
}

const askLLM = async (t) => {
  try {
    const res = await coreRouter.handle(t);
    if (res) return res;
  } catch (e) { /* fallback */ }
  return llmSkill.askLLM(t, {
    history: conversationHistory,
    persona,
    maxHistoryTurns: MAX_HISTORY_TURNS
  });
};

const runLeads = (ctx, q) => {
    conversationHistory = [];
    state.selectedLead = null;
    const py = `
import requests, re, json, urllib.parse, warnings
from ddgs import DDGS
from datetime import datetime, timezone
warnings.filterwarnings("ignore")

def get_domain_age_days(domain):
    try:
        import whois
        w = whois.whois(domain)
        if w.creation_date:
            cd = w.creation_date
            if isinstance(cd, list): cd = cd[0]
            if cd:
                if cd.tzinfo is None:
                    cd = cd.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                return (now - cd).days
    except Exception:
        pass
    try:
        url = f"http://web.archive.org/cdx/search/cdx?url={domain}&limit=1"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            lines = response.text.strip().split("\\n")
            if lines and lines[0]:
                parts = lines[0].split(" ")
                if len(parts) >= 2:
                    ts = parts[1]
                    if len(ts) >= 8:
                        dt = datetime.strptime(ts[:8], "%Y%m%d").replace(tzinfo=timezone.utc)
                        now = datetime.now(timezone.utc)
                        return (now - dt).days
    except Exception:
        pass
    return None
bl=['tripadvisor','facebook','instagram','linkedin','youtube','wikipedia','yelp','guiamais','telelistas','restaurantguru','glassdoor','gastroranking','doctoralia','boaconsulta','cronoshare','peritoanimal','encontra','hospitaleclinicas','clinicasbrasilia','rededorsaoluiz','guiatelefone','guiacidade','mecanicos.net','infoisinfo','applocal','listamais','99freelas','getninjas','habitissimo','apontador','foursquare','yelp','nicelocal','guiafacil','catalogo.med','empresafone','paginaamarela','dentistas.net','catalogo','twinkle','google.com/maps','maps.google','trabalhabrasil','salario.com','empregare','buscja','avaliamed','exiap','kdminhaoficina']
ebl=['contact@','info@linktomedia','nesx.co','example','test','sentry','wixpress','google','bing','images','png','jpg','email@email','ativesite@','comercial@lista','noreply','no-reply','suporte@','contato@lista','atendimento@trabalha']
def is_fake(p):
    c = re.sub(r'\\D','',p)
    if len(c)<10 or len(c)>11: return True
    ddd=int(c[1:3]) if c[0]=='0' else int(c[:2])
    valid={11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99}
    return ddd not in valid or any(x in c for x in ['123456','000000','111111','222222','333333','444444','555555','666666','777777','888888','999999'])
leads, seen = [], set()
# mapa cidade -> [ddds, sigla_estado, nomes_aceitos]
geo = {
    "brasília":   (["61"],"df",["brasília","brasilia","distrito federal"]),
    "brasilia":   (["61"],"df",["brasília","brasilia","distrito federal"]),
    "são paulo":  (["11","12","13","14","15","16","17","18","19"],"sp",["são paulo","sao paulo"," sp"]),
    "sao paulo":  (["11"],"sp",["são paulo","sao paulo"," sp"]),
    "rio de janeiro": (["21","22","24"],"rj",["rio de janeiro"," rj"]),
    "rio branco": (["68"],"ac",["rio branco","acre"," ac"]),
    "cuiabá":     (["65","66"],"mt",["cuiabá","cuiaba","mato grosso"," mt"]),
    "cuiaba":     (["65","66"],"mt",["cuiabá","cuiaba","mato grosso"," mt"]),
    "joão pessoa":(["83"],"pb",["joão pessoa","joao pessoa","paraíba"," pb"]),
    "joao pessoa":(["83"],"pb",["joão pessoa","joao pessoa","paraíba"," pb"]),
    "fortaleza":  (["85","88"],"ce",["fortaleza","ceará"," ce"]),
    "manaus":     (["92","97"],"am",["manaus","amazonas"," am"]),
    "belém":      (["91","93","94"],"pa",["belém","belem","pará"," pa"]),
    "belem":      (["91","93","94"],"pa",["belém","belem","pará"," pa"]),
    "porto alegre":(["51","53","54","55"],"rs",["porto alegre","rio grande do sul"," rs"]),
    "recife":     (["81","87"],"pe",["recife","pernambuco"," pe"]),
    "salvador":   (["71","73","74","75","77"],"ba",["salvador","bahia"," ba"]),
    "belo horizonte":(["31","32","33","34","35","37","38"],"mg",["belo horizonte","minas gerais"," mg"]),
    "goiânia":    (["62","64"],"go",["goiânia","goiania","goiás"," go"]),
    "goiania":    (["62","64"],"go",["goiânia","goiania","goiás"," go"]),
    "florianópolis":(["48","49"],"sc",["florianópolis","florianopolis","santa catarina"," sc"]),
    "curitiba":   (["41","42","43","44","45","46"],"pr",["curitiba","paraná"," pr"]),
    "natal":      (["84"],"rn",["natal","rio grande do norte"," rn"]),
    "maceió":     (["82"],"al",["maceió","maceio","alagoas"," al"]),
    "maceio":     (["82"],"al",["maceió","maceio","alagoas"," al"]),
    "campo grande":(["67"],"ms",["campo grande","mato grosso do sul"," ms"]),
    "aracaju":    (["79"],"se",["aracaju","sergipe"," se"]),
    "porto velho":(["69"],"ro",["porto velho","rondônia"," ro"]),
    "palmas":     (["63"],"to",["palmas","tocantins"," to"]),
    "macapá":     (["96"],"ap",["macapá","macapa","amapá"," ap"]),
    "boa vista":  (["95"],"rr",["boa vista","roraima"," rr"]),
    "são luís":   (["98","99"],"ma",["são luís","sao luis","maranhão"," ma"]),
    "teresina":   (["86","89"],"pi",["teresina","piauí"," pi"]),
    "vitória":    (["27","28"],"es",["vitória","vitoria","espírito santo"," es"]),
    "vitoria":    (["27","28"],"es",["vitória","vitoria","espírito santo"," es"]),
    "recife":     (["81","87"],"pe",["recife","pernambuco"," pe"]),
    "salvador":   (["71","73","74","75","77"],"ba",["salvador","bahia"," ba"]),
    "belo horizonte":(["31","32","33","34","35","37","38"],"mg",["belo horizonte","minas gerais"," mg"]),
    "goiânia":    (["62","64"],"go",["goiânia","goiania","goiás"," go"]),
    "goiania":    (["62","64"],"go",["goiânia","goiania","goiás"," go"]),
    "florianópolis":(["48","49"],"sc",["florianópolis","florianopolis","santa catarina"," sc"]),
    "florianopolis":(["48","49"],"sc",["florianópolis","florianopolis","santa catarina"," sc"]),
    "curitiba":   (["41","42","43","44","45","46"],"pr",["curitiba","paraná"," pr"]),
    "natal":      (["84"],"rn",["natal","rio grande do norte"," rn"]),
    "maceió":     (["82"],"al",["maceió","maceio","alagoas"," al"]),
    "maceio":     (["82"],"al",["maceió","maceio","alagoas"," al"]),
    "campo grande":(["67"],"ms",["campo grande","mato grosso do sul"," ms"]),
}
q_lower = "${q}".lower()
ddds, geo_palavras = None, None
for cidade, (codigos, uf, nomes) in geo.items():
    if cidade in q_lower:
        ddds = codigos
        geo_palavras = nomes + [cidade]
        break
with DDGS() as ddgs:
    results = list(ddgs.text("${q} contato telefone site oficial", max_results=50))
for r in results:
    u = r['href'].lower()
    dom = urllib.parse.urlparse(u).netloc.replace('www.','')
    if any(b in u for b in bl) or dom in seen: 
        continue
    q_words = [w for w in "${q}".lower().split() if len(w)>3]
    title_lower = r['title'].lower()
    if not any(w in title_lower or w in u for w in q_words):
        continue
    try:
        res = requests.get(r['href'], timeout=6, headers={'User-Agent':'Mozilla/5.0'})
        if res.status_code == 200:
            em = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', res.text)
            ph = re.findall(r'\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}', res.text)
            e = [x for x in em if not any(j in x.lower() for j in ebl)]
            p = [x for x in ph if not is_fake(x) and (not ddds or any(re.sub(r"\\D","",x).lstrip("0")[:2]==d for d in ddds))]
            # filtro geográfico: título/link/html deve conter cidade/estado
            html_lower = res.text[:5000].lower()
            geo_ok = True
            if geo_palavras:
                geo_ok = any(gp in r['title'].lower() or gp in u or gp in html_lower for gp in geo_palavras)
            if not geo_ok:
                continue

            raw_title = r['title']
            for sep in [' - ',' | ',' – ']:
                if sep in raw_title:
                    raw_title = raw_title.split(sep)[0].strip()
                    break
            agg_terms = ['cylex','guia','catalogo','eguias','telelistas','apontador','doctoralia','convenio','plano odontologico','encontre','lista de profissionais']
            _check = (raw_title + r['href'] + r.get('body','')).lower()

            sc = 0
            tags = []
            brk = []

            if e:
                sc += 2
                brk.append("+email")
            if p:
                sc += 2
                brk.append("+phone")

            if any(ag in _check for ag in agg_terms):
                sc -= 2
                tags.append('⚠️ possivel agregador')
            else:
                sc += 2

            if 'google.com/maps' in u or 'g.page' in u or '@type="LocalBusiness"' in res.text:
                sc += 3
                brk.append("+gmb")

            social_count = sum(1 for plat in ['instagram.com', 'facebook.com', 'linkedin.com'] if plat in res.text.lower())
            if social_count >= 2:
                sc += 1
                brk.append("+social")

            if not e and not p:
                sc -= 3
                tags.append('☠️ lead morto')

            age_days = get_domain_age_days(dom)
            if age_days is not None:
                if age_days > 730:
                    sc += 2
                    brk.append("+2yrs")
                elif age_days < 180:
                    sc -= 1
                    tags.append('🌱 dominio novo')

            sc = max(0, min(sc, 15))
            tag_str = ' '.join(tags)
            brk_str = ''.join(brk)

            leads.append({"title":raw_title, "link":r['href'], "email":e[0] if e else "N/A", "phone":p[0] if p else "N/A", "score":sc, "tag":tag_str, "breakdown":brk_str})
            seen.add(dom)
    except Exception as ex:
        pass
    if len(leads) >= 5: break
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



// Middleware de latência (V80-NEW-H)
bot.use(async (ctx, next) => {
    const start = Date.now();
    try {
        await next();
    } finally {
        const duration = Date.now() - start;
        let command = 'unknown';
        if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
            command = ctx.message.text.split(' ')[0].split('@')[0];
        } else if (ctx.callbackQuery) {
            command = 'callback_query';
        } else if (ctx.message && ctx.message.document) {
            command = 'document';
        } else if (ctx.message && ctx.message.text) {
            command = 'text';
        }
        metrics.track(command, duration);
    }
});

bot.command('ctx', async (ctx) => {
  const tResult = throttle(ctx.from.id, '/ctx');
  if (tResult.throttled) { return ctx.reply('⏳ Aguarde ' + tResult.waitSeconds + 's antes de usar /ctx novamente.'); }
  try {
    const query = ctx.message.text.replace('/ctx', '').trim();
    if (query) {
      const KnowledgeDB = require('better-sqlite3');
      const kdb = new KnowledgeDB('./data/knowledge/documents.db');
      const stop = new Set(['de','a','o','e','que','um','uma','para','com','em','no','na','os','as','dos','das','por','se','ao','ou']);
      const tokens = query.toLowerCase().replace(/[^a-z\u00e0-\u00fc\s]/gi,' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)).slice(0,6);
      if (!tokens.length) return ctx.reply('Query invalida.');
      const andCond = tokens.map(() => 'dc.content LIKE ?').join(' AND ');
      const orCond  = tokens.map(() => 'dc.content LIKE ?').join(' OR ');
      const wilds   = tokens.map(t => '%' + t + '%');
      let rows = kdb.prepare('SELECT d.filename, dc.content FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE (' + andCond + ') LIMIT 5').all(...wilds);
      if (!rows.length) rows = kdb.prepare('SELECT d.filename, dc.content FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE (' + orCond + ') LIMIT 5').all(...wilds);
      kdb.close();
      if (!rows.length) return ctx.reply('Nenhum documento encontrado para: ' + query);
      let out = '🧠 Resultados para "' + query + '":\n\n';
      rows.forEach((r, i) => { out += (i+1) + '. [' + r.filename + ']\n' + r.content.slice(0, 150) + '...\n\n'; });
      return ctx.reply(out);
    }
    const docsDir = './docs/';
    if (!fs.existsSync(docsDir)) return ctx.reply('Nenhum contexto salvo. Envie .md/.txt/.json primeiro!');
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.json') && !f.includes('_'));
    if (files.length === 0) return ctx.reply('Nenhum documento encontrado.');
    const metas = files.slice(-5).map(f => {
      try { return JSON.parse(fs.readFileSync('./docs/' + f, 'utf8')); } catch(e) { return null; }
    }).filter(Boolean);
    let list = '📚 Contextos Salvos:\n\n';
    metas.forEach(m => { list += '• ' + m.id + ' - ' + m.name + '\n'; });
    list += '\nEnvie mais docs ou use o ID.';
    await ctx.reply(list);
  } catch(e) { ctx.reply('Erro: ' + e.message); }
});

// V6.5 - Context Retrieval: detecta Doc ID na mensagem
bot.hears(/\b([0-9a-f]{8})\b/i, async (ctx) => {
  const docId = ctx.match[1].toLowerCase();
  const docsDir = './docs/';
  const metaPath = docsDir + docId + '.json';
  if (!fs.existsSync(metaPath)) return; // ID não é doc, deixa cair no LLM
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const contentPath = docsDir + docId + '_' + meta.name;
    if (!fs.existsSync(contentPath)) return ctx.reply('Arquivo não encontrado no disco.');
    const content = fs.readFileSync(contentPath, 'utf8').slice(0, 3000); // max 3k chars
    const userMsg = ctx.message.text;
    const shortContent = content;
    const messages = [
      { role: 'system', content: 'Você é um assistente direto. Responda APENAS com base no documento fornecido. Não use conhecimento externo.' },
      { role: 'user', content: 'Documento: ' + meta.name + '\n\n' + shortContent + '\n\n---\nPergunta: ' + userMsg.replace(/\b[0-9a-f]{8}\b/gi, '').trim() }
    ];
    const { handle } = require('./core/router');
    const reply = await handle(messages);
    await ctx.reply(reply);
  } catch(e) {
    ctx.reply('Erro ao recuperar contexto: ' + e.message);
  }
});
bot.command('metrics', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
    const averages = metrics.getAverages(7);
    if (!averages.length) return ctx.reply('📊 Sem métricas ainda.');
    let msg = '📊 Latência média (7 dias):\n\n';
    for (const row of averages) {
        msg += `• ${row.command}: ${Math.round(row.avg_duration)}ms (${row.call_count}x)\n`;
    }
    ctx.reply(msg);
});

bot.on('text', async (ctx) => {
    const t = ctx.message.text;
    const tl = t.toLowerCase().trim();
    if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');

  // === Throttle helper (V80-NEW-B) ===
  function _checkThrottle(cmd) {
    const tResult = throttle(ctx.from.id, cmd);
    if (tResult.throttled) {
      ctx.reply('⏳ Aguarde ' + tResult.waitSeconds + 's antes de usar ' + cmd + ' novamente.');
      return true;
    }
    return false;
  }
  // ===================================
    let m;

    if (tl.includes("quem") && tl.includes("voc")) { conversationHistory = []; return ctx.reply("Sou o MiniClawwork, agente operacional do Fabio. Funcoes: busca de leads B2B, registro financeiro, monitoramento de cripto e respostas gerais."); }
    if (tl === "status") {
        conversationHistory = [];
        return ctx.reply(`Leads: ${state.leads.length}/${MAX_LEADS} | ${state.selectedLead?.title || 'Nenhum'}\nAlertas: ${alertas.length}`);
    }

    if ((m = tl.match(/^\/(cripto|cotacao)\s+(\w+)/))) return getCripto(ctx, m[2]);
    if ((m = tl.match(/^\/(analise|analisa)\s+(\w+)/))) return analiseCripto(ctx, m[2]);
    if (tl === '/dominancia' || tl === '/dom') return dominanciaCripto(ctx);

    if (tl === '/fin' || tl.startsWith('/fin ')) { if (_checkThrottle('/fin')) return; return handleFinance(ctx, tl.replace('/fin', '').trim()); }
    if (tl === '/status') { if (_checkThrottle('/status')) return; return ctx.reply(buildStatus()); }
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

    if (tl.startsWith('/leads ')) { if (_checkThrottle('/leads')) return; return runLeads(ctx, t.slice(7)); }
    if (tl.startsWith('/exec ')) return triggerAndWait(ctx, t.slice(6), "⚙️...", "");
    if (tl === '/dolar') return triggerAndWait(ctx, `import requests\nprint(round(requests.get("https://open.er-api.com/v6/latest/USD").json()['rates']['BRL'],4))`, "💵...", "R$ ");
    if (tl === '/btc') return triggerAndWait(ctx, `import requests\nv=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl").json()['bitcoin']['brl']\nprint(f"R$ {v:,.0f}".replace(",","."))`, "₿...", "");

    // V7.5 handlers
    if (tl === '/help' || tl.startsWith('/help ')) { if (_checkThrottle('/help')) return;
        const query = tl.replace('/help', '').trim();
        if (!query) {
            const byCat = helpManifest.listByCategory();
            let text = '📖 Comandos disponíveis:\n\n';
            for (const [cat, cmds] of Object.entries(byCat)) {
                text += `*${cat}*\n${cmds.map(c => `  /${c.name} — ${c.description}`).join('\n')}\n\n`;
            }
            return ctx.reply(text);
        }
        const results = helpManifest.search(query);
        if (!results.length) return ctx.reply('Nenhum comando encontrado.');
        return ctx.reply(results.map(c => `/${c.name} — ${c.description}`).join('\n'));
    }
    if (tl === '/git' || tl.startsWith('/git ')) { if (_checkThrottle('/git')) return;
        const guardResult = guard(ctx, '/git');
        if (guardResult.blocked) {
            return ctx.reply(`⛔ ${guardResult.reason === 'shell_injection_detected' ? 'Caracteres perigosos detectados.' : 'Comando inválido.'}`);
        }
        const subcmd = guardResult.sanitized.replace('/git', '').trim();
        if (!subcmd) return ctx.reply('Uso: /git <comando>');
        try {
            const output = execSync(`git ${subcmd}`, { cwd: '/home/opc/miniclawwork-executor', encoding: 'utf8', timeout: 10000 });
            return ctx.reply(`\`\`\`\n${output.slice(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (e) {
            return ctx.reply(`❌ Erro: ${e.message}`);
        }
    }
    if (tl === '/corrigir' || tl.startsWith('/corrigir ')) { if (_checkThrottle('/corrigir')) return;
        let text = tl.replace('/corrigir', '').trim();
        const pending = feedback.getAwaitingCorrection(ctx.from.id);
        if (pending) {
            text = `[Contexto Original: ${pending.originalQuery}]\n${text}`;
            feedback.deleteAwaitingCorrection(ctx.from.id);
        }
        if (!text) return ctx.reply('Uso: /corrigir <texto da correção>');
        const db = new (require('better-sqlite3'))('./data/knowledge/documents.db');
        corrections.init(db);
        const result = corrections.saveCorrection(text, db);
        db.close();
        return ctx.reply(result.success ? `✅ Correção #${result.id} gravada.` : `❌ Erro: ${result.error}`);
    }
    await feedback.sendWithFeedback(ctx, await agents.run(t, { history: conversationHistory, persona, maxHistoryTurns: MAX_HISTORY_TURNS }));
});



bot.on('document', async (ctx) => {
  try {
    const file = ctx.message?.document;
    if (!file) return;
    
    const ext = (file.file_name || '').split('.').pop()?.toLowerCase();
    if (!['md','txt','json'].includes(ext)) {
      return ctx.reply('❌ Apenas .md .txt .json');
    }
    
    const link = await ctx.telegram.getFileLink(file.file_id);
    const res = await fetch(link);
    if (!res.ok) throw new Error('Fetch failed');
    
    const content = Buffer.from(await res.arrayBuffer()).toString('utf8');
    const docId = await require('./core/intake.js').ingestDocument(file.file_name, content, ext);
    await ctx.reply('✅ Contexto salvo! Doc ID: ' + docId);
  } catch(e) {
    console.error('Doc handler:', e);
    ctx.reply('❌ Upload falhou: ' + e.message);
  }
});


const feedbackDb = new (require('better-sqlite3'))('./data/feedback.db');

bot.on('callback_query', async (ctx) => {
  await feedback.handleCallback(ctx, feedbackDb);
});




metrics.init();

bot.launch({ dropPendingUpdates: true }).then(() => {
  console.log("MiniClawwork v3.9 online");
  require('./jobs/watchdog').start(bot);
});
