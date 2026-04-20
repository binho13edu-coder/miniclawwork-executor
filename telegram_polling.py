import os, requests, time
from dotenv import load_dotenv
load_dotenv()

TOKEN = os.getenv("TELEGRAM_TOKEN")
API_URL = f"https://api.telegram.org/bot{TOKEN}"
OWNER_ID = int(os.getenv("TELEGRAM_OWNER_ID", "0"))
LAST_UPDATE = 0

def get_updates():
    global LAST_UPDATE
    try:
        r = requests.get(f"{API_URL}/getUpdates",
                        params={"offset": LAST_UPDATE+1, "timeout": 30},
                        timeout=35)
        return r.json().get("result", [])
    except:
        time.sleep(5)
        return []

def send_message(chat_id, text):
    try:
        requests.post(f"{API_URL}/sendMessage",
                     data={"chat_id": chat_id, "text": text},
                     timeout=10)
    except:
        pass

def handle_message(text, chat_id):
    if text.startswith("/deploy"):
        try:
            requests.post("http://localhost:8082/deploy", timeout=5)
            return "🚀 Deploy iniciado. A VPS será atualizada em instantes via GitHub Actions."
        except Exception as e:
            return f"❌ Erro ao iniciar deploy: {e}"
    else:
        try:
            r = requests.get("http://localhost:8082/ask", params={"q": text}, timeout=30)
            return r.json().get("response", "Sem resposta")
        except:
            return "Erro no backend"

def main():
    print("Polling iniciado...")
    while True:
        for upd in get_updates():
            LAST_UPDATE = upd["update_id"]
            msg = upd.get("message")
            if msg and msg.get("text"):
                chat_id = msg["chat"]["id"]
                if OWNER_ID and chat_id != OWNER_ID:
                    send_message(chat_id, "Acesso não autorizado.")
                    continue
                resposta = handle_message(msg["text"], chat_id)
                send_message(chat_id, resposta)
        time.sleep(1)

if __name__ == "__main__":
    main()
