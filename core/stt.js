/**
 * core/stt.js — Speech-to-Text via Groq Whisper API (V90-NEW-STT)
 * Fix: Groq valida extensao do filename — .oga nao aceita, .ogg sim
 */

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

async function transcribe(filePath) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY nao configurada no ambiente');
  if (!fs.existsSync(filePath)) throw new Error('Arquivo nao encontrado: ' + filePath);

  const form = new FormData();
  // Groq valida extensao do filename: .oga nao aceita, .ogg sim (mesmo conteudo OGG/Opus)
  form.append('file', fs.createReadStream(filePath), { filename: 'audio.ogg' });
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
