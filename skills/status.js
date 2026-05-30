const { execSync } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { getLastJobSummary } = require('../core/job-steps');

const ALLOWED = ['pm2 jlist'];
const JOBS_DB = path.join(__dirname, '..', 'data', 'jobs.db');

function runSafe(cmd) {
  const c = cmd.trim();
  if (!ALLOWED.includes(c)) throw new Error('Comando nao permitido');
  return execSync(c, { encoding: 'utf8', timeout: 5000 });
}

function formatUptime(uptimeMs) {
  const s = Math.floor(uptimeMs / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getPm2Data() {
  try {
    const raw = runSafe('pm2 jlist');
    const list = JSON.parse(raw);
    const proc = list.find(p => p.name === 'miniclawwork-executor');
    if (!proc) return null;
    return {
      uptime: formatUptime(proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0),
      mem: (proc.monit.memory / 1024 / 1024).toFixed(1),
      cpu: proc.monit.cpu,
      status: proc.pm2_env.status,
      restarts: proc.pm2_env.restart_time
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getJobStepsBreakdown() {
  try {
    const summary = getLastJobSummary();
    if (!summary) return null;
    const { total, ok, failed, failedSteps } = summary;
    if (failed === 0) return `Último job: ${ok}/${total} steps OK`;
    return `Último job: ${ok}/${total} steps (${failedSteps}: falhou)`;
  } catch (e) {
    return null;
  }
}

function getJobsData() {
  try {
    const db = new Database(JOBS_DB);
    const row = db.prepare("SELECT name,last_run,status FROM jobs WHERE name='daily-briefing'").get();
    db.close();
    return row || { name: 'daily-briefing', last_run: null, status: null };
  } catch (e) {
    return { error: e.message };
  }
}

function buildStatus() {
  const pm2 = getPm2Data();
  const job = getJobsData();
  let msg = '📊 *Status do MiniClawwork*\n\n';
  if (pm2.error) {
    msg += `⚠️ PM2: ${pm2.error}\n`;
  } else {
    msg += `*PM2:* ${pm2.status} | ⏱ ${pm2.uptime} | 🧠 ${pm2.mem}MB | 🔄 ${pm2.restarts}\n`;
  }
  const stepsBreakdown = getJobStepsBreakdown();
  if (stepsBreakdown) {
    msg += `*Steps:* ${stepsBreakdown}\n`;
  }
  if (job.error) {
    msg += `⚠️ Jobs: ${job.error}\n`;
  } else if (job.last_run) {
    const d = new Date(job.last_run);
    msg += `*Briefing:* ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR')}\n`;
    msg += `*Status job:* ${job.status}\n`;
  } else {
    msg += `*Briefing:* ainda nao executado\n`;
  }
  msg += '\n✅ Sistema operacional';
  return msg;
}

module.exports = { buildStatus };
