// core/finance.js — MiniClawwork V6.4
// Finance pessoal: track income/expense via Telegram + SQLite

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '../data/finance/transactions.db');

function now() { return Math.floor(Date.now() / 1000); }

class FinanceStore {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   INTEGER NOT NULL,
        type        TEXT    CHECK(type IN ('income','expense','transfer')) NOT NULL,
        amount      REAL    NOT NULL CHECK(amount > 0),
        category    TEXT    DEFAULT 'geral',
        description TEXT,
        note        TEXT,
        created_at  INTEGER NOT NULL
      );
    `);
  }

  add(type, amount, category = 'geral', description = '', note = '') {
    return this.db.prepare(`
      INSERT INTO transactions (timestamp, type, amount, category, description, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(now(), type, amount, category, description, note, now());
  }

  today() {
    return this.db.prepare(`
      SELECT type, SUM(amount) as total
      FROM transactions
      WHERE DATE(timestamp, 'unixepoch') = DATE('now')
      GROUP BY type
    `).all();
  }

  month(year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return this.db.prepare(`
      SELECT type, SUM(amount) as total
      FROM transactions
      WHERE strftime('%Y-%m', datetime(timestamp, 'unixepoch')) = ?
      GROUP BY type
    `).all(ym);
  }

  balance() {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
      FROM transactions
      WHERE strftime('%Y-%m', datetime(timestamp, 'unixepoch')) = strftime('%Y-%m', 'now')
    `).get();
    row.balance = row.income - row.expense;
    return row;
  }

  recent(limit = 5) {
    return this.db.prepare(`
      SELECT type, amount, category, description, datetime(timestamp, 'unixepoch') as date
      FROM transactions
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);
  }
}

// ── Formatadores para Telegram ──────────────────────────────────────────────

function formatBalance(b) {
  const emoji = b.balance >= 0 ? '🟢' : '🔴';
  return (
    `📊 *Resumo do mês*\n` +
    `💰 Receitas: R$ ${b.income.toFixed(2)}\n` +
    `💸 Despesas: R$ ${b.expense.toFixed(2)}\n` +
    `${emoji} Saldo: R$ ${b.balance.toFixed(2)}`
  );
}

function formatRecent(rows) {
  if (!rows.length) return '📭 Nenhuma transação registrada.';
  const lines = rows.map(r => {
    const icon = r.type === 'income' ? '💰' : '💸';
    return `${icon} R$ ${r.amount.toFixed(2)} · ${r.category} · ${r.description || '—'}`;
  });
  return `📋 *Últimas transações*\n` + lines.join('\n');
}

// ── Parser de comandos ──────────────────────────────────────────────────────
// Suporta:
//   /fin receita 500 freelance "pagamento projeto X"
//   /fin gasto 150 alimentacao "almoço"
//   /fin saldo
//   /fin lista

function parseCommand(args) {
  const parts = args.trim().split(/\s+/);
  const action = (parts[0] || '').toLowerCase();

  if (action === 'saldo' || action === 'balance') {
    return { action: 'balance' };
  }
  if (action === 'lista' || action === 'list') {
    return { action: 'recent' };
  }
  if (['receita', 'income', 'entrada'].includes(action)) {
    const amount = parseFloat(parts[1]);
    if (isNaN(amount)) return { error: 'Valor inválido. Ex: /fin receita 500 freelance' };
    const catMatch = args.match(/"([^"]+)"/);
    const category = catMatch ? catMatch[1] : (parts[2] || 'geral');
    const description = catMatch ? '' : parts.slice(3).join(' ').replace(/^"|"$/g, '');
    return { action: 'add', type: 'income', amount, category, description };
  }
  if (['gasto', 'expense', 'saida', 'despesa'].includes(action)) {
    const amount = parseFloat(parts[1]);
    if (isNaN(amount)) return { error: 'Valor inválido. Ex: /fin gasto 150 alimentacao' };
    const catMatch = args.match(/"([^"]+)"/);
    const category = catMatch ? catMatch[1] : (parts[2] || 'geral');
    const description = catMatch ? '' : parts.slice(3).join(' ').replace(/^"|"$/g, '');
    return { action: 'add', type: 'expense', amount, category, description };
  }
  if (!action) return { error: `*\/fin* — Finanças Pessoais\nUse:\n• \/fin saldo\n• \/fin lista\n• \/fin receita 500 freelance\n• \/fin gasto 150 alimentacao` };
  return { error: `Comando não reconhecido: *${action}*\nUse: receita | gasto | saldo | lista` };
}

// ── Handler principal ───────────────────────────────────────────────────────

const store = new FinanceStore();

async function handleFinance(ctx, args) {
  const parsed = parseCommand(args || '');

  if (parsed.error) return ctx.reply(parsed.error, { parse_mode: 'Markdown' });

  if (parsed.action === 'balance') {
    return ctx.reply(formatBalance(store.balance()), { parse_mode: 'Markdown' });
  }
  if (parsed.action === 'recent') {
    return ctx.reply(formatRecent(store.recent(5)), { parse_mode: 'Markdown' });
  }
  if (parsed.action === 'add') {
    store.add(parsed.type, parsed.amount, parsed.category, parsed.description);
    const icon = parsed.type === 'income' ? '💰' : '💸';
    return ctx.reply(
      `${icon} Registrado!\n*${parsed.type === 'income' ? 'Receita' : 'Despesa'}:* R$ ${parsed.amount.toFixed(2)}\n*Categoria:* ${parsed.category}`,
      { parse_mode: 'Markdown' }
    );
  }
}

module.exports = { FinanceStore, handleFinance, store };
