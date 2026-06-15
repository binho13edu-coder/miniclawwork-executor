const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const metrics = require('../core/metrics');
const osint = require('../core/osint'); // V90-NEW-N + V90-NEW-X

const CHECK_INTERVAL = 300000; // 5 minutos
const COOLDOWN_TIME = 1800000; // 30 minutos
const MEMORY_LIMIT = 100 * 1024 * 1024; // 100MB

const alertHistory = new Map();
let timer = null;

function sendAlert(bot, type, message) {
    const now = Date.now();
    const lastAlert = alertHistory.get(type) || 0;
    
    if (now - lastAlert >= COOLDOWN_TIME) {
        alertHistory.set(type, now);
        console.log(`[${new Date().toISOString()}] ⚠️ [Watchdog] ${message}`);
        
        const ownerId = parseInt(process.env.OWNER_ID, 10);
        if (!isNaN(ownerId)) {
            bot.telegram.sendMessage(ownerId, `⚠️ [Watchdog] ${message}`).catch(err => {
                console.error('[Watchdog] Telegram Error:', err.message);
            });
        }
    }
}

function checkMemory(bot) {
    const rss = process.memoryUsage().rss;
    if (rss > MEMORY_LIMIT) {
        const mb = Math.round(rss / 1024 / 1024);
        sendAlert(bot, 'memory', `Memoria alta: ${mb}MB (limite: 100MB)`);
    }
}

function checkFailedJobs(bot) {
    const dbPath = path.join(__dirname, '..', 'data', 'jobs.db');
    if (!fs.existsSync(dbPath)) return;
    
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        
        const cols = db.prepare("PRAGMA table_info(jobs)").all();
        const hasStatus = cols.some(c => c.name === 'status');
        if (!hasStatus) {
            console.warn('[Watchdog] Schema jobs.db sem coluna status');
            db.close();
            return;
        }
        
        const result = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'fail'").get();
        
        if (result && result.count > 0) {
            sendAlert(bot, 'jobs', `${result.count} job(s) com status 'fail'`);
        }
        
        db.close();
    } catch (error) {
        console.error('[Watchdog] Database Error:', error.message);
        if (db) try { db.close(); } catch (e) {}
    }
}

let osintRunning = false;
async function processLeadsOSINT(bot) { // V90-NEW-N
  if (osintRunning) return;
  osintRunning = true;
  const dbPath = path.join(__dirname, '..', 'data', 'leads.db');
  if (!fs.existsSync(dbPath)) return;

  let db;
  try {
    db = new Database(dbPath);
    // Verificar se colunas existem
    const cols = db.prepare("PRAGMA table_info(leads)").all();
    const hasLastOsint = cols.some(c => c.name === 'last_osint');
    const hasTechStack = cols.some(c => c.name === 'tech_stack');
    if (!hasLastOsint || !hasTechStack) {
      db.close();
      return;
    }

    // Buscar leads elegíveis: score > 70 e last_osint > 7 dias ou NULL
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const leads = db.prepare(`
      SELECT id, domain, email, score FROM leads 
      WHERE (score > 70 OR score IS NULL) 
        AND (last_osint IS NULL OR last_osint < ?)
        AND (resultado = 'aberto' OR resultado IS NULL)
      ORDER BY score DESC NULLS LAST LIMIT 2
    `).all(sevenDaysAgo);

    if (!leads.length) {
      db.close();
      return;
    }

    for (const lead of leads) {
      const target = lead.domain || lead.email?.split('@')[1];
      if (!target) continue;

      console.log(`[Watchdog] OSINT para lead ${lead.id}: ${target}`);

      try {
        // V90-NEW-X: enriquecimento tecnográfico
        const tech = await osint.enrichTech(target);
        if (tech.stack.length) {
          db.prepare('UPDATE leads SET tech_stack = ? WHERE id = ?').run(JSON.stringify(tech.stack), lead.id);
          console.log(`[Watchdog] Tech stack: ${tech.stack.join(', ')}`);
        }

        // OSINT defensivo básico
        const dns = await osint.checkDNS(target);
        const headers = await osint.checkHeaders(target);
        
        // Salvar resultado e timestamp
        const osintResult = JSON.stringify({ dns, headers, tech: tech.stack, server: tech.server });
        db.prepare('UPDATE leads SET last_osint = CURRENT_TIMESTAMP WHERE id = ?').run(lead.id);
        
        // Alerta silencioso (sem spam — só log)
        console.log(`[Watchdog] Lead ${lead.id} enriquecido | DNS: ${dns.a?.length || 0} registros | Headers: ${Object.keys(headers.checks || {}).filter(k => headers.checks[k]).join(', ') || 'nenhum'}`);
      } catch(e) {
        console.error(`[Watchdog] Erro lead ${lead.id}:`, e.message);
        db.prepare('UPDATE leads SET last_osint = CURRENT_TIMESTAMP WHERE id = ?').run(lead.id);
      }
    }

    db.close();
  } catch(error) {
    console.error('[Watchdog] Leads OSINT Error:', error.message);
    if (db) try { db.close(); } catch (e) {}
  } finally {
    osintRunning = false;
  }
}

function start(bot) {
    if (timer) {
        console.warn('[Watchdog] Ja iniciado, ignorando chamada dupla');
        return;
    }
    
    timer = setInterval(() => {
        checkMemory(bot);
        checkFailedJobs(bot);
        metrics.checkDegradation(bot);
        processLeadsOSINT(bot).catch(e => console.error('[Watchdog] OSINT cycle error:', e.message));
    }, CHECK_INTERVAL);
    
    console.log(`[Watchdog] Iniciado — intervalo: ${CHECK_INTERVAL}ms, memoria limite: ${MEMORY_LIMIT / 1024 / 1024}MB`);
}

process.on('SIGTERM', () => {
    if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[Watchdog] Parado (SIGTERM)');
    }
});

module.exports = { start };
