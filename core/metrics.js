const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'metrics.db'));

function init() {
    try {
        db.prepare(`
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command TEXT,
                duration_ms INTEGER,
                ts DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } catch (err) {
        console.error('[Metrics] Error initializing table:', err);
    }
}

function track(command, durationMs) {
    try {
        db.prepare('INSERT INTO metrics (command, duration_ms) VALUES (?, ?)').run(command, durationMs);
    } catch (err) {
        console.error('[Metrics] Error tracking:', err);
    }
}

function getAverages(days = 7) {
    try {
        return db.prepare(`
            SELECT command, AVG(duration_ms) as avg_duration, COUNT(*) as call_count
            FROM metrics
            WHERE ts >= datetime('now', ?)
            GROUP BY command
        `).all(`-${days} days`);
    } catch (err) {
        console.error('[Metrics] Error getting averages:', err);
        return [];
    }
}

function checkDegradation(bot) {
    try {
        const baseline = db.prepare(`
            SELECT command, AVG(duration_ms) as avg_duration, COUNT(*) as call_count
            FROM metrics
            WHERE ts >= datetime('now', '-7 days')
            GROUP BY command
        `).all();

        const recent = db.prepare(`
            SELECT command, AVG(duration_ms) as avg_duration
            FROM metrics
            WHERE ts >= datetime('now', '-1 hour')
            GROUP BY command
        `).all();

        const OWNER_ID = parseInt(process.env.OWNER_ID);
        if (isNaN(OWNER_ID)) return;

        for (const r of recent) {
            const b = baseline.find(x => x.command === r.command);
            if (b && r.avg_duration > (b.avg_duration * 2) && b.call_count > 10) {
                const msg = `⚠️ [Watchdog] Degradação de latência\nCmd: ${r.command}\nRecente (1h): ${Math.round(r.avg_duration)}ms\nBaseline (7d): ${Math.round(b.avg_duration)}ms`;
                bot.telegram.sendMessage(OWNER_ID, msg).catch(err => console.error('[Metrics] Alert error:', err));
            }
        }
    } catch (err) {
        console.error('[Metrics] Error checking degradation:', err);
    }
}


function trackRetry() {
    try {
        db.prepare("INSERT INTO metrics (command, duration_ms) VALUES ('retry', 0)").run();
    } catch (err) {
        console.error('[Metrics] Error tracking retry:', err);
    }
}

module.exports = { init, track, trackRetry, getAverages, checkDegradation };
