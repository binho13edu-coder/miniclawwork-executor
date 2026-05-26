const { Markup } = require('telegraf');

const awaitingCorrections = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 minutos

function init(db) {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                message_id INTEGER,
                chat_id INTEGER,
                feedback_type TEXT,
                command TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        return true;
    } catch (error) {
        console.error('Error initializing feedback table:', error);
        return false;
    }
}

async function sendWithFeedback(ctx, text) {
    try {
        const markup = Markup.inlineKeyboard([
            Markup.button.callback('✅', 'feedback:up'),
            Markup.button.callback('❌', 'feedback:down')
        ]);
        
        const replyMarkup = markup.reply_markup ? markup.reply_markup : markup;
        
        await ctx.reply(text, { reply_markup: replyMarkup });
    } catch (error) {
        console.error('Error in sendWithFeedback:', error);
    }
}

async function handleCallback(ctx, db) {
    try {
        const callbackData = ctx.callbackQuery?.data;
        if (!callbackData || !callbackData.startsWith('feedback:')) return;

        const feedbackType = callbackData.split(':')[1];
        
        // Lazy migration
        init(db);

        const message = ctx.callbackQuery?.message;
        const messageId = message?.message_id || null;
        const chatId = message?.chat?.id || null;
        const userId = ctx.from?.id || null;
        
        let command = '';
        if (message?.text) {
            command = message.text.split(' ')[0] || '';
        }

        const stmt = db.prepare(`
            INSERT INTO feedback (user_id, message_id, chat_id, feedback_type, command)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userId, messageId, chatId, feedbackType, command);

        try {
            await ctx.answerCbQuery('Feedback registrado.');
        } catch (e) {
            console.error('Error answering callback query:', e);
        }

        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (e) {
            console.error('Error editing message reply markup:', e);
        }

        // Prompt de correção para feedback negativo
        if (feedbackType === 'down') {
            const originalQuery = message?.text || 'Sem contexto original';
            
            awaitingCorrections.set(userId, {
                awaitingCorrection: true,
                originalQuery,
                timestamp: Date.now()
            });

            try {
                await ctx.reply('❌ Resposta marcada como incorreta.\nDeseja corrigir? Responda:\n/corrigir <versão correta>');
            } catch (e) {
                console.error('[Feedback] Erro ao enviar prompt de correção:', e);
            }
        }

    } catch (error) {
        console.error('Error in handleCallback:', error);
        try {
            if (ctx.answerCbQuery) {
                await ctx.answerCbQuery('Erro ao registrar.');
            }
        } catch (e) {
            console.error('Error in answerCbQuery (fallback):', e);
        }
    }
}

function cleanupExpired() {
    const now = Date.now();
    for (const [userId, data] of awaitingCorrections.entries()) {
        if (now - data.timestamp > TTL_MS) {
            awaitingCorrections.delete(userId);
        }
    }
}

function getAwaitingCorrection(userId) {
    return awaitingCorrections.get(userId);
}

function deleteAwaitingCorrection(userId) {
    awaitingCorrections.delete(userId);
}

module.exports = {
    init,
    sendWithFeedback,
    handleCallback,
    cleanupExpired,
    getAwaitingCorrection,
    deleteAwaitingCorrection
};
