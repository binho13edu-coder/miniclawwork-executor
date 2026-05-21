const sanitize = require('./sanitize');

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

module.exports = { guard };
