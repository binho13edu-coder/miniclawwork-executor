import os, time, requests, uuid, base64
from typing import Optional
from dotenv import load_dotenv
load_dotenv()

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO_OWNER = "binho13edu-coder"
REPO_NAME = "miniclawwork-executor"

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
    requests.post(url, headers=headers, json=payload).raise_for_status()

def get_latest_run_id() -> Optional[int]:
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/runs"
    headers = {"Authorization": f"Bearer {GITHUB_TOKEN}"}
    data = requests.get(url, headers=headers).json()
    for run in data.get("workflow_runs", []):
        if run["event"] == "repository_dispatch" and run["status"] in ["queued", "in_progress"]:
            return run["id"]
    return None

def wait_for_result(task_id: str, timeout: int = 120) -> str:
    time.sleep(5)
    start = time.time()
    while time.time() - start < timeout:
        run_id = get_latest_run_id()
        if not run_id:
            time.sleep(3)
            continue
        url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/runs/{run_id}/artifacts"
        headers = {"Authorization": f"Bearer {GITHUB_TOKEN}"}
        artifacts = requests.get(url, headers=headers).json().get("artifacts", [])
        for artifact in artifacts:
            if task_id in artifact["name"]:
                download_url = artifact["archive_download_url"]
                data = requests.get(download_url, headers=headers)
                return data.text
        time.sleep(3)
    raise TimeoutError("Timeout esperando resultado")

def execute_task(query: str, llm_generate) -> str:
    code_prompt = f"Gere APENAS código Python para:\n{query}\nSem explicações."
    code = llm_generate(code_prompt)
    task_id = str(uuid.uuid4())
    trigger_github_action(code, task_id)
    try:
        result = wait_for_result(task_id)
        return f"✅ Resultado:\n{result}"
    except TimeoutError:
        return "⏱️ Execução demorou. Tente novamente."
