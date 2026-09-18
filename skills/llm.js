const { ask } = require('../core/llm');

const FACTUAL_PATTERNS = [/\bquem\b/, /\bonde\b/, /\bo que é\b/, /\bexplique\b/, /\bqual\b/];
const MATH_PATTERNS = [/\bcalcul/, /\braiz\b/, /\bsoma\b/, /\bdivid/, /\bmultipl/, /\bporcentagem\b/, /\bjuros\b/, /\bprobabilidade\b/, /\bposterior\b/, /\bbayes\b/, /%/, /r\$/];

const detectIntent = (text) => {
  const normalized = String(text || '').toLowerCase();
  if (MATH_PATTERNS.some(pattern => pattern.test(normalized))) return 'math';
  if (FACTUAL_PATTERNS.some(pattern => pattern.test(normalized))) return 'factual';
  return 'chat';
};

const getMaxTokens = (text) => ({ factual: 400, math: 360, chat: 300 }[detectIntent(text)] ?? 300);

async function askLLM(text, options = {}) {
  const history = Array.isArray(options.history) ? options.history : [];
  const response = await ask(text, {
    history,
    persona: options.persona,
    maxHistoryTurns: options.maxHistoryTurns ?? 3,
    maxTokens: getMaxTokens(text),
    model: options.model
  });
  history.push({ role: 'user', content: text });
  history.push({ role: 'assistant', content: response });
  return response;
}

module.exports = { askLLM, getMaxTokens, detectIntent };
