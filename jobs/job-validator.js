function scheduleNextRun(retries) {
    const now = new Date();
    const backoffMinutes = Math.pow(2, retries);
    return new Date(now.getTime() + backoffMinutes * 60000).toISOString();
}

function validate(jobName, result, db) {
    try {
        const now = new Date().toISOString();
        let isSuccess = false;

        if (result instanceof Error) {
            isSuccess = false;
        } else if (result && typeof result === 'object' && 'success' in result) {
            isSuccess = result.success === true;
        } else {
            isSuccess = !!result;
        }

        if (isSuccess) {
            const nextRun = (result && (result.next_run || result.nextRun)) || null;
            
            db.prepare(`
                UPDATE jobs 
                SET status = 'success',
                    retries = 0,
                    locked = 0,
                    error = null,
                    error_log = null,
                    last_run = ?,
                    next_run = ?,
                    updated_at = ?
                WHERE name = ?
            `).run(now, nextRun, now, jobName);
        } else {
            const job = db.prepare('SELECT retries, max_retries FROM jobs WHERE name = ?').get(jobName);
            if (!job) {
                console.error(`[JobValidator] Job '${jobName}' not found in database.`);
                return;
            }

            const currentRetries = (job.retries || 0) + 1;
            const maxRetries = job.max_retries || 0;
            
            const errorMsg = (result && result.message) ? result.message : String(result);
            const errorLog = (result && result.stack) ? result.stack : null;

            if (currentRetries >= maxRetries) {
                db.prepare(`
                    UPDATE jobs 
                    SET status = 'max_retries_exceeded',
                        retries = ?,
                        locked = 0,
                        error = ?,
                        error_log = ?,
                        last_run = ?,
                        next_run = null,
                        updated_at = ?
                    WHERE name = ?
                `).run(currentRetries, errorMsg, errorLog, now, now, jobName);
            } else {
                const nextRun = scheduleNextRun(currentRetries);
                db.prepare(`
                    UPDATE jobs 
                    SET status = 'failed',
                        retries = ?,
                        locked = 0,
                        error = ?,
                        error_log = ?,
                        last_run = ?,
                        next_run = ?,
                        updated_at = ?
                    WHERE name = ?
                `).run(currentRetries, errorMsg, errorLog, now, nextRun, now, jobName);
            }
        }
    } catch (err) {
        console.error(`[JobValidator] Failed to validate job '${jobName}':`, err);
    }
}

module.exports = { validate, scheduleNextRun };
