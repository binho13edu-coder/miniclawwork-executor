/**
 * skills/ai-attack-simulator.js — AI-Driven Attack Simulator
 * Wrapper Node.js para os scripts Python de simulação de ataques
 * Hardened: sanitize de input para prevenir command injection
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

// Sanitiza input: remove caracteres perigosos do shell
function sanitize(input) {
  if (typeof input !== 'string') return '';
  // Remove caracteres que podem ser usados para injection
  return input.replace(/[;&|`$(){}[\]\\'"<>!]/g, '').trim();
}

function simulateAttack(target, scenario, parameters = null) {
  const safeTarget = sanitize(target);
  const safeScenario = sanitize(scenario);
  if (!safeTarget || !safeScenario) {
    throw new Error('Target ou scenario inválido (caracteres perigosos detectados)');
  }
  
  const paramsStr = parameters ? JSON.stringify(parameters) : '{}';
  // Usa array de args em vez de string para evitar shell injection
  const cmd = [
    'python3',
    path.join(SCRIPTS_DIR, 'ai_attack_simulator.py'),
    '--action', 'simulate',
    '--target', safeTarget,
    '--scenario', safeScenario,
    '--parameters', paramsStr
  ];
  
  const result = execSync(cmd.join(' '), { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(result);
}

function monitorAttack(attackId) {
  const safeId = sanitize(attackId);
  if (!safeId) throw new Error('Attack ID inválido');
  
  const cmd = [
    'python3',
    path.join(SCRIPTS_DIR, 'ai_attack_simulator.py'),
    '--action', 'monitor',
    '--target', safeId
  ];
  
  const result = execSync(cmd.join(' '), { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(result);
}

function analyzeResults(attackData) {
  const inputStr = JSON.stringify(attackData);
  const cmd = [
    'python3',
    path.join(SCRIPTS_DIR, 'ai_attack_simulator.py'),
    '--action', 'analyze',
    '--target', inputStr
  ];
  
  const result = execSync(cmd.join(' '), { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(result);
}

module.exports = { simulateAttack, monitorAttack, analyzeResults };
