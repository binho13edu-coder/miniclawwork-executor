const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function runHealthCheck({ root = process.cwd(), llmCheck, audit: runAudit = true } = {}) {
  const checks = {
    dependencies: fs.existsSync(path.join(root, 'node_modules')),
    lockfile: fs.existsSync(path.join(root, 'package-lock.json')),
    process: Number.isFinite(process.pid) && process.pid > 0,
  };

  let audit = { available: false, vulnerabilities: null };
  if (runAudit) {
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: root, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
    });
    const report = JSON.parse(stdout);
    audit = { available: true, vulnerabilities: report.metadata?.vulnerabilities || null };
  } catch (error) {
    try {
      const report = JSON.parse(error.stdout || '{}');
      audit = { available: true, vulnerabilities: report.metadata?.vulnerabilities || null };
    } catch (_) {}
  }
  }

  let llm = { available: false, response: null };
  if (typeof llmCheck === 'function') {
    try { llm = { available: true, response: String(await llmCheck()).trim() }; } catch (_) {}
  }

  const auditOk = !runAudit || (audit.available && (!audit.vulnerabilities || audit.vulnerabilities.total === 0));
  return {
    ok: Object.values(checks).every(Boolean) && auditOk && (!llmCheck || llm.available),
    pid: process.pid, uptimeSeconds: Math.round(process.uptime()), checks, audit, llm,
  };
}

module.exports = { runHealthCheck };
