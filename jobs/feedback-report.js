const Database = require('better-sqlite3');
const path = require('path');

const FEEDBACK_DB = path.join(__dirname, '..', 'data', 'feedback.db');
const METRICS_DB = path.join(__dirname, '..', 'data', 'metrics.db');

function generateWeeklyReport(bot, isTest = false) {
    try {
        const fdb = new Database(FEEDBACK_DB);
        const mdb = new Database(METRICS_DB);

        // Feedback negativo (down) dos ultimos 7 dias por comando
        const negativeRows = fdb.prepare(`
            SELECT command, COUNT(*) as cnt
            FROM feedback
            WHERE feedback_type = 'down'
              AND created_at >= datetime('now', '-7 days')
            GROUP BY command
        `).all();

        // Total de chamadas por comando dos ultimos 7 dias
        const totalRows = mdb.prepare(`
            SELECT command, COUNT(*) as cnt
            FROM metrics
            WHERE ts >= datetime('now', '-7 days')
              AND command NOT IN ('unknown', 'callback_query', 'document', 'text')
            GROUP BY command
        `).all();

        fdb.close();
        mdb.close();

        if (!totalRows.length) {
            if (isTest) console.log('[V80-NEW-C] Sem dados de metrics para o periodo.');
            return null;
        }

        // Montar mapa de negativos
        const negMap = {};
        for (const r of negativeRows) {
            negMap[r.command] = r.cnt;
        }

        let msg = '📊 Relatorio Semanal — Feedback' + String.fromCharCode(10) + String.fromCharCode(10);
        const degradation = [];

        for (const r of totalRows) {
            const cmd = r.command;
            const total = r.cnt;
            const neg = negMap[cmd] || 0;
            const pos = total - neg;
            const posPct = total > 0 ? Math.round((pos / total) * 100) : 0;
            const negPct = total > 0 ? Math.round((neg / total) * 100) : 0;

            const line = `${cmd}:    ✅ ${pos} (${posPct}%) | ❌ ${neg} (${negPct}%)`;
            msg += line + String.fromCharCode(10);

            if (negPct > 40) {
                degradation.push({ cmd, negPct });
            }
        }

        if (degradation.length) {
            msg += String.fromCharCode(10) + '⚠️ Degradacao detectada:' + String.fromCharCode(10);
            for (const d of degradation) {
                msg += `  /${d.cmd} (taxa ❌: ${d.negPct}%)` + String.fromCharCode(10);
            }
        }

        if (isTest) console.log('[V80-NEW-C] Relatorio gerado:\n' + msg);

        return msg;
    } catch (e) {
        console.error('[V80-NEW-C] Erro ao gerar relatorio:', e.message);
        return null;
    }
}

function scheduleWeeklyReport(bot) {
    const now = new Date();
    const day = now.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab
    const hour = now.getHours();

    // Calcular ms ate proxima segunda 8h BRT
    let daysUntilMonday = (1 - day + 7) % 7;
    if (daysUntilMonday === 0 && hour >= 8) {
        daysUntilMonday = 7; // ja passou, agendar proxima semana
    }
    const target = new Date(now);
    target.setDate(now.getDate() + daysUntilMonday);
    target.setHours(8, 0, 0, 0);

    const msUntil = target.getTime() - now.getTime();

    console.log(`[V80-NEW-C] Proximo relatorio agendado para: ${target.toISOString()}`);

    setTimeout(() => {
        const report = generateWeeklyReport(bot);
        if (report && process.env.OWNER_ID) {
            bot.telegram.sendMessage(parseInt(process.env.OWNER_ID), report).catch(err => {
                console.error('[V80-NEW-C] Erro ao enviar relatorio:', err.message);
            });
        }
        // Reagendar para proxima semana
        setInterval(() => {
            const r = generateWeeklyReport(bot);
            if (r && process.env.OWNER_ID) {
                bot.telegram.sendMessage(parseInt(process.env.OWNER_ID), r).catch(() => {});
            }
        }, 7 * 24 * 60 * 60 * 1000);
    }, msUntil);
}

module.exports = { generateWeeklyReport, scheduleWeeklyReport };
