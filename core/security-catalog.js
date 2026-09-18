const SERVICES = Object.freeze([
  {
    id: 'diagnostico-externo',
    title: 'Diagnóstico de Postura Externa',
    when: 'Ponto de partida para ativos autorizados.',
    delivers: 'Relatório de DNS, e-mail, TLS, headers e tecnologias públicas.',
    price: 'Sob consulta'
  },
  {
    id: 'headers-seguranca',
    title: 'Remediação de Headers HTTP',
    when: 'HSTS, CSP, X-Frame-Options ou nosniff ausentes.',
    delivers: 'Configuração, validação de compatibilidade e evidência pós-correção.',
    price: 'Sob consulta'
  },
  {
    id: 'email-autenticacao',
    title: 'Postura de E-mail (SPF/DMARC)',
    when: 'SPF/DMARC ausente ou DMARC em modo p=none.',
    delivers: 'Política recomendada, implementação aprovada e plano de evolução.',
    price: 'Sob consulta'
  },
  {
    id: 'tls-ciclo-vida',
    title: 'Gestão de Certificado TLS',
    when: 'Cadeia inválida ou certificado próximo do vencimento.',
    delivers: 'Correção/renovação e validação do certificado público.',
    price: 'Sob consulta'
  },
  {
    id: 'validacao-pos-correcao',
    title: 'Validação Pós-Correção',
    when: 'Após qualquer remediação.',
    delivers: 'Comparativo antes × depois e relatório executivo de evidências.',
    price: 'Sob consulta'
  }
]);

function formatCatalog() {
  return [
    '🛡️ *Catálogo de Serviços de Segurança*',
    '',
    ...SERVICES.flatMap((service, index) => [
      '*' + (index + 1) + '. ' + service.title + '*',
      'Quando: ' + service.when,
      'Entrega: ' + service.delivers,
      'Valor: ' + service.price,
      ''
    ]),
    '_Valores são definidos pelo operador; o bot não gera preços automaticamente._'
  ].join('\n');
}

function recommendServices(assessment) {
  const headers = assessment.headers || {};
  const dns = assessment.dns || {};
  const tls = assessment.tls || {};
  const ids = new Set(['diagnostico-externo']);

  if (['HSTS', 'CSP', 'X-Frame-Options', 'X-Content-Type-Options']
    .some(header => headers[header] !== true)) {
    ids.add('headers-seguranca');
  }
  if (!dns.spfPresent || !dns.dmarc?.found || dns.dmarc?.policy === 'none') {
    ids.add('email-autenticacao');
  }
  if (tls.valid === false || (Number.isFinite(tls.daysRemaining) && tls.daysRemaining <= 30)) {
    ids.add('tls-ciclo-vida');
  }
  ids.add('validacao-pos-correcao');

  return SERVICES.filter(service => ids.has(service.id));
}

module.exports = { SERVICES, formatCatalog, recommendServices };
