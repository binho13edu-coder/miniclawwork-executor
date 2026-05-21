# MINICLAWWORK.md

> Single source of truth for the MiniClawwork project.
> System stable as of 2026-05-21. V75-01 through V75-08 completed and committed. Git: main@f81c8bf.

---

## 1. Purpose

MiniClawwork is personal operational infrastructure, not an AI toy. It is a Telegram-based operational agent running on minimal hardware (Oracle Cloud Free Tier ARM, 1GB RAM) designed to execute commands, manage data, run scheduled jobs, and maintain continuity of context across sessions. We are not building a chatbot. We are building infrastructure that works while we sleep.

---

## 2. Architecture
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Telegram   │────▶│  sanitize.js │────▶│  queue.js   │────▶│  hooks.js    │
│   (User)    │     │  (core/)     │     │  (core/)    │     │  (core/)     │
└─────────────┘     └──────────────┘     └─────────────┘     └──────┬───────┘
│
┌────────────────────────────────────┘
▼
┌─────────────────┐
│  Command Handler│
│   (index.js)    │
└────────┬────────┘
│
┌───────────────────┼───────────────────┐
▼                   ▼                   ▼
┌────────────┐    ┌──────────────┐    ┌─────────────┐
│ better-    │    │    Jobs/     │    │   External  │
│ sqlite3    │    │    Crons     │    │    APIs     │
│ (3 DBs)    │    │  (jobs/)     │    │  (axios)    │
└────────────┘    └──────────────┘    └─────────────┘
plain
Copy

**Flow:**
1. User sends message via Telegram
2. `sanitize.text()` cleans input
3. `queue.add()` serializes processing
4. `hooks.trigger('preCommand')` runs audit
5. Handler executes business logic
6. `hooks.trigger('postCommand')` logs completion
7. Response returned to user

---

## 3. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js (LTS) | ARM64 compatible |
| Bot Framework | Telegraf | Telegram Bot API wrapper |
| Database | better-sqlite3 | 3 separate DBs, zero config |
| Process Manager | PM2 | `max_memory_restart` enabled, ~31MB footprint |
| Scheduling | node-cron | Daily briefing + SQLite backup |
| HTTP Client | axios | Timeout audit applied (V75-01) |
| Networking | Tailscale | SSH access only, no public ports |
| OS | Oracle Linux (ARM) | Free Tier, 1GB RAM + swap |

**Explicitly NOT used:** Docker, Playwright, Puppeteer, Selenium, E2B, heavy vector DBs (Chroma/Qdrant), LangChain heavy, paid SaaS as core dependency, public port exposure, heavy multi-agent frameworks.

---

## 4. Directory Structure
miniclawwork-executor/
├── core/
│   ├── hooks.js              # Event hook system + audit log (V75-03)
│   ├── queue.js              # Sequential processing queue (V75-07)
│   ├── sanitize.js           # Input sanitization utility (V75-08)
│   ├── help-manifest.js      # Command manifest with substring search (V75-05)
│   └── logger.js             # Structured logging
├── jobs/
│   ├── retry-manager.js      # Retry/backfill for jobs.db (V75-04)
│   └── daily-briefing.js     # Morning briefing cron (timezone: America/Sao_Paulo)
├── tools/
│   ├── bundle-context.js     # Architecture snapshot generator (IME-03)
│   ├── leak-auditor.js       # Resource leak analysis (V75-02)
│   └── tailscale-ssh-harden.sh  # SSH hardening via Tailscale (V75-06)
├── data/
│   ├── transactions.db       # Financial records
│   ├── documents.db          # Document storage and chunks
│   └── jobs.db               # Cron job tracking and state
├── logs/
│   ├── backup-sqlite.log     # Backup execution log
│   └── audit/                # Hook audit logs
├── docs/                     # Additional documentation
├── index.js                  # Main bot entry (monolithic, V7 dispatcher ready but inactive)
├── ecosystem.config.js       # PM2 configuration
├── package.json
├── MINICLAWWORK.md           # This file
└── .git/                     # 9 commits V7.5 applied, workspace clean
plain
Copy

---

## 5. Command Flow

A Telegram message flows through the system in this exact order:

1. **Input** — Raw message arrives via Telegraf
2. **Sanitize** — `sanitize.text(input)` trims, limits to 4000 chars, strips control characters (except `\n` `\t`), escapes HTML entities
3. **Queue** — `queue.add(task, ctx, priority)` serializes execution to prevent race conditions
4. **Pre-hook** — `hooks.trigger('preCommand', ctx, data)` runs audit logging
5. **Handler** — Command-specific logic executes (e.g., `/fin`, `/status`, `/ctx`)
6. **Post-hook** — `hooks.trigger('postCommand', ctx, result)` logs completion or error
7. **Response** — Sanitized output sent back to Telegram chat

If a hook throws, the error is logged but **never** breaks the main flow.

---

## 6. Operational Rules

1. **1 command, 1 response, 1 validation, 1 next step**
2. **No `git add .`** — Stage files individually with `git add -p`
3. **No double patch without test** — One patch per session, validated before next
4. **No generic restart** — Restart only after `node --check` passes
5. **No changing stable module out of curiosity** — If it works, don't touch it
6. **Backup before destructive operation** — `cp file file.bkp.$(date +%s)`
7. **`node --check` before restart** — Syntax validation is mandatory
8. **Production before feature, stability before architecture**
9. **ONE patch per session (golden rule)** — Never apply two changes in one session
10. **Workflow: Jules generates code → MiniClawwork validates → commands ready**

---

## 7. Forbidden Stack

The following technologies are **prohibited** or **undesirable** in this project:

- Docker — unnecessary overhead for single-process Node.js
- Playwright / Puppeteer / Selenium — browser automation is out of scope
- E2B / Replit production — external runtime dependency
- Heavy local models — exceeds 1GB RAM budget
- Vector DB heavy (Chroma, Qdrant) — SQLite + text search is sufficient
- LangChain heavy — we write integrations directly
- Paid SaaS as core dependency — bot must survive if SaaS fails
- Public port exposure — Tailscale only, zero attack surface
- Heavy multi-agent — single queue, single process, KISS

---

## 8. Database Schema

### transactions.db
Financial records. Stores income, expenses, categories, and tags. **Known debt:** float drift in `amount` due to JavaScript decimal handling — do not migrate now.

### documents.db
Document storage and chunks. Stores raw documents and their segmented chunks for retrieval. **Known debt:** `document_chunks` table needs corrections (V75-12 pending).

### jobs.db
Cron job tracking and execution state.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | INTEGER | PK | Auto-increment primary key |
| name | TEXT | NOT NULL | Job identifier (e.g., `daily-briefing`) |
| last_run | TEXT | — | ISO timestamp of last execution |
| status | TEXT | — | `success`, `failed`, `running` |
| locked | INTEGER | 0 | Boolean lock to prevent concurrent runs |
| error | TEXT | — | Last error message |
| created_at | TEXT | CURRENT_TIMESTAMP | Row creation |
| updated_at | TEXT | CURRENT_TIMESTAMP | Last update |
| retries | INTEGER | 0 | Current retry count |
| max_retries | INTEGER | 3 | Maximum retry attempts |
| next_run | TEXT | — | Scheduled next execution |
| error_log | TEXT | — | Full error trace |

---

## 9. Roadmap

### Current: V7.5 — Hooks + Audit + Hardening (STABLE)

| Code | Item | Status | Commit |
|------|------|--------|--------|
| V75-01 | Timeout audit em axios | ✅ | cab9969 |
| V75-02 | Leak Auditor (local) | ✅ | 3322371 |
| V75-03 | core/hooks.js eventos | ✅ | 0eb0ec1 |
| V75-03b | Audit log integration | ✅ | 5d15816 |
| V75-04 | Retry/backfill jobs.db | ✅ | deadefa |
| V75-05 | /help substring manifests | ✅ | 9eec805 |
| V75-06 | Tailscale SSH hardening | ✅ | 64a6cbc |
| V75-07 | async.queue (condicional) | ✅ | 690f0a5 |
| V75-08 | core/sanitize.js | ✅ | f81c8bf |
| V75-09 | MINICLAWWORK.md | ⏳ | This file |
| V75-10 | Auto-validação pós-job | ⏳ | Pending |
| V75-11 | Hardening /git + inputs | ⏳ | Pending |
| V75-12 | Correções → document_chunks | ⏳ | Pending |
| V75-13 | Feedback inline ✅/❌ | ⏳ | Pending |

### V8.0 — Intelligence Layer (BLOCKED)
**Prerequisite:** 7 days of V7.5 stability.

| Code | Item |
|------|------|
| V80-01 | SOUL.md |
| V80-02 | Gemini Flash REST |
| V80-03 | Cache LLM SQLite |
| V80-04 | Multi-agente com crítico |
| V80-05 | VALUE_SIGNALS + Meta Ads |
| V80-06 | Dynamic Skills |
| V80-07 | /plan interrogação |
| V80-08 | /dump triagem |
| V80-09 | Modificadores /ctx |
| V80-10 | 3/3/3 briefing |
| V80-11 | /help semântico |
| V80-12 | Schema subtarefas |

### V9.0 — Supervisor Contextual (BLOCKED)
**Prerequisite:** 15 days of V8.0 stability.

| Code | Item |
|------|------|
| V90-01 | memory_summaries |
| V90-02 | P.A.R.A. document_chunks |

---

## 10. Guiding Principles

> **Utilidade vence complexidade.**

> **Memória útil não depende de embeddings.**

> **O Supervisor não é autonomia. É continuidade contextual.**

> **Não estamos construindo um brinquedo de IA.**

> **Estamos construindo infraestrutura operacional pessoal.**

---

## 11. Known Technical Debt

| Debt | Severity | Decision |
|------|----------|----------|
| Float drift in `/fin` (JS decimal `amount`) | Medium | Do not migrate now |
| LLM math inconsistency via Telegram | Medium | Future `/calc` deterministic command |
| `triggerAndWait` with GitHub Actions | Low | Legacy infra, functional but heavy |
| `index.js` monolithic | Low | V7 dispatcher ready but inactive |
| Anti-hallucination: weak model elaborates instead of dry disclaimer | Medium | Mitigated for technical facts; conceptual absurdities deferred to V8.0 |
| Conceptual anti-hallucination (e.g., "levar carro a pé") | Medium | Deferred to V8.0 with stronger model + grounding |

---

## 12. Quick Commands for Operators

```bash
# Status geral
pm2 status && git status --short && git log --oneline -5

# Verificar jobs.db
node -e "const Database=require('better-sqlite3'); const db=new Database('./data/jobs.db'); console.table(db.prepare('SELECT name,last_run,status,locked,retries,max_retries,next_run,error_log,updated_at FROM jobs').all()); db.close();"

# Verificar backups
ls -lh /home/opc/miniclawwork-executor/backups/sqlite/ | tail -5 && tail -3 /home/opc/miniclawwork-executor/logs/backup-sqlite.log

# Gerar context-snapshot
node tools/bundle-context.js

# Executar Leak Auditor
node tools/leak-auditor.js

# Testar hooks
node -e "const hooks = require('./core/hooks.js'); const { createLogger } = require('./core/logger.js'); hooks.setLogger(createLogger('audit')); hooks.register('test', async () => {}); hooks.trigger('test', {from:{id:1}}, {}).then(() => console.log('hooks ok:', hooks.list()));"

# Testar queue
node -e "const q = require('./core/queue.js'); const hooks = require('./core/hooks.js'); hooks.register('preCommand', async () => {}); hooks.register('postCommand', async () => {}); q.add(async () => console.log('task ok'), {}, 0); setTimeout(() => console.log('size:', q.size()), 100);"

# Testar sanitize
node -e "const s = require('./core/sanitize.js'); console.log('text:', s.text('<script>')); console.log('phone:', s.phone('+55 (11) 98765-4321')); console.log('email:', s.email('Test@Email.COM')); console.log('command:', s.command('/status arg')); console.log('sql:', s.sql('SELECT * FROM users'));"
Document generated based on Session Report V7.5 — 21/05/2026.
Next expected update: after V75-13 completion or V8.0 authorization.
