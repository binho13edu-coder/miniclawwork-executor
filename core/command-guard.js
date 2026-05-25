const sanitize = require('./sanitize');

// === Throttle (V80-NEW-B) ===
const throttleMap = new Map();
const THROTTLE_WINDOWS = {
  '/leads': 60,
  '/ctx': 45,
  '/status': 10,
  '/help': 10,
  'default': 30
};

function throttle(userId, commandName) {
  const now = Date.now();
  const windowSecs = THROTTLE_WINDOWS[commandName] || THROTTLE_WINDOWS['default'];
  const windowMs = windowSecs * 1000;
  const key = `${userId}:${commandName}`;

  if (throttleMap.has(key)) {
    const lastUsed = throttleMap.get(key);
    const elapsedMs = now - lastUsed;
    if (elapsedMs < windowMs) {
      const waitSeconds = Math.ceil((windowMs - elapsedMs) / 1000);
      return { throttled: true, waitSeconds };
    }
  }

  throttleMap.set(key, now);
  _cleanupThrottleMap(now);
  return { throttled: false };
}

// Cleanup entradas com mais de 24h (executado a cada 100 chamadas)
let _cleanupCounter = 0;
function _cleanupThrottleMap(now) {
  _cleanupCounter++;
  if (_cleanupCounter < 100) return;
  _cleanupCounter = 0;
  const maxAge = 24 * 60 * 60 * 1000; // 24h
  for (const [key, ts] of throttleMap) {
    if (now - ts > maxAge) throttleMap.delete(key);
  }
}
// =============================

function guard(ctx, commandName) {
  try {
    let rawInput = '';
    if (ctx && ctx.message && typeof ctx.message.text === 'string') {
      rawInput = ctx.message.text;
    }

    if (commandName !== undefined && commandName !== null) {
      const validCmd = sanitize.command(commandName);
      if (!validCmd) {
        return { blocked: true, reason: 'invalid_command' };
      }
    }

    let sanitized = sanitize.text(rawInput);
    if (typeof sanitized !== 'string') {
      sanitized = '';
    }

    if (commandName === '/git' || commandName === 'git') {
      if (sanitized.length > 500) {
        sanitized = sanitized.substring(0, 500);
      }
      
      if (/[;|&$`\\]/.test(sanitized)) {
        return { blocked: true, reason: 'shell_injection_detected' };
      }
    }

    if (!sanitized || sanitized.trim() === '') {
      return {
        blocked: false,
        sanitized: '',
        original: rawInput,
        command: commandName || '',
        empty: true
      };
    }

    return {
      blocked: false,
      sanitized: sanitized,
      original: rawInput,
      command: commandName || ''
    };
  } catch (error) {
    console.error('Guard error:', error);
    return { blocked: true, reason: 'guard_error' };
  }
}

module.exports = { guard, throttle };
