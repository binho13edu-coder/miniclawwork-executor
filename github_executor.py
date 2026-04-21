import os, time, requests, uuid, base64, zipfile, io
import logging
from typing import Optional
from dotenv import load_dotenv
load_dotenv()

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO_OWNER = "binho13edu-coder"
REPO_NAME = "miniclawwork-executor"

logging.basicConfig(level=logging.INFO)

def is_execution_task(query: str) -> bool:
    keywords = ["execute", "rode", "script", "código", "calcular",
                "gerar", "baixar", "processar", "crie um código"]
    return any(k in query.lower() for k in keywords)

def trigger_github_action(code: str, task_id: str) -> None:
    code_b64 = base64.b64encode(code.encode()).decode()
    headers = {"Accept": "application/vnd.github+json",
               "Authorization": f"Bearer {GITHUB_TOKEN}"}
    payload = {"event_type": "run-python",
               "client_payload": {"code": code_b64, "task_id": task_id}}
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/dispatches"
    for attempt in range(3):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=10)
            r.raise_for_status()
            logging.info(f"Disparado workflow para task {task_id}")
            return
        except Exception as e:
            logging.warning(f"Tentativa {attempt+1} falhou: {e}")
            time.sleep(2)
    raise Exception("Não foi possível disparar o workflow após 3 tentativas")

def get_run_id_by_task_id(task_id: str, timeout: int = 30) -> Optional[int]:
    """Busca o run cujo display_title (run-name) é exatamente o task_id."""
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/runs"
    headers = {"Authorization": f"Bearer {GITHUB_TOKEN}"}
    start = time.time()
    while time.time() - start < timeout:
        try:
            data = requests.get(url, headers=headers, timeout=10).json()
            for run in data.get("workflow_runs", []):
                if run.get("display_title") == task_id:
                    return run["id"]
        except Exception as e:
            logging.error(f"Erro ao listar runs: {e}")
        time.sleep(3)
    return None

def wait_for_result(task_id: str, timeout: int = 180) -> str:
    run_id = get_run_id_by_task_id(task_id)
    if not run_id:
        return "⏱️ Nenhum run encontrado para a task."
    logging.info(f"Run ID encontrado: {run_id}")
    headers = {"Authorization": f"Bearer {GITHUB_TOKEN}"}
    start = time.time()
    while time.time() - start < timeout:
        url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/runs/{run_id}/artifacts"
        try:
            artifacts_data = requests.get(url, headers=headers, timeout=10).json()
            artifacts = artifacts_data.get("artifacts", [])
            logging.info(f"Artefatos disponíveis: {[a['name'] for a in artifacts]}")
            for artifact in artifacts:
                if task_id in artifact["name"]:
                    download_url = artifact["archive_download_url"]
                    r1 = requests.get(download_url, headers=headers, allow_redirects=False, timeout=10)
                    real_url = r1.headers.get("Location")
                    if real_url:
                        resp = requests.get(real_url, timeout=30)
                    else:
                        resp = requests.get(download_url, headers=headers, timeout=30)
                    resp.raise_for_status()
                    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
                        return z.read("output.txt").decode()
        except Exception as e:
            logging.error(f"Erro ao buscar artefato: {e}")
        time.sleep(5)
    return "⏱️ Execução demorou. Tente novamente."

def execute_task(query: str, llm_generate) -> str:
    code_prompt = f"Gere APENAS código Python para:\n{query}\nSem explicações."
    code = llm_generate(code_prompt)
    lines = code.strip().split("\n")
    code = "\n".join(l for l in lines if not l.strip().startswith("```")).strip()
    task_id = str(uuid.uuid4())
    trigger_github_action(code, task_id)
    result = wait_for_result(task_id)
    if result.startswith("⏱️"):
        return result
    return f"✅ Resultado:\n{result}"
