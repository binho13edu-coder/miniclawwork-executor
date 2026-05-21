const { Markup } = require('telegraf');

function init(db) {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY,
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
        
        let command = '';
        if (message?.text) {
            command = message.text.split(' ')[0] || '';
        }

        const stmt = db.prepare(`
            INSERT INTO feedback (message_id, chat_id, feedback_type, command)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(messageId, chatId, feedbackType, command);

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

module.exports = {
    sendWithFeedback,
    handleCallback,
    init
};
