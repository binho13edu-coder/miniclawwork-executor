const axios = require('axios');

const FACTUAL_PATTERNS = [
  /\bquem\b/,/\bonde\b/,/\bo que é\b/,/\bme fale\b/,/\bconte\b/,
  /\bhistória\b/,/\bcomo funciona\b/,/\bcolégio\b/,/\bescola\b/,
  /\buniversidade\b/,/\bempresa\b/,/\bcidade\b/,/\bbairro\b/,
  /\bo que são\b/,/\bexplique\b/,/\bdescreva\b/,/\bqual\b/,/\bmaior\b/,/\bmelhor\b/,/\bpor que\b/
];
const MATH_PATTERNS = [
  /\bcalcul/,/\braiz\b/,/\bsoma\b/,/\bdivid/,
  /\bmultipl/,/\bporcentagem\b/,/\bjuros\b/
];

const detectIntent = (t) => {
  const tl = t.toLowerCase();
  if (FACTUAL_PATTERNS.some(p => p.test(tl))) return 'factual';
  if (MATH_PATTERNS.some(p => p.test(tl))) return 'math';
  return 'chat';
};

const getMaxTokens = (t) => ({ factual: 400, math: 250, chat: 300 }[detectIntent(t)] ?? 250);

const PROVIDERS = [
  ['https://openrouter.ai/api/v1/chat/completions',          'OPENROUTER_API_KEY', 'mistralai/mistral-7b-instruct:free'],
  ['https://api.groq.com/openai/v1/chat/completions',        'GROQ_API_KEY',       'llama-3.3-70b-versatile'],
  ['https://integrate.api.nvidia.com/v1/chat/completions',   'NVIDIA_API_KEY',     'meta/llama-3.3-70b-instruct'],
  ['https://openrouter.ai/api/v1/chat/completions',          'OPENROUTER_API_KEY', 'meta-llama/llama-3.3-70b-instruct:free'],
  ['https://openrouter.ai/api/v1/chat/completions',          'OPENROUTER_API_KEY', 'mistralai/mistral-7b-instruct'],
];

const askLLM = async (t, { history, persona, maxHistoryTurns }) => {
  history.push({ role: 'user', content: t });
  const recent = history.slice(-(maxHistoryTurns * 2));
  const msgs = [{ role: "system", content: persona }, ...recent];
  const maxTok = getMaxTokens(t);

  const call = async (url, key, model) => {
    const res = await axios.post(url,
      { model, messages: msgs, temperature: 0.1, max_tokens: maxTok },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 12000 }
    );
    return res.data.choices[0].message.content;
  };

  for (const [url, envKey, model] of PROVIDERS) {
    const key = process.env[envKey];
    if (!key) continue;
    try {
      const ans = await call(url, key, model);
      history.push({ role: 'assistant', content: ans });
      return ans;
    } catch (e) {
      console.log(`[LLM:${model}]`, e.message);
    }
  }
  return '⚠️ Offline.';
};

module.exports = { askLLM, getMaxTokens, detectIntent };
