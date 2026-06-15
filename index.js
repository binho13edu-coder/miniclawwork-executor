require('dotenv').config({ path: '/home/opc/miniclawwork-executor/.env' });
// Validação defensiva
const REQUIRED_ENV = ['TELEGRAM_TOKEN','GITHUB_TOKEN','OWNER_ID','OPENROUTER_API_KEY'];

// V80-15+ — Helpers para novos modulos
function sanitizeInput(input) {
  return String(input).replace(/[^a-zA-Z0-9.\-_@\/]/g, "").trim().substring(0, 200);
}
function sanitizeDomain(input) {
  return String(input).replace(/[^a-zA-Z0-9.\-]/g, "").trim().toLowerCase();
}
function sanitizeEmail(input) {
  return String(input).replace(/[^a-zA-Z0-9.@\-_]/g, "").trim().toLowerCase();
}

console.log('Env OK | OWNER_ID:', process.env.OWNER_ID);

const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');
const cryptoSkill = require('./skills/crypto');
const llmSkill    = require('./skills/llm');
// [REMOVIDO V9.0-SEC] ethical-hacking, ai-attack-simulator, hackflow — removidos
const trimmer     = require('./jobs/memory-trimmer'); // V90-NEW-A Trimmer TLDR
const healer      = require('./jobs/chunk-healer'); // V90-NEW-Q Auto-Healing
const reminder    = require('./jobs/reminder'); // V90-NEW-R Reminder
const exporter    = require('./jobs/exporter'); // V90-NEW-Y Export
const scheduler   = require('./jobs/scheduler'); // V90-NEW-W Schedule
const learning    = require('./core/learning'); // V90-NEW-APRENDER
const tts         = require('./core/tts');      // V90-NEW-VOICE
const stt         = require('./core/stt');      // V90-NEW-STT
const { initCache, getCacheStats } = require('./core/llm.js');
const coreRouter = require('./core/router');
const { handleFinance, FinanceStore } = require('./core/finance');
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

let state = { leads: [], selectedLead: null, activePersona: null }; // V80-13
let conversationHistory = [];

// V90-NEW-Z4 — Helper para quebrar mensagens longas no Telegram
async function sendLongReply(ctx, text, opts = {}) {
  const LIMIT = 4000;
  if (text.length <= LIMIT) {
    return ctx.reply(text, opts);
  }
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    // Quebrar em última quebra de linha antes do limite, se possível
    let end = Math.min(i + LIMIT, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf('\n', end);
      if (lastBreak > i) end = lastBreak + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  for (let j = 0; j < chunks.length; j++) {
    await ctx.reply(chunks[j], j === 0 ? opts : {});
  }
}

// V90-NEW-Z4 — Helper para quebrar mensagens longas no Telegram
async function sendLongReply(ctx, text, opts = {}) {
  const LIMIT = 4000;
  if (text.length <= LIMIT) {
    return ctx.reply(text, opts);
  }
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    // Quebrar em última quebra de linha antes do limite, se possível
    let end = Math.min(i + LIMIT, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf('\n', end);
      if (lastBreak > i) end = lastBreak + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  for (let j = 0; j < chunks.length; j++) {
    await ctx.reply(chunks[j], j === 0 ? opts : {});
  }
}
let alertas = [];
let alertaIdCounter = 1;
const planState = new Map(); // V80-07
const persona = "INSTRUÇÃO OBRIGATÓRIA: Seu nome é MiniClawwork. Você é um agente operacional Telegram criado pelo Fábio. PROIBIDO mencionar LLaMA, Meta, ChatGPT, Gemini, OpenAI ou qualquer tecnologia subjacente. Se alguém perguntar quem você é, responda EXATAMENTE: Sou o MiniClawwork, agente operacional do Fábio. Minhas funções: busca de leads B2B, registro financeiro, monitoramento de cripto e respostas gerais. Responda sempre em português, de forma direta e sem enrolação. INSTRUÇÃO ANTI-ALUCINAÇÃO: Para perguntas de conhecimento geral (história, geografia, ciência, matemática, cultura geral), responda diretamente com confiança. Reserve \"Não tenho dados suficientes para responder isso com precisão\" APENAS para: (1) dados em tempo real (preços, cotações, métricas de mercado), (2) dados pessoais do usuário que não estão no contexto, (3) fatos técnicos muito específicos fora do domínio geral. Nunca invente nomes, empresas, datas ou fatos técnicos específicos.";
const MAX_LEADS = 20;
const MAX_HISTORY_TURNS = 3;

async function triggerAndWait(ctx, code, statusText, outputPrefix) {
    let msg;
    try {
        msg = await ctx.reply(statusText);
    } catch (e) {
        console.error('[triggerAndWait] Error sending initial status:', e.message);
        return;
    }

    let lastError;
    const maxTries = 4;
    
    for (let attempt = 1; attempt <= maxTries; attempt++) {
        try {
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
            
            if (arts.data.artifacts.length === 0) {
                throw new Error("Artifact nao encontrado");
            }

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
                        `[${l.id}] ${l.title}\n🔗 ${l.link}\n📧 ${l.email}\n📞 ${l.phone} [⭐${l.score||0}]${l.tag ? " ⚠️ "+l.tag : ""}`
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
            
            // Sucesso! Sair do loop de retry.
            return;
        } catch (e) {
            lastError = e;
            console.error(`[triggerAndWait] Attempt ${attempt} failed:`, e.message);
            
            if (attempt < maxTries) {
                const backoffMs = Math.pow(2, attempt) * 1000;
                
                try {
                    const logLine = `${new Date().toISOString()} | Attempt ${attempt} | Error: ${e.message}\n`;
                    fs.appendFileSync('data/retry.log', logLine);
                    metrics.trackRetry();
                } catch (logErr) {
                    console.error('[triggerAndWait] Error logging retry:', logErr.message);
                }
                
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
                try {
                    const logLine = `${new Date().toISOString()} | Attempt ${attempt} | Error: ${e.message} (Final Failure)\n`;
                    fs.appendFileSync('data/retry.log', logLine);
                } catch (logErr) {}
            }
        }
    }
    
    // Se todas as tentativas falharem
    console.error('[triggerAndWait] All attempts failed. Last error:', lastError.message);
    try {
        ctx.reply("❌ " + lastError.message);
    } catch(replyErr) {
        console.error('[triggerAndWait] Could not reply error to ctx:', replyErr.message);
    }
}

// V90-NEW-S: Mapa comando -> modelo (sobrescreve persona)
const COMMAND_MODEL_MAP = {
  '/leads': 'qwen/qwen3-coder',
  '/osint': 'qwen/qwen3-coder',
  '/fin': 'llama-3.3-70b-versatile',
  '/ctx': 'gemma2-9b-it',
  '/corrigir': 'gemma2-9b-it',
};

const askLLM = async (t, opts = {}) => {
  try {
    const res = await coreRouter.handle(t);
    if (res) return res;
  } catch (e) { /* fallback */ }
  // V90-NEW-S: resolver modelo preferido pela persona OU comando
  const { PERSONAS } = require('./core/personas');
  const personaKey = opts.persona || state.activePersona || 'default';
  const personaCfg = PERSONAS[personaKey] || PERSONAS.default;
  const commandModel = opts.command ? COMMAND_MODEL_MAP[opts.command] : null;
  return llmSkill.askLLM(t, {
    history: conversationHistory,
    persona: opts.persona || persona,
    maxHistoryTurns: MAX_HISTORY_TURNS,
    model: commandModel || personaCfg.preferredModel // V90-NEW-S: comando > persona
  });
};

const runLeads = (ctx, q) => {
    conversationHistory = [];
    state.selectedLead = null;
    const py = `
import requests, re, json, urllib.parse, warnings
from ddgs import DDGS
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
            lines = response.text.strip().splitlines()
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
                pass
            elif e or p:
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
                if e: sc += 2; brk.append("+email")
                if p: sc += 2; brk.append("+phone")
                if any(ag in _check for ag in agg_terms): sc -= 2; tags.append('⚠️ possivel agregador')
                else: sc += 2
                if 'google.com/maps' in u or 'g.page' in u or '@type="LocalBusiness"' in res.text: sc += 3; brk.append("+gmb")
                social_count = sum(1 for plat in ['instagram.com', 'facebook.com', 'linkedin.com'] if plat in res.text.lower())
                if social_count >= 2: sc += 1; brk.append("+social")
                if not e and not p: sc -= 3; tags.append('☠️ lead morto')
                age_days = get_domain_age_days(dom)
                if age_days is not None:
                    if age_days > 730: sc += 2; brk.append("+2yrs")
                    elif age_days < 180: sc -= 1; tags.append('🌱 dominio novo')
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

// V90-NEW-R: Verificar lembretes pendentes a cada 60s
setInterval(async () => {
  try {
    const pending = reminder.getPending();
    for (const r of pending) {
      try {
        await bot.telegram.sendMessage(r.user_id, `⏰ *Lembrete:*\n${r.message}`, { parse_mode: 'Markdown' });
        reminder.markSent(r.id);
      } catch(e) {
        console.error('[REMINDER] Erro ao enviar:', e.message);
      }
    }
  } catch(e) {
    console.error('[REMINDER] Erro no loop:', e.message);
  }
}, 60000);



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
        // V80-13 — Persona por comando
        const PERSONA_MAP = { "/fin": "financial", "/leads": "leads", "/ctx": "context" };
        if (PERSONA_MAP[command]) {
            state.activePersona = PERSONA_MAP[command];
            console.log(`[V80-13] Persona ativa: ${state.activePersona} (comando: ${command})`);
        } else if (command === "/persona" && ctx.message && ctx.message.text) {
            const pArg = ctx.message.text.replace("/persona", "").trim();
            if (pArg === "reset") {
                state.activePersona = null;
                console.log("[V80-13] Persona resetada para default.");
            } else if (pArg === "list") {
                state.activePersona = null;
                console.log("[V80-13] Listando personas.");
            }
        }
        metrics.track(command, duration);
    }
});

// V80-09 — /ctx modificadores
bot.command('ctx', async (ctx) => {
  const tResult = throttle(ctx.from.id, '/ctx');
  if (tResult.throttled) { return ctx.reply('⏳ Aguarde ' + tResult.waitSeconds + 's antes de usar /ctx novamente.'); }
  try {
    const raw = ctx.message.text.replace('/ctx', '').trim();
    if (!raw) {
      return ctx.reply('Uso: /ctx <termo> | /ctx buscar <termo> | /ctx recente | /ctx importante | /ctx forget | /ctx <ID>');
    }
    const KnowledgeDB = require('better-sqlite3');
    const kdb = new KnowledgeDB('./data/knowledge/documents.db');
    let rows, out;
    if (raw === 'forget') {
      // V90-NEW-O — Limpar contexto do usuário
      try {
        const mdb = new KnowledgeDB('./data/memory.db');
        const count = mdb.prepare('SELECT COUNT(*) as c FROM memories WHERE user_id = ?').get(ctx.from.id.toString());
        if (count.c === 0) { mdb.close(); return ctx.reply('🧠 Seu contexto já está limpo.'); }
        mdb.prepare('DELETE FROM memories WHERE user_id = ?').run(ctx.from.id.toString());
        mdb.close();
        return ctx.reply('🧹 *Contexto limpo!*\n\n' + count.c + ' mensagens removidas da memória.\nO bot não lembra mais conversas anteriores.', { parse_mode: 'Markdown' });
      } catch(e) {
        return ctx.reply('❌ Erro ao limpar contexto: ' + e.message);
      }
    }
    if (raw === 'recente') {
      rows = kdb.prepare('SELECT d.filename, dc.content, dc.created_at FROM document_chunks dc JOIN documents d ON d.id=dc.document_id ORDER BY dc.created_at DESC LIMIT 5').all();
      if (!rows.length) { kdb.close(); return ctx.reply('Nenhum documento recente.'); }
      out = '📅 Documentos recentes:\n\n';
      rows.forEach((r, i) => { out += (i+1) + '. [' + r.filename + '] ' + (r.created_at ? '(' + r.created_at + ')' : '') + '\n' + r.content.slice(0, 150) + '...\n\n'; });
      kdb.close();
      return ctx.reply(out);
    }
    if (raw === 'importante') {
      rows = kdb.prepare('SELECT d.filename, dc.content, dc.importance FROM document_chunks dc JOIN documents d ON d.id=dc.document_id ORDER BY COALESCE(dc.importance, 0) DESC LIMIT 5').all();
      if (!rows.length) { kdb.close(); return ctx.reply('Nenhum documento encontrado.'); }
      out = '⭐ Documentos mais importantes:\n\n';
      rows.forEach((r, i) => { out += (i+1) + '. [' + r.filename + '] (importance: ' + (r.importance || 0) + ')\n' + r.content.slice(0, 150) + '...\n\n'; });
      kdb.close();
      return ctx.reply(out);
    }
    if (raw.startsWith('buscar ')) {
      const term = raw.replace('buscar', '').trim();
      if (!term) { kdb.close(); return ctx.reply('Uso: /ctx buscar <termo>'); }
      const stop = new Set(['de','a','o','e','que','um','uma','para','com','em','no','na','os','as','dos','das','por','se','ao','ou']);
      const tokens = term.toLowerCase().replace(/[^a-z\u00e0-\u00fc\s]/gi,' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)).slice(0,6);
      if (!tokens.length) { kdb.close(); return ctx.reply('Query invalida.'); }
      const andCond = tokens.map(() => 'dc.content LIKE ?').join(' AND ');
      const orCond  = tokens.map(() => 'dc.content LIKE ?').join(' OR ');
      const wilds   = tokens.map(t => '%' + t + '%');
      rows = kdb.prepare('SELECT d.filename, dc.content FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE (' + andCond + ') LIMIT 5').all(...wilds);
      if (!rows.length) rows = kdb.prepare('SELECT d.filename, dc.content FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE (' + orCond + ') LIMIT 5').all(...wilds);
      kdb.close();
      if (!rows.length) return ctx.reply('Nenhum documento encontrado para: ' + term);
      out = '🧠 Resultados para "' + term + '":\n\n';
      rows.forEach((r, i) => { out += (i+1) + '. [' + r.filename + ']\n' + r.content.slice(0, 150) + '...\n\n'; });
      return ctx.reply(out);
    }
    if (/^\d+$/.test(raw)) {
      const docId = parseInt(raw);
      rows = kdb.prepare('SELECT d.filename, dc.content, dc.chunk_index FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE d.id = ? OR dc.document_id = ? LIMIT 1').all(docId, docId);
      kdb.close();
      if (!rows.length) return ctx.reply('Documento ID ' + docId + ' nao encontrado.');
      const r = rows[0];
      return ctx.reply('📄 [' + r.filename + '] (chunk ' + (r.chunk_index || 0) + ')\n\n' + r.content.slice(0, 3000));
    }
    // Comportamento padrao: busca por termo
    const stop = new Set(['de','a','o','e','que','um','uma','para','com','em','no','na','os','as','dos','das','por','se','ao','ou']);
    const tokens = raw.toLowerCase().replace(/[^a-z\u00e0-\u00fc\s]/gi,' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)).slice(0,6);
    if (!tokens.length) { kdb.close(); return ctx.reply('Query invalida.'); }
    const andCond = tokens.map(() => 'dc.content LIKE ?').join(' AND ');
    const orCond  = tokens.map(() => 'dc.content LIKE ?').join(' OR ');
    const wilds   = tokens.map(t => '%' + t + '%');
    rows = kdb.prepare('SELECT d.filename, dc.content FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE (' + andCond + ') LIMIT 5').all(...wilds);
    if (!rows.length) rows = kdb.prepare('SELECT d.filename, dc.content FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE (' + orCond + ') LIMIT 5').all(...wilds);
    kdb.close();
    if (!rows.length) return ctx.reply('Nenhum documento encontrado para: ' + raw);
    out = '🧠 Resultados para "' + raw + '":\n\n';
    rows.forEach((r, i) => { out += (i+1) + '. [' + r.filename + ']\n' + r.content.slice(0, 150) + '...\n\n'; });
    return ctx.reply(out);
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

// [REMOVIDO V9.0-SEC] /recon removido


// [REMOVIDO V9.0-SEC] /scan removido

// DISABLED bot.command('payload', async (ctx) => {
// DISABLED   if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
// DISABLED   const tPayload = throttle(ctx.from.id, '/payload');
// DISABLED   if (tPayload.throttled) return ctx.reply('⏳ Aguarde ' + tPayload.waitSeconds + 's antes de usar /payload novamente.');
// DISABLED   const args = ctx.message.text.slice(9).trim().split(' ');
// DISABLED   if (args.length < 2) return ctx.reply('Uso: /payload <tipo> <plataforma>');
// DISABLED   const result = await hacking.payload(args[0], args[1]);
// DISABLED   hacking.logAudit(ctx.from.id, '/payload', args[0] + '/' + args[1]);
// DISABLED   return ctx.reply(result);
// DISABLED });
// DISABLED 
// [REMOVIDO V9.0-SEC] /report removido


// V80-MENU — Menu inline por categoria
bot.command('menu', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const menuText = `📋 *Menu MiniClawwork*

Escolha uma categoria:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💰 Financeiro', callback_data: 'menu_finance' }, { text: '📊 Leads', callback_data: 'menu_leads' }],
      [{ text: '🔒 Seguranca', callback_data: 'menu_security' }, { text: '🤖 Sistema', callback_data: 'menu_system' }],
      [{ text: '💱 Crypto', callback_data: 'menu_crypto' }, { text: '📚 Knowledge', callback_data: 'menu_knowledge' }],
      [{ text: '⚡ Utilitarios', callback_data: 'menu_utils' }, { text: '📅 Produtividade', callback_data: 'menu_productivity' }],
      [{ text: '💰 Monetizacao', callback_data: 'menu_revenue' }, { text: '🎯 Autonomia', callback_data: 'menu_autonomy' }]
    ]
  };
  await ctx.reply(menuText, { parse_mode: 'Markdown', reply_markup: keyboard });
});

bot.action('menu_finance', async (ctx) => {
  await ctx.editMessageText(`💰 *Financeiro*
  
/fin <descricao> <valor> — Registra gasto ou receita
/dolar — Cotacao do Dolar
/dominancia — Dominancia BTC no mercado`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_leads', async (ctx) => {
  await ctx.editMessageText(`📊 *Leads*
  
/leads <termo> — Busca leads B2B
/plan <objetivo> — Gera plano de acao estrategico`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_security', async (ctx) => {
  await ctx.editMessageText(`🔒 *Seguranca (V80-14)*
  
/recon <dominio> — Reconhecimento de dominio
/scan <host> — Scan de portas e headers
/osint <dns|headers|email> <alvo> — OSINT defensivo (V90-NEW-G)
/payload <tipo> <plataforma> — Payload educacional
/report <alvo> — Relatorio de seguranca completo`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_system', async (ctx) => {
  await ctx.editMessageText(`🤖 *Sistema*
  
/status — Status e recursos
/metrics — Metricas de uso
/cache — Estatisticas do cache LLM
/corrigir <texto> — Corrigir ou ensinar o bot`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_crypto', async (ctx) => {
  await ctx.editMessageText(`💱 *Crypto*
  
/btc — Cotacao do Bitcoin
/dominancia — Dominancia BTC
/alertas — Listar alertas ativos`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_knowledge', async (ctx) => {
  await ctx.editMessageText(`📚 *Knowledge Base*
  
/ctx <termo> — Buscar no knowledge base
/help <termo> — Ajuda semantica
/dump <filtro> — Triar documentos`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_utils', async (ctx) => {
  await ctx.editMessageText(`⚡ *Utilitarios*
  
/exec <codigo> — Executar Python inline
/git <acao> — Disparar workflow GitHub
/corrigir <texto> — Ensinar/corrigir o bot\n/ctx_forget <ID|source|old> — Gerenciar memória`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});



bot.action('menu_productivity', async (ctx) => {
  await ctx.editMessageText(`📅 *Produtividade*
  
/reminder <min> <msg> — Agenda lembrete
/schedule <acao> <cron> — Agendamento recorrente  
/export <leads|fin> — Exporta dados para CSV`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_autonomy', async (ctx) => {
  await ctx.editMessageText(`🎯 *Autonomia*
  
/goals — Ver goals pendentes
/heal — Auto-healing de chunks
/trimmer — Comprime chunks antigos`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});

bot.action('menu_revenue', async (ctx) => {
  await ctx.editMessageText(`💰 *Monetizacao (V80-17 a V80-24)*
  
/apiarbitrage <niche> — APIs gratuitas de alto valor
/domainflipper <keyword> — Dominios expirados
/newsletterhunter <niche> — Newsletters de nicho
/templategen <tipo> <tema> — Templates Notion/Airtable/Excel
/promptmarket <niche> — Prompts premium por nicho
/leadscoring <dados> — Scoring BANT de leads
/proposalgen <dados> — Propostas comerciais
/invoicetrack <acao> — Rastreamento de faturas`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_back' }]] } });
});
bot.action('menu_back', async (ctx) => {
  const menuText = `📋 *Menu MiniClawwork*

Escolha uma categoria:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '💰 Financeiro', callback_data: 'menu_finance' }, { text: '📊 Leads', callback_data: 'menu_leads' }],
      [{ text: '🔒 Seguranca', callback_data: 'menu_security' }, { text: '🤖 Sistema', callback_data: 'menu_system' }],
      [{ text: '💱 Crypto', callback_data: 'menu_crypto' }, { text: '📚 Knowledge', callback_data: 'menu_knowledge' }],
      [{ text: '⚡ Utilitarios', callback_data: 'menu_utils' }, { text: '📅 Produtividade', callback_data: 'menu_productivity' }],
      [{ text: '💰 Monetizacao', callback_data: 'menu_revenue' }, { text: '🎯 Autonomia', callback_data: 'menu_autonomy' }]
    ]
  };
  await ctx.editMessageText(menuText, { parse_mode: 'Markdown', reply_markup: keyboard });
});


// V80-15 — Technical Debt Analyzer
bot.command('techdebt', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/techdebt');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /techdebt novamente.');
  const target = ctx.message.text.slice(10).trim();
  if (!target) return ctx.reply('Uso: /techdebt <usuario/repo> ou <URL>');
  const repo = sanitizeInput(target);
  ctx.reply('🔍 Analisando technical debt de ' + repo + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/techdebt.py "' + repo + '"', { encoding: 'utf8', timeout: 45000 });
    const data = JSON.parse(result);
    let out = '🔍 *Technical Debt — ' + data.repo + '*\n\n';
    out += '📊 *Score Geral:* ' + data.score + '/10\n';
    out += '📅 *Último commit:* ' + data.last_commit + '\n';
    out += '📦 *Dependências:* ' + data.deps_count + '\n\n';
    if (data.findings.length) {
      out += '*Findings:*\n';
      data.findings.forEach(f => {
        out += '• [' + f.severity + '] ' + f.category + ': ' + f.description + '\n';
      });
    } else {
      out += '✅ Nenhum finding critico encontrado.\n';
    }
    out += '\n⚠️ Analise passiva via APIs publicas.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro na analise: ' + e.message);
  }
});

// V80-16 — Hacker Pro Suite Passive
bot.command('hackpro', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/hackpro');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /hackpro novamente.');
  const args = ctx.message.text.slice(9).trim().split(' ');
  const target = sanitizeDomain(args[0] || '');
  const mode = (args[1] || 'recon').toLowerCase();
  if (!target) return ctx.reply('Uso: /hackpro <dominio> <recon|owasp|api|report>');
  const validModes = ['recon', 'owasp', 'api', 'report'];
  if (!validModes.includes(mode)) return ctx.reply('Modo invalido. Use: recon, owasp, api, report');
  ctx.reply('🔒 HackerPro [' + mode + '] em ' + target + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/hackpro.py "' + target + '" ' + mode, { encoding: 'utf8', timeout: 60000 });
    const data = JSON.parse(result);
    let out = '🔒 *HackerPro — ' + mode.toUpperCase() + '*\n*Alvo:* ' + target + '\n\n';
    if (mode === 'recon') {
      out += '*Subdominios:* ' + (data.subdomains?.length || 0) + '\n';
      out += '*Tech Stack:* ' + (data.tech?.join(', ') || 'N/A') + '\n';
      out += '*Certificados:* ' + (data.certs?.length || 0) + ' encontrados\n';
    } else if (mode === 'owasp') {
      out += '*OWASP Checks:*\n';
      (data.checks || []).forEach(c => {
        out += '• ' + c.check + ': ' + (c.found ? '⚠️ ' + c.severity : '✅ OK') + '\n';
      });
    } else if (mode === 'api') {
      out += '*API Endpoints:* ' + (data.endpoints?.length || 0) + '\n';
      out += '*Auth:* ' + (data.auth_issues?.length || 0) + ' issues\n';
    } else if (mode === 'report') {
      out += '*CVSS Medio:* ' + (data.cvss_avg || 'N/A') + '\n';
      out += '*Findings:* ' + (data.findings?.length || 0) + '\n';
      out += '*Risco:* ' + (data.risk_level || 'N/A') + '\n';
    }
    out += '\n⚠️ Apenas avaliacao passiva. Nenhum exploit executado.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-17 — API Arbitrage
bot.command('apiarbitrage', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/apiarbitrage');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /apiarbitrage novamente.');
  const niche = ctx.message.text.slice(13).trim() || 'general';
  ctx.reply('🔌 Buscando APIs gratuitas de alto valor no nicho: ' + niche + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/apiarbitrage.py "' + sanitizeInput(niche) + '"', { encoding: 'utf8', timeout: 45000 });
    const data = JSON.parse(result);
    let out = '🔌 *API Arbitrage — ' + niche + '*\n\n';
    out += '*APIs encontradas:* ' + data.apis.length + '\n\n';
    data.apis.slice(0, 10).forEach(api => {
      out += '• *' + api.name + '*\n';
      out += '  ' + api.description + '\n';
      out += '  💰 Valor: ' + api.value + ' | 🆓 Free tier: ' + api.free_tier + '\n\n';
    });
    if (data.apis.length > 10) out += '...e mais ' + (data.apis.length - 10) + ' APIs.\n';
    out += '\n💡 Dica: Revenda via micro-SaaS ou agregadores.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-18 — Domain Flipper
bot.command('domainflipper', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/domainflipper');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /domainflipper novamente.');
  const keyword = ctx.message.text.slice(14).trim() || 'tech';
  ctx.reply('🔎 Buscando dominios expirados com potencial: ' + keyword + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/domainflipper.py "' + sanitizeInput(keyword) + '"', { encoding: 'utf8', timeout: 45000 });
    const data = JSON.parse(result);
    let out = '🔎 *Domain Flipper — ' + keyword + '*\n\n';
    out += '*Dominios encontrados:* ' + data.domains.length + '\n\n';
    data.domains.slice(0, 8).forEach(d => {
      out += '• *' + d.domain + '*\n';
      out += '  DA: ' + (d.da || 'N/A') + ' | PA: ' + (d.pa || 'N/A') + '\n';
      out += '  Idade: ' + (d.age || 'N/A') + ' anos | Backlinks: ' + (d.backlinks || 'N/A') + '\n';
      out += '  💡 Potencial: ' + d.potential + '\n\n';
    });
    out += '\n⚠️ Verifique disponibilidade real antes de registrar.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-19 — Newsletter Hunter
bot.command('newsletterhunter', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/newsletterhunter');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /newsletterhunter novamente.');
  const niche = ctx.message.text.slice(17).trim() || 'business';
  ctx.reply('📰 Cacando newsletters no nicho: ' + niche + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/newsletterhunter.py "' + sanitizeInput(niche) + '"', { encoding: 'utf8', timeout: 45000 });
    const data = JSON.parse(result);
    let out = '📰 *Newsletter Hunter — ' + niche + '*\n\n';
    out += '*Newsletters encontradas:* ' + data.newsletters.length + '\n\n';
    data.newsletters.slice(0, 10).forEach(n => {
      out += '• *' + n.name + '*\n';
      out += '  ' + n.description + '\n';
      out += '  👥 Est. subscribers: ' + (n.subscribers || 'N/A') + '\n';
      out += '  🔗 ' + n.url + '\n\n';
    });
    out += '\n💡 Oportunidade: Venda de leads ou parcerias.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-20 — Template Generator
bot.command('templategen', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/templategen');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /templategen novamente.');
  const args = ctx.message.text.slice(12).trim().split(' ');
  const type = (args[0] || 'notion').toLowerCase();
  const topic = args.slice(1).join(' ') || 'project management';
  const validTypes = ['notion', 'airtable', 'excel', 'sheets'];
  if (!validTypes.includes(type)) return ctx.reply('Tipo invalido. Use: notion, airtable, excel, sheets');
  ctx.reply('📐 Gerando template ' + type + ' sobre: ' + topic + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/templategen.py "' + type + '" "' + sanitizeInput(topic) + '"', { encoding: 'utf8', timeout: 45000 });
    const data = JSON.parse(result);
    let out = '📐 *Template Generator — ' + type.toUpperCase() + '*\n';
    out += '*Tema:* ' + topic + '\n\n';
    out += data.template + '\n\n';
    out += '💡 Use em ' + type + ' e venda no Gumroad/Payhip.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-21 — Prompt Market
bot.command('promptmarket', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/promptmarket');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /promptmarket novamente.');
  const niche = ctx.message.text.slice(13).trim() || 'copywriting';
  ctx.reply('💬 Catalogando prompts premium para: ' + niche + '...');
  try {
    const { execSync } = require('child_process');
    const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/promptmarket.py "' + sanitizeInput(niche) + '"', { encoding: 'utf8', timeout: 45000 });
    const data = JSON.parse(result);
    let out = '💬 *Prompt Market — ' + niche + '*\n\n';
    out += '*Prompts encontrados:* ' + data.prompts.length + '\n\n';
    data.prompts.slice(0, 8).forEach(p => {
      out += '• *' + p.title + '* (' + p.category + ')\n';
      out += '  ' + p.prompt.substring(0, 150) + '...\n';
      out += '  💰 Est. valor: ' + p.value + '\n\n';
    });
    out += '\n💡 Venda no PromptBase, Etsy ou Gumroad.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-22 — Lead Scoring (BANT)
bot.command('leadscoring', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/leadscoring');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /leadscoring novamente.');
  const raw = ctx.message.text.slice(12).trim();
  if (!raw) return ctx.reply('Uso: /leadscoring <nome> | <email> | <empresa> | <orcamento> | <autoridade> | <necessidade> | <timing>');
  const parts = raw.split('|').map(s => s.trim());
  const lead = {
    name: parts[0] || 'N/A',
    email: sanitizeEmail(parts[1] || ''),
    company: parts[2] || 'N/A',
    budget: parts[3] || 'N/A',
    authority: parts[4] || 'N/A',
    need: parts[5] || 'N/A',
    timing: parts[6] || 'N/A'
  };
  try {
    const { execSync } = require('child_process');
    const result = execSync("python3 /home/opc/miniclawwork-executor/scripts/leadscoring.py '" + JSON.stringify(lead) + "'", { encoding: 'utf8', timeout: 30000 });
    const data = JSON.parse(result);
    let out = '🎯 *Lead Scoring — ' + lead.name + '*\n\n';
    out += '*Score BANT:* ' + data.score + '/100\n';
    out += '*Qualificacao:* ' + data.qualification + '\n\n';
    out += '*Breakdown:*\n';
    out += '💰 Budget: ' + data.breakdown.budget + '/25\n';
    out += '👔 Authority: ' + data.breakdown.authority + '/25\n';
    out += '🔥 Need: ' + data.breakdown.need + '/25\n';
    out += '⏰ Timing: ' + data.breakdown.timing + '/25\n\n';
    out += '*Recomendacao:* ' + data.recommendation;
    
    // V90-NEW-Z2 — HITL para scores > 80
    if (data.score > 80) {
      // Inserir lead no banco temporariamente para referência do callback
      const db = new (require('better-sqlite3'))('./data/leads.db');
      const hashLead = require('./core/lead-validator').hashLead;
      const leadHash = hashLead(lead.email || lead.name, lead.company);
      
      // Verificar se já existe
      const existing = db.prepare('SELECT id FROM leads WHERE lead_hash = ?').get(leadHash);
      let leadId;
      if (existing) {
        leadId = existing.id;
      } else {
        const insert = db.prepare('INSERT INTO leads (nome, email, empresa, lead_hash, resultado) VALUES (?, ?, ?, ?, ?)');
        const result = insert.run(lead.name, lead.email, lead.company, leadHash, 'aberto');
        leadId = result.lastInsertRowid;
      }
      db.close();
      
      return ctx.reply(out, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 Iniciar Prospecção', callback_data: 'hitl_prospect_' + leadId },
            { text: '⏭️ Ignorar', callback_data: 'hitl_ignore_' + leadId }
          ]]
        }
      });
    }
    
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-23 — Proposal Generator
bot.command('proposalgen', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/proposalgen');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /proposalgen novamente.');
  const raw = ctx.message.text.slice(12).trim();
  if (!raw) return ctx.reply('Uso: /proposalgen <cliente> | <servico> | <valor> | <prazo> | <escopo>');
  const parts = raw.split('|').map(s => s.trim());
  const proposal = {
    client: parts[0] || 'Cliente',
    service: parts[1] || 'Servico',
    value: parts[2] || 'R$ 0,00',
    deadline: parts[3] || '30 dias',
    scope: parts[4] || 'Escopo padrao'
  };
  try {
    const { execSync } = require('child_process');
    const result = execSync("python3 /home/opc/miniclawwork-executor/scripts/proposalgen.py '" + JSON.stringify(proposal) + "'", { encoding: 'utf8', timeout: 30000 });
    const data = JSON.parse(result);
    let out = '📄 *Proposta Comercial*\n\n';
    out += '*Para:* ' + data.client + '\n';
    out += '*Servico:* ' + data.service + '\n';
    out += '*Investimento:* ' + data.value + '\n';
    out += '*Prazo:* ' + data.deadline + '\n\n';
    out += '*Escopo:*\n' + data.scope_text + '\n\n';
    out += '*Termos:*\n' + data.terms + '\n\n';
    out += '✅ Pronta para envio. Salve como PDF no Canva.';
    return ctx.reply(out);
  } catch (e) {
    return ctx.reply('❌ Erro: ' + e.message);
  }
});

// V80-24 — Invoice Tracker
bot.command('invoicetrack', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const tRecon = throttle(ctx.from.id, '/invoicetrack');
  if (tRecon.throttled) return ctx.reply('⏳ Aguarde ' + tRecon.waitSeconds + 's antes de usar /invoicetrack novamente.');
  const args = ctx.message.text.slice(13).trim().split(' ');
  const action = (args[0] || 'list').toLowerCase();
  if (action === 'add') {
    const raw = args.slice(1).join(' ');
    const parts = raw.split('|').map(s => s.trim());
    if (parts.length < 4) return ctx.reply('Uso: /invoicetrack add <cliente> | <valor> | <vencimento> | <descricao>');
    const invoice = { client: parts[0], value: parts[1], due: parts[2], desc: parts[3] };
    try {
      const { execSync } = require('child_process');
      execSync("python3 /home/opc/miniclawwork-executor/scripts/invoicetrack.py add '" + JSON.stringify(invoice) + "'", { encoding: 'utf8', timeout: 15000 });
      return ctx.reply('✅ Fatura adicionada: ' + invoice.client + ' — ' + invoice.value + ' (venc: ' + invoice.due + ')');
    } catch (e) { return ctx.reply('❌ Erro: ' + e.message); }
  } else if (action === 'list') {
    try {
      const { execSync } = require('child_process');
      const result = execSync('python3 /home/opc/miniclawwork-executor/scripts/invoicetrack.py list', { encoding: 'utf8', timeout: 15000 });
      const data = JSON.parse(result);
      if (!data.invoices.length) return ctx.reply('📋 Nenhuma fatura cadastrada.');
      let out = '📋 *Faturas*\n\n';
      data.invoices.forEach(inv => {
        const status = inv.status === 'overdue' ? '🔴 Atrasada' : (inv.status === 'paid' ? '✅ Paga' : '🟢 Pendente');
        out += '• ' + inv.client + ' — ' + inv.value + ' (venc: ' + inv.due + ') ' + status + '\n';
      });
      return ctx.reply(out);
    } catch (e) { return ctx.reply('❌ Erro: ' + e.message); }
  } else if (action === 'pay') {
    const id = args[1];
    if (!id) return ctx.reply('Uso: /invoicetrack pay <id>');
    try {
      const { execSync } = require('child_process');
      execSync('python3 /home/opc/miniclawwork-executor/scripts/invoicetrack.py pay ' + id, { encoding: 'utf8', timeout: 15000 });
      return ctx.reply('✅ Fatura #' + id + ' marcada como paga.');
    } catch (e) { return ctx.reply('❌ Erro: ' + e.message); }
  } else {
    return ctx.reply('Uso: /invoicetrack list | add <cliente> | <valor> | <vencimento> | <descricao> | pay <id>');
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

bot.command('cache', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const stats = getCacheStats();
  ctx.reply('📦 Cache LLM\n\n• Entradas: ' + stats.total_entries + '\n• Hits totais: ' + stats.total_hits + '\n• Hit rate: ' + stats.hit_rate);
});


// V90-02 — /ctx com P.A.R.A.
bot.command('ctx', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const args = ctx.message.text.slice(5).trim().split(' ');
  const term = args[0];
  const paraFilter = args[1] || null;
  if (!term) return ctx.reply('Uso: /ctx <termo> [project|area|resource|archive]');
  try {
    const { recallByPara } = require('./core/memory');
    let results;
    if (paraFilter && ['project','area','resource','archive'].includes(paraFilter)) {
      results = recallByPara(paraFilter, 10);
      if (term !== '*') results = results.filter(r => r.content.toLowerCase().includes(term.toLowerCase()));
    } else {
      const { memory } = require('./core/memory');
      results = memory.recallHybrid(ctx.from.id, term, { limit: 10 });
    }
    if (!results.length) return ctx.reply('🔍 Nenhum resultado: ' + term + (paraFilter?' ('+paraFilter+')':''));
    let out = '🔍 *Contexto — ' + term + '*\\n\\n';
    results.slice(0,8).forEach(r => {
      const em = {project:'📁',area:'📂',resource:'📚',archive:'🗄️'}[r.para_category] || '•';
      out += em + ' *' + r.source + '* (' + (r.para_category||'resource') + ')\\n  ' + r.content.substring(0,120) + '...\\n\\n';
    });
    return ctx.reply(out, {parse_mode:'Markdown'});
  } catch(e) { return ctx.reply('❌ Erro: ' + e.message); }
});

// V90-03 — /ctx_forget
bot.command('ctx_forget', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const args = ctx.message.text.slice(12).trim().split(' ');
  const action = args[0];
  if (!action) return ctx.reply('Uso: /ctx_forget <ID> | source:<nome> | old | list | confirm');
  const Database = require('better-sqlite3');
  const DOCS_DB = require('path').join(__dirname, 'data', 'documents.db');
  const db = new Database(DOCS_DB);
  try {
    if (action === 'list') {
      const rows = db.prepare('SELECT id, source, importance, para_category, ts, substr(content,1,60) as preview FROM document_chunks ORDER BY ts ASC LIMIT 10').all();
      if (!rows.length) return ctx.reply('📭 Nenhum chunk cadastrado.');
      let out = '📋 *Chunks mais antigos:*\\n\\n';
      rows.forEach(r => {
        out += '`#' + r.id + '` | *' + r.source + '* | imp=' + r.importance + ' | ' + (r.para_category||'resource') + '\\n  ' + r.preview + '...\\n\\n';
      });
      return ctx.reply(out, {parse_mode:'Markdown'});
    }
    if (action === 'confirm') {
      const pending = global.ctxForgetPending || {};
      const userId = ctx.from.id;
      if (!pending[userId]) return ctx.reply('❌ Nenhuma deleção pendente.');
      const { ids, reason } = pending[userId];
      let deleted = 0;
      for (const id of ids) {
        const row = db.prepare('SELECT id, source, importance FROM document_chunks WHERE id = ?').get(id);
        if (!row) continue;
        if (row.importance >= 8) { console.log('[ctx_forget] Protegido: #' + id); continue; }
        db.prepare('DELETE FROM document_chunks WHERE id = ?').run(id);
        console.log('[ctx_forget] Deletado: #' + id + ' | ' + row.source);
        deleted++;
      }
      delete pending[userId];
      return ctx.reply('✅ Deletados: ' + deleted + ' chunks. Protegidos (imp≥8): ' + (ids.length - deleted));
    }
    if (/^\d+$/.test(action)) {
      const id = parseInt(action);
      const row = db.prepare('SELECT id, source, importance FROM document_chunks WHERE id = ?').get(id);
      if (!row) return ctx.reply('❌ Chunk #' + id + ' não encontrado.');
      if (row.importance >= 8) return ctx.reply('⛔ Chunk #' + id + ' protegido (importance ≥ 8).');
      db.prepare('DELETE FROM document_chunks WHERE id = ?').run(id);
      return ctx.reply('✅ Chunk #' + id + ' (' + row.source + ') deletado.');
    }
    if (action.startsWith('source:')) {
      const source = action.slice(7);
      const rows = db.prepare('SELECT id, importance FROM document_chunks WHERE source = ?').all(source);
      if (!rows.length) return ctx.reply('❌ Nenhum chunk com source: ' + source);
      const deletable = rows.filter(r => r.importance < 8);
      const protected_ = rows.filter(r => r.importance >= 8);
      if (!deletable.length) return ctx.reply('⛔ Todos os chunks de ' + source + ' estão protegidos.');
      if (!global.ctxForgetPending) global.ctxForgetPending = {};
      global.ctxForgetPending[ctx.from.id] = { ids: deletable.map(r => r.id), reason: 'source:' + source };
      return ctx.reply('⚠️ Deletar ' + deletable.length + ' chunks de *' + source + '*?\\nProtegidos: ' + protected_.length + '\\nUse `/ctx_forget confirm` para confirmar.', {parse_mode:'Markdown'});
    }
    if (action === 'old') {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
      const rows = db.prepare('SELECT id, source, importance, ts FROM document_chunks WHERE ts < ? AND importance < 4').all(cutoff.toISOString().slice(0,10));
      if (!rows.length) return ctx.reply('📭 Nenhum chunk antigo (imp<4, >60 dias).');
      if (!global.ctxForgetPending) global.ctxForgetPending = {};
      global.ctxForgetPending[ctx.from.id] = { ids: rows.map(r => r.id), reason: 'old (>60d, imp<4)' };
      return ctx.reply('⚠️ Deletar ' + rows.length + ' chunks antigos?\\nUse `/ctx_forget confirm` para confirmar.', {parse_mode:'Markdown'});
    }
    return ctx.reply('❌ Ação inválida. Use: /ctx_forget <ID> | source:<nome> | old | list | confirm');
  } catch(e) {
    console.error('[ctx_forget] Erro:', e.message);
    return ctx.reply('❌ Erro: ' + e.message);
  } finally {
    db.close();
  }
});

// V90-NEW-G — /osint defensivo
bot.command('osint', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const args = ctx.message.text.slice(7).trim().split(' ');
  const subcmd = args[0];
  const target = args[1];
  if (!subcmd || !target) return ctx.reply('Uso: /osint dns <dominio> | headers <dominio> | email <email>');
  const { checkDNS, checkHeaders, checkHIBP, WARNING } = require('./core/osint');
  try {
    let out = '🔍 *OSINT Defensivo*\\n\\n';
    if (subcmd === 'dns') {
      const data = await checkDNS(sanitizeDomain(target));
      if (data.error) return ctx.reply('❌ ' + data.error);
      out += '*DNS: ' + target + '*\\nA: ' + (data.a.join(', ') || 'N/A') + '\\nMX: ' + (data.mx.join(', ') || 'N/A') + '\\nTXT: ' + (data.txt.length || 0) + ' registros\\n';
    } else if (subcmd === 'headers') {
      const data = await checkHeaders(sanitizeDomain(target));
      if (data.error) return ctx.reply('❌ ' + data.error);
      out += '*Headers: ' + target + '*\\n';
      Object.entries(data.checks).forEach(([k,v]) => { out += (v ? '✅' : '❌') + ' ' + k + '\\n'; });
    } else if (subcmd === 'email') {
      const data = await checkHIBP(sanitizeEmail(target));
      if (data.error) return ctx.reply('❌ ' + data.error);
      out += '*Email: ' + target + '*\\n' + (data.breached ? '🔴 Vazado em: ' + data.breaches.join(', ') : '🟢 Não encontrado em vazamentos') + '\\n';
    } else {
      return ctx.reply('❌ Sub-comando inválido. Use: dns, headers, email');
    }
    out += '\\n' + WARNING;
    return ctx.reply(out, {parse_mode:'Markdown'});
  } catch(e) { return ctx.reply('❌ Erro: ' + e.message); }
});

// AI-Driven Attack Simulator
// DISABLED bot.command('aiattack', async (ctx) => {
// DISABLED   if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
// DISABLED   const t = throttle(ctx.from.id, '/aiattack');
// DISABLED   if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's antes de usar /aiattack novamente.');
// DISABLED   
// DISABLED   const raw = ctx.message.text.slice(10).trim();
// DISABLED   if (!raw) return ctx.reply('Uso: /aiattack <target> <scenario>\nCenários: credential_exfiltration, phishing_campaign, supply_chain, ransomware_sim, lateral_movement, persistence');
// DISABLED   
// DISABLED   const parts = raw.split(' ');
// DISABLED   const target = parts[0];
// DISABLED   const scenario = parts[1] || 'credential_exfiltration';
// DISABLED   
// DISABLED   try {
// DISABLED     const result = aiAttack.simulateAttack(target, scenario);
// DISABLED     let out = '🎯 *Ataque Simulado — ' + target + '*\n\n';
// DISABLED     out += '*Cenário:* ' + scenario + '\n';
// DISABLED     out += '*Fases:*\n';
// DISABLED     if (result.phases) {
// DISABLED       result.phases.forEach(p => {
// DISABLED         out += '  • ' + p.phase + ' (' + p.technique + ') — ' + p.status + '\n';
// DISABLED       });
// DISABLED     }
// DISABLED     return ctx.reply(out);
// DISABLED   } catch(e) {
// DISABLED     return ctx.reply('❌ Erro: ' + e.message);
// DISABLED   }
// DISABLED });
// DISABLED 
// [REMOVIDO V9.0-SEC] /aimonitor removido

// [REMOVIDO V9.0-SEC] /aianalyze removido

// V90-NEW-H — Pipeline Hacking Integrado
// DISABLED bot.command('hackflow', async (ctx) => {
// DISABLED   if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
// DISABLED   const t = throttle(ctx.from.id, '/hackflow');
// DISABLED   if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's antes de usar /hackflow novamente.');
// DISABLED   
// DISABLED   const target = ctx.message.text.slice(9).trim();
// DISABLED   if (!target) return ctx.reply('Uso: /hackflow <dominio> [scenario]\nEx: /hackflow example.com credential_exfiltration');
// DISABLED   
// DISABLED   const args = target.split(' ');
// DISABLED   const domain = args[0];
// DISABLED   const scenario = args[1] || 'credential_exfiltration';
// DISABLED   
// DISABLED   ctx.reply('🔴 *HackFlow iniciado — ' + domain + '*\n⏳ Executando pipeline: recon → scan → osint → attack → analyze...', { parse_mode: 'Markdown' });
// DISABLED   
// DISABLED   try {
// DISABLED     const results = await hackflow.run(domain, scenario);
// DISABLED     const report = hackflow.formatReport(results);
// DISABLED     
// DISABLED     // Enviar relatório em partes se for muito longo
// DISABLED     if (report.text.length > 4000) {
// DISABLED       await ctx.reply(report.text.slice(0, 4000));
// DISABLED       await ctx.reply(report.text.slice(4000));
// DISABLED     } else {
// DISABLED       await ctx.reply(report.text);
// DISABLED     }
// DISABLED     
// DISABLED     // HITL: Se risco > 80, perguntar sobre payload educacional
// DISABLED     if (report.riskScore > 80) {
// DISABLED       return ctx.reply('🚨 *Risco Crítico Detectado*', {
// DISABLED         reply_markup: {
// DISABLED           inline_keyboard: [[
// DISABLED             { text: '🎯 Gerar Payload Educativo', callback_data: 'hackflow_payload_' + domain.replace(/\./g, '_') },
// DISABLED             { text: '✅ Finalizar', callback_data: 'hackflow_done_' + domain.replace(/\./g, '_') }
// DISABLED           ]]
// DISABLED         }
// DISABLED       });
// DISABLED     }
// DISABLED     
// DISABLED   } catch(e) {
// DISABLED     console.error('[hackflow] ERRO:', e.message);
// DISABLED     return ctx.reply('❌ Erro no pipeline: ' + e.message);
// DISABLED   }
// DISABLED });
// DISABLED 
// DISABLED // V90-NEW-A — Trimmer TLDR (compressão de memória)
bot.command('trimmer', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/trimmer');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's antes de usar /trimmer novamente.');
  
  ctx.reply('🧹 *Trimmer TLDR iniciado*\\n⏳ Analisando chunks e memórias antigas...', { parse_mode: 'Markdown' });
  
  try {
    const docsResult = await trimmer.trimDocuments();
    const memResult = await trimmer.trimMemory();
    
    let out = '🧹 *Trimmer TLDR — Resultado*\\n\\n';
    out += '📄 *Documentos:*\\n';
    out += '  TLDRs criados: ' + docsResult.compressed + '\\n';
    out += '  Chunks removidos: ' + docsResult.deleted + '\\n\\n';
    out += '🧠 *Memórias:*\\n';
    out += '  Removidas: ' + memResult.deleted + '\\n\\n';
    out += '✅ Limpeza concluída. Chunks antigos foram comprimidos via LLM.';
    
    return ctx.reply(out, { parse_mode: 'Markdown' });
  } catch(e) {
    console.error('[trimmer] ERRO:', e.message);
    return ctx.reply('❌ Erro no trimmer: ' + e.message);
  }
});

// V90-NEW-Q — Auto-Healing Chunks
bot.command('heal', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/heal');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's antes de usar /heal novamente.');
  
  ctx.reply('🔧 *Auto-Healer iniciado*\\n⏳ Verificando chunks órfãos, antigos e duplicados...', { parse_mode: 'Markdown' });
  
  try {
    const result = await healer.main();
    
    let out = '🔧 *Auto-Healer — Resultado*\\n\\n';
    out += '✅ *Órfãos deletados:* ' + result.orphans + '\\n';
    out += '📦 *Chunks arquivados:* ' + result.archived + '\\n';
    out += '🗑️ *Duplicados removidos:* ' + result.duplicates + '\\n\\n';
    out += '⚠️ Chunks arquivados ficam ocultos nas buscas mas preservam conhecimento.';
    
    return ctx.reply(out, { parse_mode: 'Markdown' });
  } catch(e) {
    console.error('[heal] ERRO:', e.message);
    return ctx.reply('❌ Erro no healer: ' + e.message);
  }
});

// V90-NEW-W — /schedule
bot.command('schedule', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/schedule');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's.');
  
  const raw = ctx.message.text.replace('/schedule', '').trim();
  if (!raw || raw === 'list') {
    const list = scheduler.listSchedules(ctx.from.id.toString());
    if (!list.length) return ctx.reply('📅 Nenhum agendamento ativo.');
    let out = '📅 *Agendamentos ativos:*\n\n';
    list.forEach((s, i) => {
      const when = new Date(s.next_run).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      out += `${i+1}. ${s.action} — ${s.cron} — prox: ${when}\n`;
    });
    return ctx.reply(out, { parse_mode: 'Markdown' });
  }
  
  if (raw.startsWith('delete ')) {
    const id = parseInt(raw.replace('delete ', '').trim(), 10);
    const result = scheduler.deleteSchedule(id, ctx.from.id.toString());
    return ctx.reply(result.ok ? `✅ Agendamento #${id} removido.` : '❌ ' + result.error);
  }
  
  // Parse: /schedule <acao> <cron>
  // Ex: /schedule briefing daily=09:00
  const parts = raw.split(' ');
  if (parts.length < 2) {
    return ctx.reply('Uso: /schedule <acao> <cron>\nEx: /schedule briefing daily=09:00\n     /schedule leads weekly=1:14:30');
  }
  const cron = parts.pop();
  const action = parts.join(' ');
  const result = scheduler.addSchedule(ctx.from.id.toString(), action, cron);
  if (result.error) return ctx.reply('❌ ' + result.error);
  return ctx.reply(`📅 Agendamento #${result.id} criado.\nAcao: ${action}\nProxima execucao: ${new Date(result.nextRun).toLocaleString('pt-BR')}`);
});

// V90-NEW-Y — /export
bot.command('export', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/export');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's.');
  
  const raw = ctx.message.text.replace('/export', '').trim().toLowerCase();
  if (!raw || !['leads', 'fin'].includes(raw)) {
    return ctx.reply('Uso: /export <leads|fin>\nEx: /export leads');
  }
  
  const result = raw === 'leads' ? exporter.exportLeads() : exporter.exportFin();
  if (result.error) return ctx.reply('❌ ' + result.error);
  
  const tmpPath = '/tmp/' + result.filename;
  require('fs').writeFileSync(tmpPath, result.csv);
  await ctx.replyWithDocument({ source: tmpPath, filename: result.filename });
  require('fs').unlinkSync(tmpPath);
  return ctx.reply(`✅ ${result.count} registros exportados.`);
});

// V90-NEW-R — /reminder
bot.command('reminder', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/reminder');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's.');
  
  const raw = ctx.message.text.replace('/reminder', '').trim();
  if (!raw) {
    const list = reminder.listReminders(ctx.from.id.toString());
    if (!list.length) return ctx.reply('⏰ Nenhum lembrete ativo.');
    let out = '⏰ *Lembretes ativos:*\n\n';
    list.forEach((r, i) => {
      const when = new Date(r.trigger_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      out += `${i+1}. ${r.message} — ${when}\n`;
    });
    return ctx.reply(out, { parse_mode: 'Markdown' });
  }
  
  // Parse: /reminder <minutos> <mensagem>
  const parts = raw.split(' ');
  const minutes = parseInt(parts[0], 10);
  if (isNaN(minutes) || minutes < 1) {
    return ctx.reply('Uso: /reminder <minutos> <mensagem>\nEx: /reminder 30 Revisar proposta');
  }
  const message = parts.slice(1).join(' ') || 'Lembrete sem descricao';
  const result = reminder.addReminder(ctx.from.id.toString(), message, minutes);
  return ctx.reply(`⏰ Lembrete #${result.id} agendado para ${minutes} minuto(s).`);
});


// V90-NEW-VOICE — /falar <texto>
bot.command('falar', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/falar');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's.');

  const texto = ctx.message.text.replace('/falar', '').trim();
  if (!texto) return ctx.reply('🎙️ *Falar*\n\nUso: /falar <texto>\n\nConverte texto em voz usando Edge-TTS.\nLimite: 500 caracteres.', { parse_mode: 'Markdown' });

  try {
    await ctx.reply('🎙️ Sintetizando voz...');
    const { buffer, truncated } = await tts.synthesize(texto);
    const caption = truncated ? '⚠️ Texto truncado para 500 caracteres.' : '';
    await ctx.replyWithVoice({ source: buffer }, { caption });
  } catch (e) {
    console.error('[TTS] Erro:', e.message);
    await ctx.reply('⚠️ Voz indisponivel no momento. Texto: ' + texto);
  }
});


// V90-NEW-APRENDER — /aprender
bot.command('aprender', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔ Acesso negado.');
  const t = throttle(ctx.from.id, '/aprender');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's.');

  const raw = ctx.message.text.replace('/aprender', '').trim();
  if (!raw) {
    return ctx.reply('📚 *Aprender*\n\nUso: /aprender <subcomando> <args>\n\nSub-comandos:\n• topico <tema> — explicacao direta + exercicio\n• testar <tema> — quiz interativo\n• revisar — revisa topicos pendentes\n• feynman <texto> — avalia sua explicacao\n• salvar <tema> — salva para revisao espacada\n• status — lista seus topicos', { parse_mode: 'Markdown' });
  }

  const parts = raw.split(' ');
  const sub = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const userId = ctx.from.id.toString();
  const { ask } = require('./core/llm');

  try {
    switch (sub) {
      case 'topico': {
        if (!args) return ctx.reply('Uso: /aprender topico <tema>');
        await ctx.reply('🧠 Gerando explicacao...');
        const result = await learning.topicExplain(args, ask);
        return ctx.reply(result.text);
      }

      case 'testar': {
        if (!args) return ctx.reply('Uso: /aprender testar <tema>');
        await ctx.reply('📝 Gerando pergunta...');
        const test = await learning.testGenerate(args, ask);
        learning.setAwaiting(userId, { topic: args, question: test.question, correctAnswer: test.correctAnswer, attempts: 0 });
        return ctx.reply('📝 *Pergunta sobre "' + args + '":*\n\n' + test.question + '\n\n_Responda diretamente neste chat._', { parse_mode: 'Markdown' });
      }

      case 'revisar': {
        const due = learning.getDueReviews(userId);
        if (!due.length) return ctx.reply('✅ Nenhum topico pendente de revisao.');
        await ctx.reply('📚 ' + due.length + ' topico(s) para revisar. Gerando perguntas...');
        let out = '';
        for (const row of due) {
          const questions = await learning.generateReviewQuestions(row.topic, row.level, ask);
          out += '*' + row.topic + '* (nivel ' + row.level + '):\n' + questions + '\n\n';
          learning.completeReview(row.id);
        }
        return ctx.reply(out);
      }

      case 'feynman': {
        if (!args) return ctx.reply('Uso: /aprender feynman <sua explicacao>');
        await ctx.reply('🔍 Analisando sua explicacao...');
        const topic = args.split(' ')[0];
        const result = await learning.feynmanEvaluate(args, topic, ask);
        return ctx.reply('🔍 *Avaliacao Feynman:*\n\n' + result);
      }

      case 'salvar': {
        if (!args) return ctx.reply('Uso: /aprender salvar <tema>');
        const result = learning.saveTopic(userId, args);
        return ctx.reply('💾 Topico "' + args + '" salvo!\nProxima revisao: ' + new Date(result.nextReview).toLocaleString('pt-BR'));
      }

      case 'status': {
        const rows = learning.getStatus(userId);
        if (!rows.length) return ctx.reply('📭 Nenhum topico salvo. Use /aprender salvar <tema>');
        let out = '📚 *Seus topicos:*\n\n';
        rows.forEach((r, i) => {
          const when = new Date(r.next_review).toLocaleDateString('pt-BR');
          const stars = '⭐'.repeat(r.level + 1);
          out += (i+1) + '. ' + r.topic + ' ' + stars + ' — revisar em ' + when + '\n';
        });
        return ctx.reply(out);
      }

      default:
        return ctx.reply('❓ Sub-comando desconhecido. Use /aprender sem args para ver opcoes.');
    }
  } catch(e) {
    console.error('[APRENDER] Erro:', e.message);
    return ctx.reply('❌ Erro ao processar: ' + e.message);
  }
});



// V90-NEW-APRENDER: interceptar respostas de /aprender testar

// V90-NEW-STT — Handler de mensagens de voz (voice -> texto -> LLM -> voz)
// Validacao: max 5 minutos de duracao, max 10MB de arquivo
bot.on('voice', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;
  const t = throttle(ctx.from.id, '/voice');
  if (t.throttled) return ctx.reply('⏳ Aguarde ' + t.waitSeconds + 's.');

  const MAX_DURATION = 300; // 5 minutos
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const voice = ctx.message.voice;
  if (voice.duration && voice.duration > MAX_DURATION) {
    return ctx.reply('❌ Audio muito longo (' + voice.duration + 's). Limite: ' + MAX_DURATION + 's (5 minutos).');
  }
  if (voice.file_size && voice.file_size > MAX_FILE_SIZE) {
    return ctx.reply('❌ Arquivo muito grande (' + Math.round(voice.file_size / 1024 / 1024) + 'MB). Limite: 10MB.');
  }

  try {
    await ctx.reply('🎙️ Ouvindo...');

    // 1. Baixar arquivo de voz
    const fileId = voice.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const ogaPath = '/tmp/voice_' + ctx.from.id + '_' + Date.now() + '.oga';

    const response = await require('axios').get(fileLink, { responseType: 'stream' });
    const fs = require('fs');
    const writer = fs.createWriteStream(ogaPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 2. Transcrever (Groq Whisper)
    await ctx.reply('📝 Transcrevendo...');
    const transcribed = await stt.transcribe(ogaPath);
    if (!transcribed || !transcribed.trim()) {
      fs.unlinkSync(ogaPath);
      return ctx.reply('❌ Nao consegui entender o audio. Tente novamente falando mais claro.');
    }

    await ctx.reply('🧠 Voce disse: "' + transcribed + '"');

    // 3. Pensar (LLM)
    await ctx.reply('🧠 Pensando...');
    const { ask } = require('./core/llm');
    const llmResponse = await ask(transcribed, { persona: 'default', maxTokens: 400 });

    // 4. Responder em voz (TTS)
    await ctx.reply('🎙️ Respondendo em voz...');
    const { buffer } = await tts.synthesize(llmResponse);
    await ctx.replyWithVoice({ source: buffer });

    // 5. Limpar temporarios
    try { fs.unlinkSync(ogaPath); } catch(e) {}

  } catch (e) {
    console.error('[VOICE] Erro:', e.message);
    await ctx.reply('❌ Erro ao processar audio: ' + e.message);
  }
});


bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const pending = learning.getAwaiting(userId);
  if (!pending) return;
  
  if (ctx.message.text.startsWith('/')) {
    learning.clearAwaiting(userId);
    return;
  }
  
  const userAnswer = ctx.message.text.trim();
  pending.attempts++;
  
  try {
    const { ask } = require('./core/llm');
    const evalResult = await learning.testEvaluate(userAnswer, pending.correctAnswer, pending.topic, ask);
    
    if (evalResult.correct) {
      learning.clearAwaiting(userId);
      return ctx.reply('✅ *Correto!*' + String.fromCharCode(10) + String.fromCharCode(10) + evalResult.feedback + String.fromCharCode(10) + String.fromCharCode(10) + 'Resposta completa: ' + pending.correctAnswer, { parse_mode: 'Markdown' });
    }
    
    if (pending.attempts >= 2) {
      learning.clearAwaiting(userId);
      return ctx.reply('❌ *Resposta incorreta.*' + String.fromCharCode(10) + String.fromCharCode(10) + 'Dica: ' + evalResult.feedback + String.fromCharCode(10) + String.fromCharCode(10) + 'Resposta correta: ' + pending.correctAnswer, { parse_mode: 'Markdown' });
    }
    
    return ctx.reply('❌ ' + evalResult.feedback + String.fromCharCode(10) + String.fromCharCode(10) + 'Tente novamente! (tentativa ' + pending.attempts + '/2)', { parse_mode: 'Markdown' });
  } catch(e) {
    learning.clearAwaiting(userId);
    console.error('[APRENDER] Erro avaliacao:', e.message);
    return ctx.reply('❌ Erro ao avaliar resposta.');
  }
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

    if (tl === '/fin' || tl.startsWith('/fin ')) {
        // Não aplicar throttle em /fin zerar confirm (fluxo de confirmação)
        if (!tl.startsWith('/fin zerar confirm') && _checkThrottle('/fin')) return;
        return handleFinance(ctx, tl.replace('/fin', '').trim());
    }
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

    // V90-NEW-B — /leads status/followup/pipeline
    if (tl.startsWith('/leads status ')) {
        if (_checkThrottle('/leads')) return;
        const args = t.slice(14).trim().split(' ');
        const id = parseInt(args[0]);
        const resultado = args[1];
        const validos = ['aberto','contatado','proposta','fechado','perdido'];
        if (!id || !resultado || !validos.includes(resultado)) {
            return ctx.reply('Uso: /leads status <ID> <aberto|contatado|proposta|fechado|perdido>');
        }
        try {
            const db = new (require('better-sqlite3'))('./data/leads.db');
            const row = db.prepare('SELECT id, nome, resultado FROM leads WHERE id = ?').get(id);
            if (!row) { db.close(); return ctx.reply('❌ Lead #' + id + ' não encontrado.'); }
            db.prepare('UPDATE leads SET resultado = ? WHERE id = ?').run(resultado, id);
            db.close();
            return ctx.reply('✅ Lead #' + id + ' (' + row.nome + '): ' + row.resultado + ' → ' + resultado);
        } catch(e) { return ctx.reply('❌ Erro: ' + e.message); }
    }
    if (tl.startsWith('/leads followup ')) {
        if (_checkThrottle('/leads')) return;
        const args = t.slice(16).trim().split(' ');
        const id = parseInt(args[0]);
        const dataStr = args[1];
        if (!id || !dataStr) return ctx.reply('Uso: /leads followup <ID> <YYYY-MM-DD>');
        try {
            const db = new (require('better-sqlite3'))('./data/leads.db');
            const row = db.prepare('SELECT id, nome FROM leads WHERE id = ?').get(id);
            if (!row) { db.close(); return ctx.reply('❌ Lead #' + id + ' não encontrado.'); }
            db.prepare('UPDATE leads SET followup_ts = ? WHERE id = ?').run(dataStr + ' 09:00:00', id);
            db.close();
            return ctx.reply('📅 Follow-up agendado: Lead #' + id + ' (' + row.nome + ') → ' + dataStr);
        } catch(e) { return ctx.reply('❌ Erro: ' + e.message); }
    }
    if (tl === '/leads pipeline') {
        if (_checkThrottle('/leads')) return;
        try {
            const db = new (require('better-sqlite3'))('./data/leads.db');
            const rows = db.prepare('SELECT resultado, COUNT(*) as cnt FROM leads GROUP BY resultado ORDER BY cnt DESC').all();
            const total = db.prepare('SELECT COUNT(*) as cnt FROM leads').get().cnt;
            db.close();
            if (!rows.length) return ctx.reply('📭 Nenhum lead cadastrado.');
            let out = '📊 *Pipeline de Leads* (' + total + ' total)\\n\\n';
            const emojis = { aberto: '🔵', contatado: '🟡', proposta: '🟠', fechado: '🟢', perdido: '🔴' };
            let receitaTotal = 0;
            rows.forEach(r => {
                const pct = total > 0 ? Math.round((r.cnt / total) * 100) : 0;
                out += (emojis[r.resultado] || '⚪') + ' *' + r.resultado + '*: ' + r.cnt + ' (' + pct + '%)\\n';
            });
            try {
                const { FinanceStore } = require('./core/finance');
                const finance = new FinanceStore();
                const receita = finance.db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type='income' AND category='venda'").get();
                finance.db.close();
                receitaTotal = receita.total;
                if (receitaTotal > 0) {
                    out += '\\n💰 *Receita Gerada:* R$ ' + parseFloat(receitaTotal).toFixed(2);
                }
            } catch(e) { }
            return ctx.reply(out);
        } catch(e) { return ctx.reply('❌ Erro: ' + e.message); }
    }
    
    // V90-NEW-E — /leads converter <ID> <valor> <descricao>
    if (tl.startsWith('/leads converter ')) {
        if (_checkThrottle('/leads')) return;
        const args = t.slice(17).trim().split(' ');
        const id = parseInt(args[0]);
        const valor = parseFloat(args[1]);
        const descricao = args.slice(2).join(' ') || 'Conversão de lead';
        if (!id || isNaN(valor) || valor <= 0) {
            return ctx.reply('Uso: /leads converter <ID> <valor> <descricao>');
        }
        try {
            const db = new (require('better-sqlite3'))('./data/leads.db');
            const lead = db.prepare('SELECT id, nome, resultado, transaction_id FROM leads WHERE id = ?').get(id);
            if (!lead) { db.close(); return ctx.reply('❌ Lead #' + id + ' não encontrado.'); }
            if (lead.transaction_id) { db.close(); return ctx.reply('⚠️ Lead #' + id + ' já convertido (transação #' + lead.transaction_id + ').'); }
            
            const { FinanceStore } = require('./core/finance');
            const finance = new FinanceStore();
            const tx = finance.add('income', valor, 'venda', descricao, 'Lead: ' + lead.nome);
            finance.db.close();
            
            db.prepare('UPDATE leads SET resultado = ?, transaction_id = ? WHERE id = ?').run('fechado', tx.lastInsertRowid, id);
            db.close();
            
            return ctx.reply('✅ Lead #' + id + ' (' + lead.nome + ') convertido!\n💰 Receita: R$ ' + valor.toFixed(2) + '\n📝 Transação #' + tx.lastInsertRowid);
        } catch(e) {
            console.error('[leads converter] Erro:', e.message);
            return ctx.reply('❌ Erro: ' + e.message);
        }
    }
    
    // V90-NEW-U — Lead Brief automático via LLM
    if (tl.startsWith('/leads brief ')) {
        if (_checkThrottle('/leads')) return;
        const id = parseInt(t.slice(13).trim());
        if (!id) return ctx.reply('Uso: /leads brief <ID>');
        try {
            const db = new (require('better-sqlite3'))('./data/leads.db');
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
            db.close();
            if (!lead) return ctx.reply('❌ Lead #' + id + ' não encontrado.');
            
            const prompt = `Com base nesses dados de lead, gere um brief de prospecção conciso:
1. Dor provável (1 frase)
2. Gancho de abertura (1 frase)  
3. Objeção mais provável e resposta
4. Próximo passo recomendado

DADOS DO LEAD:
Nome: ${lead.nome}
Empresa: ${lead.empresa || 'N/A'}
Email: ${lead.email || 'N/A'}
Telefone: ${lead.telefone || 'N/A'}
Domínio: ${lead.dominio || 'N/A'}
Status: ${lead.resultado || 'aberto'}

Responda em português, direto e sem floreios.`;
            
            const { ask } = require('./core/llm');
            const brief = await ask(prompt, { persona: 'leads', maxTokens: 400, temperature: 0.3 });
            
            let out = '🎯 *Brief de Prospecção — ' + lead.nome + '*\\n\\n';
            out += brief;
            return ctx.reply(out);
        } catch(e) {
            console.error('[leads brief] Erro:', e.message);
            return ctx.reply('❌ Erro ao gerar brief: ' + e.message);
        }
    }
    
    if (tl.startsWith('/leads ')) { if (_checkThrottle('/leads')) return; return runLeads(ctx, t.slice(7)); }
    if (tl.startsWith('/exec ')) return triggerAndWait(ctx, t.slice(6), "⚙️...", "");
    if (tl === '/dolar') return triggerAndWait(ctx, `import requests\nprint(round(requests.get("https://open.er-api.com/v6/latest/USD").json()['rates']['BRL'],4))`, "💵...", "R$ ");
    if (tl === '/btc') return triggerAndWait(ctx, `import requests\nv=requests.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl").json()['bitcoin']['brl']\nprint(f"R$ {v:,.0f}".replace(",","."))`, "₿...", "");

    // V7.5 handlers
    // V80-11 — /help semantico
    if (tl === '/help' || tl.startsWith('/help ')) { if (_checkThrottle('/help')) return;
        const query = tl.replace('/help', '').trim();
        if (!query) {
            // Comportamento atual — intocavel
            const byCat = helpManifest.listByCategory();
            let text = '📖 Comandos disponíveis:\n\n';
            for (const [cat, cmds] of Object.entries(byCat)) {
                text += `*${cat}*\n${cmds.map(c => `  /${c.name} — ${c.description}`).join('\n')}\n\n`;
            }
            return ctx.reply(text);
        }
        // V80-11: resposta semantica via LLM
        const results = helpManifest.search(query);
        try {
            let prompt;
            if (results.length) {
                const cmdInfo = results[0];
                prompt = `Usuario perguntou: "${query}"\n\nComando encontrado: /${cmdInfo.name}\nDescricao: ${cmdInfo.description}\nCategoria: ${cmdInfo.category}\nExemplos: ${cmdInfo.examples ? cmdInfo.examples.join(', ') : 'nenhum'}\n\nComo assistente util, responda de forma natural e amigavel explicando como usar este comando. Inclua um exemplo pratico. Responda em portugues.`;
            } else {
                prompt = `Usuario perguntou: "${query}"\n\nNenhum comando especifico foi encontrado para esta pergunta.\n\nComo assistente util do MiniClawwork, responda de forma natural e amigavel. Se possivel, sugira comandos relacionados ou explique como o usuario pode conseguir o que deseja. Responda em portugues.`;
            }
            // V90-NEW-Z3 — Buscar no knowledge base como fallback/cruzamento
            let kbContext = '';
            let kbSource = null;
            try {
                const kdb = new (require('better-sqlite3'))('./data/knowledge/documents.db');
                const kbRows = kdb.prepare("SELECT dc.id, dc.document_id, dc.chunk_index, dc.content FROM document_chunks dc WHERE dc.content LIKE ?  ORDER BY dc.importance DESC LIMIT 3").all('%' + query + '%');
                if (kbRows.length) {
                    kbContext = '\n\nContexto do knowledge base:\n' + kbRows.map(r => `[Doc ${r.document_id}, chunk ${r.chunk_index}]: ${r.content.slice(0,200)}...`).join('\n');
                    kbSource = kbRows[0]; // Primeira fonte para citação
                }
                kdb.close();
            } catch(e) {
                console.error('[V90-NEW-Z3] KB search error:', e.message);
            }

            const finalPrompt = prompt + kbContext + (kbSource ? '\n\nINSTRUCAO: Ao final da resposta, cite a fonte: Fonte: Doc ID ' + kbSource.document_id + ', chunk ' + kbSource.chunk_index : '');
            const response = await llmSkill.askLLM(finalPrompt, { history: [], persona: 'Voce e um assistente util e direto. Explique comandos de forma simples com exemplos praticos. Se houver contexto do knowledge base, use-o para enriquecer a resposta e cite a fonte no final.', maxHistoryTurns: 3 });
            return ctx.reply(response, { parse_mode: 'Markdown' });
        } catch (e) {
            // Fallback: resposta estatica se LLM falhar
            if (results.length) {
                return ctx.reply(results.map(c => `/${c.name} — ${c.description}`).join('\n'));
            }
            return ctx.reply('Nenhum comando encontrado. Tente /help para ver a lista completa.');
        }
    }
    if (tl === '/git' || tl.startsWith('/git ')) { if (_checkThrottle('/git')) return;
        const guardResult = guard(ctx, '/git');
        if (guardResult.blocked) {
            return ctx.reply(`⛔ ${guardResult.reason === 'shell_injection_detected' ? 'Caracteres perigosos detectados.' : 'Comando inválido.'}`);
        }
        let subcmd = guardResult.sanitized.replace('/git', '').trim();
        if (!subcmd) return ctx.reply('Uso: /git <comando>');
        
        // V80-NEW-F: git output cap
        const subcmdLower = subcmd.toLowerCase();
        let isLog = false;
        if (subcmdLower.startsWith('log')) {
            isLog = true;
            if (!subcmd.includes('--oneline')) {
                subcmd += ' --oneline';
            }
            if (!subcmd.match(/-\d+/)) {
                subcmd += ' -20';
            }
        }
        
        try {
            const output = execSync(`git ${subcmd}`, { cwd: '/home/opc/miniclawwork-executor', encoding: 'utf8', timeout: 10000 });
            let lines = output.split('\n');
            const MAX_LINES = isLog ? 20 : 30;
            let truncated = false;
            let omitted = 0;
            if (lines.length > MAX_LINES) {
                omitted = lines.length - MAX_LINES;
                lines = lines.slice(0, MAX_LINES);
                truncated = true;
            }
            let finalOutput = lines.join('\n');
            if (truncated) {
                finalOutput += `\n... [truncado — ${omitted} linhas omitidas]`;
            }
            return ctx.reply(`\`\`\`\n${finalOutput.slice(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (e) {
            return ctx.reply(`❌ Erro: ${e.message}`);
        }
    }
    if (tl === '/corrigir' || tl.startsWith('/corrigir ')) { if (_checkThrottle('/corrigir')) return;
        let text = tl.replace('/corrigir', '').trim();
        
        // V90-NEW-C — Sub-comandos list e desfazer
        if (text === 'list') {
            const rows = corrections.listCorrections(10);
            if (!rows.length) return ctx.reply('📭 Nenhuma correção registrada.');
            let out = '📝 *Últimas correções:*\n\n';
            rows.forEach(r => {
                out += '`#' + r.id + '` | ' + r.ts + '\n  ' + r.preview + '...\n\n';
            });
            return ctx.reply(out);
        }
        if (text.startsWith('desfazer ')) {
            const id = parseInt(text.replace('desfazer', '').trim());
            if (!id) return ctx.reply('Uso: /corrigir desfazer <ID>');
            if (!global.corrigirConfirm) global.corrigirConfirm = {};
            if (!global.corrigirConfirm[ctx.from.id]) {
                global.corrigirConfirm[ctx.from.id] = { id, ts: Date.now() };
                return ctx.reply('⚠️ Deletar correção #' + id + '? Use `/corrigir confirm ' + id + '` para confirmar.', { parse_mode: 'Markdown' });
            }
            return ctx.reply('❌ Use `/corrigir confirm <ID>` para confirmar.');
        }
        if (text.startsWith('confirm ')) {
            const id = parseInt(text.replace('confirm', '').trim());
            if (!id) return ctx.reply('Uso: /corrigir confirm <ID>');
            const result = corrections.deleteCorrection(id);
            if (result.ok) {
                delete global.corrigirConfirm[ctx.from.id];
                return ctx.reply('✅ Correção #' + id + ' deletada.');
            }
            return ctx.reply('❌ ' + result.error);
        }
        
        // Comportamento original
        const pending = feedback.getAwaitingCorrection(ctx.from.id);
        if (pending) {
            text = `[Contexto Original: ${pending.originalQuery}]\n${text}`;
            feedback.deleteAwaitingCorrection(ctx.from.id);
        }
        if (!text) return ctx.reply('Uso: /corrigir <texto> | list | desfazer <ID> | confirm <ID>');
        const db = new (require('better-sqlite3'))('./data/knowledge/documents.db');
        corrections.init(db);
        const result = corrections.saveCorrection(text, db);
        db.close();
        return ctx.reply(result.success ? `✅ Correção #${result.id} gravada.` : `❌ Erro: ${result.error}`);
    }

    // V80-07 — /plan interrogação reversa


    // V80-07 — Interceptação de respostas do /plan
    if (planState.has(ctx.from.id)) {
        const userId = ctx.from.id;
        const state = planState.get(userId);
        const now = Date.now();
        
        // TTL 10min
        if (now - state.timestamp > 10 * 60 * 1000) {
            planState.delete(userId);
        } else {
            state.answers.push(t);
            state.step++;
            state.timestamp = now;
            
            if (state.step < 3) {
                return ctx.reply(`✅ Anotado.\n\n${state.step + 1}. ${state.questions[state.step].replace(/^\\d+\\.\\s*/, '')}\n\nResponda a próxima pergunta.`);
            } else {
                // Gerar plano final
                const context = state.questions.map((q, i) => `P${i+1}: ${q}\nR${i+1}: ${state.answers[i]}`).join('\n');
                const planPrompt = `Objetivo: ${state.objective}\n\n${context}\n\nComo estrategista, gere um plano de ação estruturado em Markdown com: 1. Resumo do objetivo, 2. 3-5 ações concretas, 3. Métricas de sucesso, 4. Próximos passos imediatos.`;
                
                try {
                    const plan = await llmSkill.askLLM(planPrompt, { history: [], persona: "Você é um estrategista de negócios. Gere planos claros, executáveis e em Markdown.", maxHistoryTurns: 3 });
                    
                    // Persistir em document_chunks
                    try {
                        const kdb = new (require('better-sqlite3'))('./data/knowledge/documents.db');
                        let docRow = kdb.prepare("SELECT id FROM documents WHERE filename = ? LIMIT 1").get('_planos_sinteticos');
                        let docId;
                        if (!docRow) {
                            const insertDoc = kdb.prepare("INSERT INTO documents (filename, content, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)");
                            const result = insertDoc.run('_planos_sinteticos', 'Documento sintético para planos gerados pelo /plan');
                            docId = result.lastInsertRowid;
                        } else {
                            docId = docRow.id;
                        }
                        const insertChunk = kdb.prepare("INSERT INTO document_chunks (document_id, chunk_index, content, importance, source) VALUES (?, ?, ?, ?, ?)");
                        insertChunk.run(docId, 0, plan, 7, 'plan');
                        kdb.close();
                    } catch (e) {
                        console.error('[V80-07] Erro ao persistir plano:', e.message);
                    }
                    
                    planState.delete(userId);
                    return ctx.reply(`📋 Plano Gerado\n\n${plan}\n\n✅ Plano gravado no banco de conhecimento (importância: 7).`, { parse_mode: 'Markdown' });
                } catch (e) {
                    planState.delete(userId);
                    return ctx.reply(`❌ Erro ao gerar plano: ${e.message}`);
                }
            }
        }
    }

    if (tl === '/plan' || tl.startsWith('/plan ')) { if (_checkThrottle('/plan')) return;
        const objective = tl.replace('/plan', '').trim();
        if (!objective) return ctx.reply('Uso: /plan <objetivo>\nExemplo: /plan prospectar clínicas odontológicas');
        
        // TTL 10min: limpar entries antigos
        const now = Date.now();
        for (const [uid, data] of planState.entries()) {
            if (now - data.timestamp > 10 * 60 * 1000) planState.delete(uid);
        }
        
        const userId = ctx.from.id;
        if (!planState.has(userId)) {
            const prompt = `Objetivo do usuário: ${objective}\n\nComo estrategista de negócios, faça 3 perguntas de clarificação curtas e objetivas para ajudar a estruturar um plano de ação. Retorne APENAS as 3 perguntas, uma por linha, numeradas.`;
            try {
                const questions = await llmSkill.askLLM(prompt, { history: [], persona: "Você é um estrategista de negócios direto e objetivo. Faça perguntas de clarificação curtas.", maxHistoryTurns: 3 });
                const qList = questions.split('\n').filter(q => q.trim()).slice(0, 3);
                planState.set(userId, { step: 0, answers: [], questions: qList, objective, timestamp: now });
                return ctx.reply(`🎯 Plano: ${objective}\n\n${qList.map((q, i) => `${i+1}. ${q.replace(/^\\d+\\.\\s*/, '')}`).join('\n')}\n\nResponda com a resposta da pergunta 1.`);
            } catch (e) {
                return ctx.reply(`❌ Erro ao gerar perguntas: ${e.message}`);
            }
        }
    }


    // V80-08 — /dump triagem
    if (tl === '/dump' || tl.startsWith('/dump ')) { if (_checkThrottle('/dump')) return;
        const text = tl.replace('/dump', '').trim();
        if (!text) return ctx.reply('Uso: /dump <texto para triagem>\nExemplo: /dump Preciso prospectar 50 clínicas odontológicas em Brasília...');
        
        try {
            const prompt = `Texto recebido: ${text}

Como assistente executivo, faça uma triagem deste texto em 3 seções:
1. RESUMO: síntese em 2-3 frases
2. PRÓXIMOS PASSOS: lista de ações concretas
3. ATENÇÃO: pontos críticos ou riscos

Retorne no formato exato:
📋 Resumo: ...
⚡ Próximos passos: ...
⚠️ Atenção: ...`;
            const triage = await llmSkill.askLLM(prompt, { history: [], persona: "Você é um assistente executivo direto e objetivo. Faça triagens executivas concisas.", maxHistoryTurns: 3 });
            
            try {
                const kdb = new (require('better-sqlite3'))('./data/knowledge/documents.db');
                let docRow = kdb.prepare("SELECT id FROM documents WHERE filename = ? LIMIT 1").get('_dump_sintetico');
                let docId;
                if (!docRow) {
                    const insertDoc = kdb.prepare("INSERT INTO documents (filename, content, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)");
                    const result = insertDoc.run('_dump_sintetico', 'Documento sintético para triagens do /dump');
                    docId = result.lastInsertRowid;
                } else {
                    docId = docRow.id;
                }
                const insertChunk = kdb.prepare("INSERT INTO document_chunks (document_id, chunk_index, content, importance, source) VALUES (?, ?, ?, ?, ?)");
                insertChunk.run(docId, 0, triage, 5, 'dump');
                kdb.close();
            } catch (e) {
                console.error('[V80-08] Erro ao persistir triagem:', e.message);
            }
            
            return ctx.reply(triage, { parse_mode: 'Markdown' });
        } catch (e) {
            return ctx.reply(`❌ Erro na triagem: ${e.message}`);
        }
    }

    // V90-NEW-O — Auto-sugestão forget se contexto grande
    if (conversationHistory.length >= 12 && conversationHistory.length % 6 === 0) {
      try {
        await ctx.telegram.sendMessage(ctx.chat.id, '🧠 Seu contexto acumulou ' + conversationHistory.length + ' mensagens. Limpar melhora as respostas.', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🧹 Limpar Contexto', callback_data: 'ctx_forget_auto_' + ctx.from.id },
              { text: '⏭️ Manter', callback_data: 'ctx_continue_' + ctx.from.id }
            ]]
          }
        });
      } catch(e) {
        console.error('[V90-NEW-O] Erro ao enviar botões:', e.message);
      }
    }

    const llmResponse = await agents.run(t, { history: conversationHistory, persona: state.activePersona || persona, maxHistoryTurns: MAX_HISTORY_TURNS });
    await sendLongReply(ctx, llmResponse); // V90-NEW-Z4 chunking
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
  const data = ctx.callbackQuery.data;
  
  // V90-NEW-Z2 — HITL lead score > 80
  if (data.startsWith('hitl_prospect_')) {
    const leadId = parseInt(data.replace('hitl_prospect_', ''));
    try {
      const db = new (require('better-sqlite3'))('./data/leads.db');
      const lead = db.prepare('SELECT id, nome, empresa, email, telefone, dominio, resultado FROM leads WHERE id = ?').get(leadId);
      if (!lead) { db.close(); return ctx.answerCbQuery('Lead não encontrado.'); }
      
      // Atualizar status para contatado
      db.prepare('UPDATE leads SET resultado = ? WHERE id = ?').run('contatado', leadId);
      db.close();
      
      await ctx.answerCbQuery('🚀 Prospecção iniciada!');
      await ctx.editMessageText('🚀 *Prospecção iniciada para ' + lead.nome + '*\nStatus: aberto → contatado', { parse_mode: 'Markdown' });
      
      // Gerar brief automaticamente
      const prompt = `Com base nesses dados de lead, gere um brief de prospecção conciso:
1. Dor provável (1 frase)
2. Gancho de abertura (1 frase)
3. Objeção mais provável e resposta
4. Próximo passo recomendado

DADOS DO LEAD:
Nome: ${lead.nome}
Empresa: ${lead.empresa || 'N/A'}
Email: ${lead.email || 'N/A'}
Telefone: ${lead.telefone || 'N/A'}
Domínio: ${lead.dominio || 'N/A'}
Status: contatado

Responda em português, direto e sem floreios.`;
      
      const { ask } = require('./core/llm');
      const brief = await ask(prompt, { persona: 'leads', maxTokens: 400, temperature: 0.3 });
      
      let out = '🎯 *Brief de Prospecção — ' + lead.nome + '*\n\n';
      out += brief;
      await ctx.reply(out, { parse_mode: 'Markdown' });
      return;
    } catch(e) {
      console.error('[HITL] Erro:', e.message);
      return ctx.answerCbQuery('❌ Erro: ' + e.message);
    }
  }
  
  if (data.startsWith('hitl_ignore_')) {
    const leadId = parseInt(data.replace('hitl_ignore_', ''));
    await ctx.answerCbQuery('⏭️ Lead ignorado.');
    await ctx.editMessageText('⏭️ Lead ignorado.', { parse_mode: 'Markdown' });
    return;
  }
  
  // [REMOVIDO V9.0-SEC] hackflow_payload_ e hackflow_done_ removidos — handlers ofensivos
  
  // V90-NEW-O — Auto-forget callback
  if (data.startsWith('ctx_forget_auto_')) {
    const targetUserId = data.replace('ctx_forget_auto_', '');
    if (ctx.from.id.toString() !== targetUserId) {
      return ctx.answerCbQuery('⛔ Não autorizado.');
    }
    conversationHistory = [];
    try {
      const mdb = new (require('better-sqlite3'))('./data/memory.db');
      const count = mdb.prepare('SELECT COUNT(*) as c FROM memories WHERE user_id = ?').get(targetUserId);
      mdb.prepare('DELETE FROM memories WHERE user_id = ?').run(targetUserId);
      mdb.close();
      await ctx.answerCbQuery('🧹 Contexto limpo!');
      await ctx.editMessageText('✅ Contexto limpo! ' + (count ? count.c : 0) + ' mensagens removidas.');
    } catch(e) {
      await ctx.answerCbQuery('❌ Erro ao limpar.');
    }
    return;
  }
  
  if (data.startsWith('ctx_continue_')) {
    const targetUserId = data.replace('ctx_continue_', '');
    if (ctx.from.id.toString() !== targetUserId) {
      return ctx.answerCbQuery('⛔ Não autorizado.');
    }
    await ctx.answerCbQuery('⏭️ Continuando...');
    await ctx.editMessageText('⏭️ Contexto mantido. O bot continuará usando o histórico atual (' + conversationHistory.length + ' msgs).');
    return;
  }
  
  await feedback.handleCallback(ctx, feedbackDb);
});




metrics.init();
initCache();

// V80-MENU — Auto-registro de comandos no BotFather + menu inline
bot.telegram.setMyCommands([
  { command: 'menu', description: 'Menu principal com todos os comandos' },
  { command: 'fin', description: 'Financeiro: registro de gastos/receitas' },
  { command: 'leads', description: 'Busca leads B2B por termo' },
  { command: 'status', description: 'Status do sistema e recursos' },
  { command: 'btc', description: 'Cotacao do Bitcoin em BRL' },
  { command: 'dolar', description: 'Cotacao do Dolar em BRL' },
  { command: 'ctx', description: 'Contexto: buscar no knowledge base' },
  { command: 'help', description: 'Ajuda semantica por termo' },
  { command: 'plan', description: 'Gerar plano de acao estrategico' },
  { command: 'git', description: 'Disparar workflow no GitHub' },
  { command: 'exec', description: 'Executar codigo Python inline' },
  { command: 'alertas', description: 'Listar alertas de cripto ativos' },
  { command: 'dominancia', description: 'Dominancia do BTC no mercado' },
  { command: 'corrigir', description: 'Corrigir ou ensinar algo ao bot' },
  { command: 'dump', description: 'Triar documentos do knowledge base' },
  { command: 'metrics', description: 'Metricas de uso dos comandos' },
  { command: 'cache', description: 'Estatisticas do cache LLM' },
  { command: 'recon', description: 'Reconhecimento de dominio (V80-14)' },
  { command: 'osint', description: 'Inteligencia OSINT (V80-14)' },
  { command: 'scan', description: 'Scan de portas e headers (V80-14)' },
  { command: 'payload', description: 'Payload educacional (V80-14)' },
  { command: 'report', description: 'Relatorio de seguranca (V80-14)' },
  { command: 'techdebt', description: 'Analise technical debt (V80-15)' },
  { command: 'hackpro', description: 'Hacker Pro Suite passive (V80-16)' },
  { command: 'apiarbitrage', description: 'APIs gratuitas de alto valor (V80-17)' },
  { command: 'domainflipper', description: 'Dominios expirados com potencial (V80-18)' },
  { command: 'newsletterhunter', description: 'Newsletters de nicho (V80-19)' },
  { command: 'templategen', description: 'Gerador de templates (V80-20)' },
  { command: 'promptmarket', description: 'Catalogo de prompts premium (V80-21)' },
  { command: 'leadscoring', description: 'Scoring BANT de leads (V80-22)' },
  { command: 'proposalgen', description: 'Gerador de propostas (V80-23)' },
  { command: 'invoicetrack', description: 'Rastreamento de faturas (V80-24)' }
]).then(() => console.log("[V80-MENU] Comandos registrados no BotFather"))
  .catch(e => console.error("[V80-MENU] Erro ao registrar comandos:", e.message));

// V90-NEW-A — Trimmer TLDR automático a cada 24h
setInterval(() => {
  console.log('[TRIMMER] Execução automática iniciada');
  trimmer.main().catch(e => console.error('[TRIMMER] Erro:', e.message));
}, 24 * 60 * 60 * 1000);

bot.launch({ dropPendingUpdates: true }).then(() => {
  console.log("MiniClawwork v3.9 online");
  require('./jobs/watchdog').start(bot);
  // V80-NEW-C — Relatorio semanal de feedback
  const { scheduleWeeklyReport } = require('./jobs/feedback-report');
  scheduleWeeklyReport(bot);
});
