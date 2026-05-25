// core/router.js — wrapper mínimo para o OIS
const { router, getSoulPrompt } = require('./llm');

async function handle(input) {
  const messages = typeof input === 'string'
    ? [{ role: 'user', content: input }]
    : input;
  
  const soul = getSoulPrompt();
  if (soul) {
    messages.unshift({ role: 'system', content: soul });
  }
  
  const result = await router.chat(messages);
  return typeof result === 'object' ? result.content : result;
}

module.exports = { handle };