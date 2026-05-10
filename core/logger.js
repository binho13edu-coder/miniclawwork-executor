/**
 * core/logger.js — MiniClawwork V6.3
 * Logger centralizado com niveis, timestamp e rotacao diaria
 */

const fs   = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const LOG_DIR   = process.env.LOG_DIR   || path.join(__dirname, '../logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const MIN_LEVEL = LEVELS[LOG_LEVEL] ?? 1;

function pad(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds());
}

function dateTag() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

function getLogPath() {
  return path.join(LOG_DIR, 'miniclawwork-' + dateTag() + '.log');
}

function writeToFile(line) {
  try {
    ensureLogDir();
    fs.appendFileSync(getLogPath(), line + '\n', 'utf8');
  } catch (e) {
    process.stderr.write('[Logger] Falha ao gravar log: ' + e.message + '\n');
  }
}

function formatLine(level, module, msg, meta) {
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  return '[' + timestamp() + '] [' + level.toUpperCase().padEnd(5) + '] [' + module + '] ' + msg + metaStr;
}

function log(level, module, msg, meta) {
  if ((LEVELS[level] ?? 0) < MIN_LEVEL) return;
  const line = formatLine(level, module, msg, meta);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
  writeToFile(line);
}

function pruneOldLogs(keepDays) {
  keepDays = keepDays || 7;
  try {
    const files = fs.readdirSync(LOG_DIR).filter(function(f) {
      return f.startsWith('miniclawwork-') && f.endsWith('.log');
    });
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const f of files) {
      const fullPath = path.join(LOG_DIR, f);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
        process.stdout.write('[Logger] Removed old log: ' + f + '\n');
      }
    }
  } catch (_) {}
}

class Logger {
  constructor(module) {
    this.module = module || 'app';
  }
  debug(msg, meta) { log('debug', this.module, msg, meta); }
  info(msg, meta)  { log('info',  this.module, msg, meta); }
  warn(msg, meta)  { log('warn',  this.module, msg, meta); }
  error(msg, meta) { log('error', this.module, msg, meta); }
  child(submodule) { return new Logger(this.module + ':' + submodule); }
}

function createLogger(module) { return new Logger(module); }

setImmediate(function() { pruneOldLogs(7); });

const rootLogger = createLogger('miniclawwork');

module.exports = { createLogger, rootLogger, Logger };
