/**
 * core/hooks.js
 * Simple asynchronous event hook system for MiniClawwork.
 */

const registry = new Map();

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

    for (const fn of handlers) {
        try {
            await fn(ctx, data);
        } catch (error) {
            console.error(`[HOOK ERROR] Hook '${name}' failed:`, error.message);
        }
    }
}

function list() {
    return Array.from(registry.keys());
}

module.exports = {
    register,
    trigger,
    list
};
