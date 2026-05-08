const { Telegraf } = require('telegraf');
const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const axios = require('axios');
const fs = require('fs');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

let state = { leads: [], selectedLead: null, lastValue: null };

const STATE_FILE = 'bot_state.json';

const saveStateToFile = () => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error('Erro ao salvar estado:', err);
  }
};

const loadStateFromFile = () => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(data);
    }
  } catch (err) {
    console.error('Erro ao carregar estado:', err);
  }
};

loadStateFromFile();

const handleStart = (ctx) => {
  ctx.reply('Bot inicializado. Use os comandos: buscar, autopilot, analise, "vale a pena?", status, operações matemáticas.');
};

const handleBuscar = async (ctx, nicho) => {
    ctx.reply('Comando "buscar" requer um nicho. Ex: /buscar imóveis');
    return;
  }

  const code = 
