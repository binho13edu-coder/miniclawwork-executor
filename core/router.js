// core/router.js — wrapper mínimo para o OIS
// Usa a instância router já exportada por core/llm.js

const { router } = require('./llm');

async function handle(text) {
  return await router.chat(text);
}

module.exports = { handle };
