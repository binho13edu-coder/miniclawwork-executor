const { ask } = require('./llm');
const VALID = ['project','area','resource','archive'];
const PROMPT = `Classifique em P.A.R.A. (project=ativa c/prazo, area=responsabilidade contínua, resource=referência, archive=obsoleto). Responda APENAS uma palavra:

`;
async function classifyChunk(content, source) {
  try {
    const r = await ask(PROMPT + content.slice(0,2000) + '\n\nCATEGORIA:', {maxTokens:10, temperature:0.1});
    const c = r.toLowerCase().trim().replace(/[^a-z]/g,'');
    if (VALID.includes(c)) return c;
    const t = (content+' '+source).toLowerCase();
    if (/prazo|deadline|entrega|launch|meta|sprint/.test(t)) return 'project';
    if (/finanças|saúde|marketing|rh|vendas|pessoal/.test(t)) return 'area';
    if (/artigo|tutorial|guia|referência|ideia|estudo/.test(t)) return 'resource';
    if (/concluído|finalizado|antigo|histórico|encerrado/.test(t)) return 'archive';
    return 'resource';
  } catch(e) { return 'resource'; }
}
module.exports = { classifyChunk, VALID_CATEGORIES: VALID };
