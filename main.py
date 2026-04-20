from fastapi import FastAPI
from engine import Engine
app = FastAPI()
engine = Engine()

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/ask")
def ask(q: str):
    return {"response": engine.run(q)}
