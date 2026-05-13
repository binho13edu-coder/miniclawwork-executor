// core/router.js — wrapper mínimo para o OIS
const { router } = require('./llm');
async function handle(input) {
  const messages = typeof input === 'string'
    ? [{ role: 'user', content: input }]
    : input;
  const result = await router.chat(messages);
  return typeof result === 'object' ? result.content : result;
}
module.exports = { handle };
