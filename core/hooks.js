/**
 * core/hooks.js
 * Simple asynchronous event hook system for MiniClawwork.
 * Audit logging integrated via setLogger().
 */

const registry = new Map();
let auditLogger = null;

function setLogger(logger) {
    auditLogger = logger;
}

function register(name, fn) {
    if (typeof fn !== 'function') {
        throw new Error(`Hook handler for '${name}' must be a function.`);
    }
    if (!registry.has(name)) {
        registry.set(name, []);
    }
    registry.get(name).push(fn);
}

async function trigger(name, ctx, data = {}) {
    const handlers = registry.get(name);
    if (!handlers || handlers.length === 0) return;

    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    for (const fn of handlers) {
        try {
            await fn(ctx, data);
            successCount++;
        } catch (error) {
            errorCount++;
            console.error(`[HOOK ERROR] Hook '${name}' failed:`, error.message);
        }
    }

    if (auditLogger) {
        auditLogger.info('hook:trigger', {
            hook: name,
            handlers: handlers.length,
            success: successCount,
            errors: errorCount,
            durationMs: Date.now() - startTime,
            userId: ctx?.from?.id
        });
    }
}

function list() {
    return Array.from(registry.keys());
}

module.exports = {
    register,
    trigger,
    list,
    setLogger
};
