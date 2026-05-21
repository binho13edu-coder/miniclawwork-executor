const hooks = require('./hooks');

const queue = [];
let isProcessing = false;
let taskIdCounter = 0;

function add(taskFn, ctx, priority = 0) {
    queue.push({ taskFn, ctx, priority, id: taskIdCounter++ });
    queue.sort((a, b) => {
        if (a.priority === b.priority) return a.id - b.id;
        return a.priority - b.priority;
    });
    _process();
}

async function _process() {
    if (isProcessing) return;
    isProcessing = true;

    while (queue.length > 0) {
        const { taskFn, ctx } = queue.shift();
        let attempt = 0;
        let success = false;

        while (attempt < 2 && !success) {
            attempt++;
            try {
                await hooks.trigger('preCommand', ctx, { taskId: taskIdCounter });
                await taskFn(ctx);
                await hooks.trigger('postCommand', ctx, { taskId: taskIdCounter });
                success = true;
            } catch (error) {
                await hooks.trigger('onError', ctx, { error: error.message, taskId: taskIdCounter });
                if (attempt === 1) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
    }

    isProcessing = false;
}

function size() {
    return queue.length;
}

function clear() {
    queue.length = 0;
}

module.exports = {
    add,
    process: _process,
    size,
    clear
};
