from llm_client import generate
from github_executor import is_execution_task, execute_task
import subprocess
import re

def clean_query(query):
    """Remove prefixos /ask ou /exec da pergunta"""
    return re.sub(r'^/(ask|exec)\s+', '', query, flags=re.IGNORECASE).strip()

def execute_locally(code):
    """Executa código via Node.js localmente"""
    try:
        process = subprocess.run(
            ["node", "-e", code],
            capture_output=True,
            text=True,
            timeout=5
        )
        return process.stdout if process.returncode == 0 else process.stderr
    except Exception as e:
        return str(e)

class Engine:
    def run(self, query: str) -> str:
        # 1. Limpa a query (tira o /ask ou /exec)
        user_query = clean_query(query)
        
        if not is_execution_task(query) and not query.startswith("/exec"):
            return generate(user_query)

        # 2. Prompt reforçado para gerar CÓDIGO PURO
        code_prompt = (
            f"Aja como um gerador de código. Converta o pedido abaixo em código executável.\n"
            f"Pedido: {user_query}\n"
            f"REGRAS:\n"
            f"- Responda APENAS com o código.\n"
            f"- Não use blocos de Markdown (sem ```).\n"
            f"- Se for /exec, use Python. Se for /ask, use JavaScript/Node.\n"
            f"- Não explique nada."
        )
        
        raw_code = generate(code_prompt)
        # Limpeza extra de markdown se a IA ignorar as regras
        code = raw_code.replace("```python", "").replace("```javascript", "").replace("```", "").strip()

        # 3. Roteamento
        dangerous_keywords = ["fs.", "os.", "process.", "child_process", "import ", "subprocess", "open("]
        is_dangerous = any(key in code.lower() for key in dangerous_keywords)
        is_forced_remote = query.lower().startswith("/exec")

        if is_dangerous or is_forced_remote:
            print(f"🛡️ ROTA: GitHub Actions")
            # Passamos o código já gerado para o executor não ter que gerar de novo
            return execute_task(user_query, lambda x: code)
        else:
            print(f"⚡ ROTA: Local")
            result = execute_locally(code)
            return f"✅ Resultado (Local):\n{result}"
