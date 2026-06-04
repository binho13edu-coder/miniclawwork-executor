/**
 * skills/hackflow.js — Pipeline Hacking Integrado (V90-NEW-H)
 * Orquestra: recon → scan → osint → aiattack → analyze → report
 * Reutiliza ethical-hacking.js e ai-attack-simulator.js
 */

const hacking = require('./ethical-hacking');
const aiAttack = require('./ai-attack-simulator');

const VALID_SCENARIOS = ['credential_exfiltration', 'phishing_campaign', 'supply_chain', 'ransomware_sim', 'lateral_movement', 'persistence'];

async function run(target, scenario = 'credential_exfiltration') {
  if (!VALID_SCENARIOS.includes(scenario)) {
    throw new Error('Cenário inválido. Use: ' + VALID_SCENARIOS.join(', '));
  }
  const results = {
    target: target,
    timestamp: new Date().toISOString(),
    phases: []
  };

  // FASE 1: Recon
  try {
    const recon = await hacking.recon(target);
    results.phases.push({ phase: 'recon', status: 'completed', data: recon });
  } catch(e) {
    results.phases.push({ phase: 'recon', status: 'failed', error: e.message });
  }

  // FASE 2: Scan
  try {
    const scan = await hacking.scan(target);
    results.phases.push({ phase: 'scan', status: 'completed', data: scan });
  } catch(e) {
    results.phases.push({ phase: 'scan', status: 'failed', error: e.message });
  }

  // FASE 3: OSINT (DNS básico)
  try {
    const osint = await hacking.osint(target);
    results.phases.push({ phase: 'osint', status: 'completed', data: osint });
  } catch(e) {
    results.phases.push({ phase: 'osint', status: 'failed', error: e.message });
  }

  // FASE 4: AI Attack Simulation
  try {
    const attack = aiAttack.simulateAttack(target, scenario);
    results.phases.push({ phase: 'attack_sim', status: 'completed', data: attack });
  } catch(e) {
    results.phases.push({ phase: 'attack_sim', status: 'failed', error: e.message });
  }

  // FASE 5: Analysis
  try {
    const attackData = results.phases.find(p => p.phase === 'attack_sim')?.data || {};
    const analysis = aiAttack.analyzeResults(attackData);
    results.phases.push({ phase: 'analysis', status: 'completed', data: analysis });
  } catch(e) {
    results.phases.push({ phase: 'analysis', status: 'failed', error: e.message });
  }

  return results;
}

function formatReport(results) {
  let out = '🔴 *HackFlow — Pipeline de Ataque Integrado*\\n\\n';
  out += '*Alvo:* ' + results.target + '\\n';
  out += '*Timestamp:* ' + results.timestamp + '\\n\\n';

  let riskScore = 0;
  let completed = 0;

  results.phases.forEach(p => {
    const icon = p.status === 'completed' ? '✅' : '❌';
    out += icon + ' *' + p.phase.toUpperCase() + '*\\n';
    if (p.status === 'completed') {
      completed++;
      if (p.data && p.data.risk_level) riskScore = Math.max(riskScore, p.data.risk_level === 'critical' ? 95 : p.data.risk_level === 'high' ? 80 : 50);
      if (p.phase === 'analysis' && p.data.efficiency_score) riskScore = Math.max(riskScore, p.data.efficiency_score);
    } else {
      out += '   Erro: ' + p.error + '\\n';
    }
    out += '\\n';
  });

  out += '*Progresso:* ' + completed + '/' + results.phases.length + ' fases\\n';
  out += '*Score de Risco:* ' + riskScore + '/100\\n\\n';

  if (riskScore > 80) {
    out += '🚨 *RISCO CRÍTICO DETECTADO*\\n';
    out += 'Recomendação: Gerar payload educacional para testes autorizados.\\n';
    out += 'Use /payload <tipo> <plataforma> para continuar.\\n\\n';
  }

  out += '⚠️ *Aviso Legal:* Este relatório é para fins educacionais e segurança autorizada apenas.';
  return { text: out, riskScore: riskScore, phases: results.phases };
}

module.exports = { run, formatReport };
