import os
import requests
import logging
from dotenv import load_dotenv

load_dotenv()

GROQ_KEY = os.getenv("GROQ_API_KEY")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY")

def call_groq(prompt):
    if not GROQ_KEY:
        return None
    try:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            json={"model": "llama-3.3-70b-versatile",
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=20
        )
        return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logging.error(f"Groq: {e}")
        return None

def call_openrouter(prompt):
    if not OPENROUTER_KEY:
        return None
    try:
        r = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
            json={"model": "meta-llama/llama-3-8b-instruct",
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=20
        )
        return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logging.error(f"OpenRouter: {e}")
        return None

def generate(prompt):
    resp = call_groq(prompt)
    if resp:
        return resp
    logging.warning("Groq falhou, tentando OpenRouter")
    resp = call_openrouter(prompt)
    if resp:
        return resp
    return "Estou com instabilidade. Tente novamente em instantes."
