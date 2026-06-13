/**
 * core/tts.js — Text-to-Speech via Edge-TTS (V90-NEW-VOICE)
 * Dep: msedge-tts (npm)
 */

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const DEFAULT_VOICE = 'pt-BR-AntonioNeural';
const MAX_CHARS = 500;

/**
 * Sintetiza texto em áudio MP3
 * @param {string} text — texto a sintetizar
 * @param {string} voice — voz (default: pt-BR-AntonioNeural)
 * @returns {Promise<<Buffer>} — buffer MP3
 */
async function synthesize(text, voice = DEFAULT_VOICE) {
  if (!text || !text.trim()) throw new Error('Texto vazio');
  
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + '... (truncado)';
    truncated = true;
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  
  const { audioStream } = await tts.toStream(text);
  
  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  
  const buffer = Buffer.concat(chunks);
  return { buffer, truncated, duration: buffer.length }; // duration é proxy do tamanho
}

module.exports = { synthesize, DEFAULT_VOICE, MAX_CHARS };
