/**
 * core/learning.js — Modulo de aprendizado ativo (V90-NEW-APRENDER)
 * 6 sub-comandos: topico, testar, revisar, feynman, salvar, status
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const LEARNING_DB = path.join(__dirname, '..', 'data', 'jobs.db');

// Estado em memoria para /aprender testar (RAM-light)
const awaitingAnswer = new Map();

function initDb() {
  const dir = path.dirname(LEARNING_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(LEARNING_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      next_review DATETIME,
      level INTEGER DEFAULT 0,
      content TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_learning_user ON learning_topics(user_id);
    CREATE INDEX IF NOT EXISTS idx_learning_review ON learning_topics(next_review, user_id);
  `);
  return db;
}

// --- Sub-comando 1: topico ---
async function topicExplain(topic, askFn) {
  const prompt = 'Explica o tema "' + topic + '" de forma direta e pratica. Foca no que realmente importa (regra 80/20 Pareto). Inclui 1 exercicio de alto impacto que a pessoa pode fazer AGORA para aplicar. Sem teoria sem aplicacao. Responde em portugues. Maximo 400 tokens.';
  const result = await askFn(prompt, { persona: 'default', maxTokens: 400 });
  return { text: result, type: 'topico' };
}

// --- Sub-comando 2: testar ---
async function testGenerate(topic, askFn) {
  const prompt = 'Gera 1 pergunta sobre "' + topic + '" para testar conhecimento. A pergunta deve ser objetiva, com resposta clara. Formato: apenas a pergunta, sem resposta. Maximo 200 tokens.';
  const question = await askFn(prompt, { persona: 'default', maxTokens: 200 });
  const promptAnswer = 'Gera a resposta CORRETA e CONCISA para a pergunta: "' + question + '" sobre "' + topic + '". Responde em portugues. Maximo 150 tokens.';
  const correctAnswer = await askFn(promptAnswer, { persona: 'default', maxTokens: 150 });
  return { question, correctAnswer, topic, type: 'testar' };
}

async function testEvaluate(userAnswer, correctAnswer, topic, askFn) {
  const prompt = 'Avalia se a resposta do usuario esta correta. Tema: ' + topic + '. Resposta esperada: ' + correctAnswer + '. Resposta do usuario: ' + userAnswer + '. Responde APENAS com um JSON: {"correct": true/false, "feedback": "texto curto"}. Se errado, da uma dica sem revelar a resposta completa. Maximo 100 tokens no feedback.';
  const raw = await askFn(prompt, { persona: 'default', maxTokens: 150 });
  try {
    const json = raw.match(/\{[^}]+\}/);
    if (json) return JSON.parse(json[0]);
  } catch(e) {}
  const isCorrect = userAnswer.toLowerCase().split(' ').some(w => correctAnswer.toLowerCase().includes(w)) && userAnswer.length > 10;
  return { correct: isCorrect, feedback: isCorrect ? 'Correto!' : 'Nao esta completo. Tente novamente com mais detalhes.' };
}

// --- Sub-comando 3: revisar ---
function getDueReviews(userId) {
  const db = initDb();
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT id, topic, level, content FROM learning_topics WHERE user_id = ? AND next_review <= ? ORDER BY next_review ASC').all(userId, now);
  db.close();
  return rows;
}

async function generateReviewQuestions(topic, level, askFn) {
  const prompt = 'Gera 5 perguntas de revisao sobre "' + topic + '" para testar retencao: 2 faceis, 2 medias, 1 dificil. Formato numerado. Responde em portugues. Maximo 300 tokens.';
  return await askFn(prompt, { persona: 'default', maxTokens: 300 });
}

function completeReview(topicId) {
  const db = initDb();
  const row = db.prepare('SELECT level FROM learning_topics WHERE id = ?').get(topicId);
  if (!row) { db.close(); return null; }
  const newLevel = Math.min(row.level + 1, 2);
  let days = 1;
  if (newLevel === 1) days = 7;
  if (newLevel === 2) days = 30;
  const nextReview = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE learning_topics SET level = ?, next_review = ? WHERE id = ?').run(newLevel, nextReview, topicId);
  db.close();
  return { newLevel, nextReview, days };
}

// --- Sub-comando 4: feynman ---
async function feynmanEvaluate(text, topic, askFn) {
  const prompt = 'Avalia a explicacao do usuario sobre "' + topic + '" usando a tecnica Feynman. Texto: ' + text + '. Identifica: 1) jargao vazio sem explicacao, 2) saltos logicos (assumiu conhecimento previo sem explicar), 3) simplificacoes erradas. Responde com uma lista de problemas encontrados. Se nenhum problema, responde apenas: "Explicacao solida — voce domina o conceito." Maximo 250 tokens.';
  return await askFn(prompt, { persona: 'default', maxTokens: 250 });
}

// --- Sub-comando 5: salvar ---
function saveTopic(userId, topic) {
  const db = initDb();
  const nextReview = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
  const info = db.prepare('INSERT INTO learning_topics (user_id, topic, next_review, level) VALUES (?, ?, ?, 0)').run(userId, topic, nextReview);
  db.close();
  return { id: info.lastInsertRowid, nextReview };
}

// --- Sub-comando 6: status ---
function getStatus(userId) {
  const db = initDb();
  const rows = db.prepare('SELECT topic, next_review, level FROM learning_topics WHERE user_id = ? ORDER BY next_review ASC').all(userId);
  db.close();
  return rows;
}

// --- Estado em memoria ---
function setAwaiting(userId, data) {
  awaitingAnswer.set(userId.toString(), { ...data, ts: Date.now() });
}

function getAwaiting(userId) {
  const key = userId.toString();
  const data = awaitingAnswer.get(key);
  if (!data) return null;
  if (Date.now() - data.ts > 600000) {
    awaitingAnswer.delete(key);
    return null;
  }
  return data;
}

function clearAwaiting(userId) {
  awaitingAnswer.delete(userId.toString());
}

module.exports = {
  initDb,
  topicExplain,
  testGenerate,
  testEvaluate,
  getDueReviews,
  generateReviewQuestions,
  completeReview,
  feynmanEvaluate,
  saveTopic,
  getStatus,
  setAwaiting,
  getAwaiting,
  clearAwaiting,
};
