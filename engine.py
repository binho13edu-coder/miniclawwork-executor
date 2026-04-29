from llm_client import generate
from github_executor import execute_task_raw, is_execution_task

class Engine:
    def run(self, query: str) -> str:
        # Se começar com 'execute:', pula a IA e manda direto pro GitHub
        if query.lower().startswith("execute:"):
            code = query.split("execute:")[1].strip()
            return execute_task_raw(code)
        
        # Se for uma pergunta normal, usa a IA
        return generate(query)
