const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DOCS_DIR = './docs/';
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

async function ingestDocument(filename, content, ext) {
  try {
    const docId = uuidv4().slice(0, 8);
    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filepath = path.join(DOCS_DIR, `${docId}_${safeName}`);
    
    fs.writeFileSync(filepath, content);
    console.log('✅ Ingerido:', safeName, `(${docId})`);
    
    // Salvar metadata simples
    const meta = { id: docId, name: safeName, ext, timestamp: new Date().toISOString() };
    fs.writeFileSync(path.join(DOCS_DIR, `${docId}.json`), JSON.stringify(meta, null, 2));
    
    return docId;
  } catch (error) {
    console.error('Ingest falhou:', error);
    throw error;
  }
}

module.exports = { ingestDocument };
