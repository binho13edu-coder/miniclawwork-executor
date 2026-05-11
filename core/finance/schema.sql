-- MiniClawwork V6.4 — Finance Schema
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

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT UNIQUE NOT NULL,
  type  TEXT CHECK(type IN ('income','expense','both')) DEFAULT 'both',
  icon  TEXT DEFAULT '💰'
);

CREATE TABLE IF NOT EXISTS monthly_summary (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  year    INTEGER NOT NULL,
  month   INTEGER NOT NULL,
  type    TEXT NOT NULL,
  total   REAL NOT NULL,
  UNIQUE(year, month, type)
);

-- Categorias padrão
INSERT OR IGNORE INTO categories (name, type, icon) VALUES
  ('salario',    'income',  '💼'),
  ('freelance',  'income',  '🔧'),
  ('investimento','income', '📈'),
  ('alimentacao','expense', '🍽'),
  ('moradia',    'expense', '🏠'),
  ('transporte', 'expense', '🚗'),
  ('saude',      'expense', '🏥'),
  ('educacao',   'expense', '📚'),
  ('lazer',      'expense', '🎮'),
  ('geral',      'both',    '📌');
