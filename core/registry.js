const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const SKILLS_DIR   = path.join(__dirname, '..', 'skills');

function loadJsonDir(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    try {
      out[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.error(`[registry] skip ${f}: ${e.message}`);
    }
  }
  return out;
}

function build() {
  const commands = loadJsonDir(COMMANDS_DIR);
  const skills   = loadJsonDir(SKILLS_DIR);
  const registry = { commands, skills, routes: {} };
  for (const [name, cmd] of Object.entries(commands)) {
    if (cmd.skill && skills[cmd.skill]) {
      registry.routes[cmd.trigger || `/${name}`] = { command: name, skill: cmd.skill };
    }
  }
  return Object.freeze(registry);
}

module.exports = { build };
