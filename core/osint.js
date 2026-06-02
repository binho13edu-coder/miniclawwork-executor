const dns = require('dns').promises;
const https = require('https');

const WARNING = "⚠️ Use apenas em domínios/emails que você possui ou tem autorização.";

async function checkDNS(domain) {
  try {
    const [a, mx, txt] = await Promise.all([
      dns.resolve4(domain).catch(() => []),
      dns.resolveMx(domain).catch(() => []),
      dns.resolveTxt(domain).catch(() => [])
    ]);
    return { a, mx: mx.map(m => m.exchange), txt: txt.flat().slice(0, 5) };
  } catch (e) {
    return { error: e.message };
  }
}

async function checkHeaders(domain) {
  return new Promise((resolve) => {
    const req = https.request('https://' + domain, { method: 'HEAD', timeout: 10000 }, (res) => {
      const h = res.headers;
      const checks = {
        'HSTS': !!h['strict-transport-security'],
        'X-Frame-Options': !!h['x-frame-options'],
        'X-Content-Type-Options': !!h['x-content-type-options'],
        'CSP': !!h['content-security-policy'],
        'X-XSS-Protection': !!h['x-xss-protection']
      };
      resolve({ checks, raw: Object.keys(h).slice(0, 10) });
    });
    req.on('error', () => resolve({ error: 'Conexão falhou' }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
}

async function checkHIBP(email) {
  const key = process.env.HIBP_API_KEY;
  if (!key) return { error: 'HIBP_API_KEY não configurada. Configure no .env para usar.' };
  try {
    const res = await fetch('https://haveibeenpwned.com/api/v3/breachedaccount/' + encodeURIComponent(email), {
      headers: { 'hibp-api-key': key, 'User-Agent': 'MiniClawwork-OSINT' }
    });
    if (res.status === 404) return { breached: false };
    if (!res.ok) return { error: 'HIBP API error: ' + res.status };
    const data = await res.json();
    return { breached: true, breaches: data.map(b => b.Name) };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { checkDNS, checkHeaders, checkHIBP, WARNING };
