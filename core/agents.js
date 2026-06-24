const fs = require('fs');
const path = require('path');
// askLLM legacy removed — Actor usa ask() de core/llm.js com cascade
const { ask } = require('./llm.js'); // Actor + Critic

const LOG_FILE = path.join(__dirname, '..', 'data', 'critic-rejections.log');

function logRejection(prompt, response, reason) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}]
PROMPT: ${prompt}
RESPONSE: ${response}
CRITIC_REASON: ${reason}
--------------------------------------------------\n`;
  
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  } catch (err) {
    // Ignore logging errors silently
  }
}

function buildCriticPrompt(originalPrompt, response) {
  return `Você é um auditor de qualidade de respostas de IA. Avalie a resposta abaixo com base no prompt original do usuário.

Prompt original: "${originalPrompt}"

Resposta do agente: "${response}"

Critérios de rejeição (REJEITE se qualquer um for verdade):
1. A resposta contradiz a identidade SOUL.md (MiniClawwork, agente do Fabio, proibido mencionar Google/Meta/OpenAI/ChatGPT/Gemini/LLaMA/Bard/Claude como criadores)
2. A resposta contém nomes de empresas, pessoas, datas ou fatos INVENTADOS sem base factual
3. A resposta é incoerente com o prompt original (respondeu algo totalmente diferente do que foi perguntado)
4. A resposta assume identidade de outro assistente ("sou bot do Google", "sou Claude", "sou ChatGPT", etc.)

IMPORTANTE: "Não tenho dados suficientes para responder isso com precisão" é uma resposta VÁLIDA e CORRETA quando o agente não tem certeza sobre um fato. NÃO rejeite por isso.

Responda EXATAMENTE com uma única palavra:
- "OK" se a resposta passar em todos os critérios
- "REJECT: [motivo curto]" se falhar em qualquer critério`;
}

async function run(prompt, options = {}) {
  try {
    const { history, persona, maxHistoryTurns } = options;
    
    // Attempt 1
    let actorResponse = await ask(prompt, { history, persona, maxHistoryTurns });
    
    let criticEvaluation;
    try {
      criticEvaluation = await ask(buildCriticPrompt(prompt, actorResponse));
    } catch (e) {
      criticEvaluation = 'OK'; // Se critic falhar, aprova para não bloquear
    }
    
    if (criticEvaluation.startsWith('REJECT')) {
      logRejection(prompt, actorResponse, criticEvaluation);
      
      // Attempt 2
      actorResponse = await ask(prompt, { history, persona, maxHistoryTurns });
      
      try {
        criticEvaluation = await ask(buildCriticPrompt(prompt, actorResponse));
      } catch (e) {
        criticEvaluation = 'OK';
      }
      
      if (criticEvaluation.startsWith('REJECT')) {
        logRejection(prompt, actorResponse, criticEvaluation);
        return "Nao consegui processar agora. Tente em instantes.";
      }
    }
    
    return actorResponse;
  } catch (error) {
    return "Nao consegui processar agora. Tente em instantes.";
  }
}

module.exports = { run };
