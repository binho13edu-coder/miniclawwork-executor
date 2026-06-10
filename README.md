# 🤖 MiniClawwork

Agente operacional Telegram para automação B2B, financeiro, cripto e produtividade.

## 🚀 Comandos

### Negócios
| Comando | Descrição |
|---------|-----------|
| `/leads <termo>` | Busca leads B2B por termo |
| `/leads status` | Lista leads com status |
| `/plan <objetivo>` | Gera plano de ação estratégico |

### Financeiro
| Comando | Descrição |
|---------|-----------|
| `/fin <desc> <valor>` | Registra gasto ou receita |
| `/btc` | Cotação do Bitcoin |
| `/dolar` | Cotação do Dólar |

### Produtividade
| Comando | Descrição |
|---------|-----------|
| `/reminder <min> <msg>` | Agenda lembrete |
| `/schedule <ação> <cron>` | Agendamento recorrente |
| `/export <leads\|fin>` | Exporta CSV |

### Sistema
| Comando | Descrição |
|---------|-----------|
| `/status` | Status e recursos |
| `/ctx <termo>` | Busca no knowledge base |
| `/corrigir <texto>` | Ensina o bot |
| `/menu` | Menu inline por categoria |

## 🏗️ Arquitetura
index.js          → Handlers Telegram + routing
core/
llm.js          → LLMRouter (cascata FrugalGPT)
personas.js     → Personas especializadas por comando
osint.js        → OSINT defensivo + enriquecimento tech
corrections.js  → Correções dinâmicas + few-shots
jobs/
daily-briefing.js  → Briefing diário automático
goals-heartbeat.js → Alertas de goals pendentes
watchdog.js        → Monitoramento + OSINT automático
reminder.js        → Engine de lembretes
scheduler.js       → Agendamentos recorrentes
exporter.js        → Exportação CSV
data/
*.db            → SQLite (leads, finance, memory, etc.)
plain

## 🧪 Testes

```bash
node --test tests/
11 testes unitários com node:test (sem dependências).
🔄 CI/CD
GitHub Actions roda testes + syntax check em cada push para main.
📦 Setup
bash
cp .env.example .env
# Preencher: TELEGRAM_TOKEN, OWNER_ID, GROQ_API_KEY, etc.
npm install
npm start
📝 Changelog
LOTE 7 — Autonomia Proativa (goals, OSINT, watchdog)
LOTE 6 — Produtividade (reminder, export, schedule)
LOTE 4 — LLM Intelligence (cooldown, cascata, few-shot)
LOTE 1-3 — Core (leads, financeiro, segurança)
Criado por Fábio | Powered by Node.js + SQLite + LLM
