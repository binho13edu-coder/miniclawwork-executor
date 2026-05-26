const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const metrics = require('../core/metrics');

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

function start(bot) {
    if (timer) {
        console.warn('[Watchdog] Ja iniciado, ignorando chamada dupla');
        return;
    }
    
    timer = setInterval(() => {
        checkMemory(bot);
        checkFailedJobs(bot);
        metrics.checkDegradation(bot);
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
