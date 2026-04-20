from llm_client import generate
from github_executor import is_execution_task, execute_task

class Engine:
    def run(self, query: str) -> str:
        if is_execution_task(query):
            return execute_task(query, generate)
        return generate(query)
