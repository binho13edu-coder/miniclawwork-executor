/**
 * core/stt.js — Speech-to-Text via Groq Whisper API (V90-NEW-STT)
 * Usa form-data pacote (dependencia transitiva do axios) + fs.createReadStream
 */

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Transcreve arquivo de audio para texto
 * @param {string} filePath — caminho do arquivo .oga/.ogg/.mp3/etc
 * @returns {Promise<string>} — texto transcrito
 */
async function transcribe(filePath) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY; // LER AQUI, nao no top-level
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY nao configurada no ambiente');
  if (!fs.existsSync(filePath)) throw new Error('Arquivo nao encontrado: ' + filePath);

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-large-v3');
  form.append('language', 'pt');
  form.append('response_format', 'json');

  const response = await axios.post(WHISPER_URL, form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': 'Bearer ' + GROQ_API_KEY,
    },
    timeout: 30000,
    maxBodyLength: 25 * 1024 * 1024,
  });

  return response.data.text || '';
}

module.exports = { transcribe };
