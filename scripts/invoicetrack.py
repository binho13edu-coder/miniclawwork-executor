import sys, json, sqlite3, os
from datetime import datetime

DB_PATH = "/home/opc/miniclawwork-executor/data/invoices.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT NOT NULL,
        value TEXT NOT NULL,
        due_date TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    conn.close()

def add_invoice(data_json):
    init_db()
    data = json.loads(data_json)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO invoices (client, value, due_date, description) VALUES (?, ?, ?, ?)",
              (data["client"], data["value"], data["due"], data["desc"]))
    conn.commit()
    conn.close()

def list_invoices():
    init_db()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, client, value, due_date, description, status FROM invoices ORDER BY due_date")
    rows = c.fetchall()
    conn.close()
    
    today = datetime.now().strftime("%Y-%m-%d")
    invoices = []
    for row in rows:
        status = row[5]
        if status == "pending" and row[3] < today:
            status = "overdue"
        invoices.append({
            "id": row[0],
            "client": row[1],
            "value": row[2],
            "due": row[3],
            "description": row[4],
            "status": status
        })
    return {"invoices": invoices}

def pay_invoice(inv_id):
    init_db()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (inv_id,))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    action = sys.argv[1]
    if action == "add":
        add_invoice(sys.argv[2])
        print(json.dumps({"ok": True}))
    elif action == "list":
        print(json.dumps(list_invoices()))
    elif action == "pay":
        pay_invoice(sys.argv[2])
        print(json.dumps({"ok": True}))
    else:
        print(json.dumps({"error": "Ação inválida"}))
