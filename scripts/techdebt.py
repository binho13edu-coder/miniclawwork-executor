import sys, json, urllib.request, re
from datetime import datetime

def analyze_repo(repo_input):
    # Parse input: user/repo or full URL
    repo = repo_input.replace("https://github.com/", "").replace("http://github.com/", "").strip("/")
    if "/" not in repo:
        return {"repo": repo_input, "score": 0, "last_commit": "N/A", "deps_count": 0, "findings": [{"severity": "ERRO", "category": "Input", "description": "Formato inválido. Use: usuario/repo"}]}
    
    findings = []
    score = 10
    last_commit = "N/A"
    deps_count = 0
    
    # Try to fetch repo info via GitHub API (no auth, rate limited)
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}", headers={"User-Agent": "MiniClawwork"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            last_commit = data.get("pushed_at", "N/A")[:10]
            if data.get("archived"):
                findings.append({"severity": "ALTA", "category": "Status", "description": "Repositório arquivado"})
                score -= 2
            if data.get("open_issues_count", 0) > 50:
                findings.append({"severity": "MEDIA", "category": "Issues", "description": f"{data['open_issues_count']} issues abertas"})
                score -= 1
    except Exception as e:
        findings.append({"severity": "MEDIA", "category": "API", "description": f"Não foi possível acessar GitHub API: {str(e)}"})
        score -= 1
    
    # Check for package.json, requirements.txt, etc.
    for fname, ftype in [("package.json", "npm"), ("requirements.txt", "pip"), ("Cargo.toml", "cargo"), ("go.mod", "go")]:
        try:
            req = urllib.request.Request(f"https://raw.githubusercontent.com/{repo}/HEAD/{fname}", headers={"User-Agent": "MiniClawwork"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read().decode()
                lines = [l for l in content.split('\n') if l.strip() and not l.strip().startswith('#')]
                deps_count += len(lines)
                if ftype == "npm" and '"dependencies"' in content:
                    # Check for outdated patterns
                    if re.search(r'"[\\^~]', content):
                        findings.append({"severity": "BAIXA", "category": "Deps", "description": f"package.json usa versionamento flexível (^/~)"})
                        score -= 0.5
        except:
            pass
    
    # Check for README
    try:
        req = urllib.request.Request(f"https://raw.githubusercontent.com/{repo}/HEAD/README.md", headers={"User-Agent": "MiniClawwork"})
        urllib.request.urlopen(req, timeout=5)
    except:
        findings.append({"severity": "MEDIA", "category": "Docs", "description": "README.md não encontrado"})
        score -= 1
    
    # Check for tests
    for test_dir in ["tests", "test", "__tests__", "spec"]:
        try:
            req = urllib.request.Request(f"https://api.github.com/repos/{repo}/contents/{test_dir}", headers={"User-Agent": "MiniClawwork"})
            urllib.request.urlopen(req, timeout=5)
            break
        except:
            continue
    else:
        findings.append({"severity": "ALTA", "category": "Tests", "description": "Diretório de testes não encontrado"})
        score -= 2
    
    score = max(0, min(10, round(score, 1)))
    
    return {
        "repo": repo,
        "score": score,
        "last_commit": last_commit,
        "deps_count": deps_count,
        "findings": findings
    }

if __name__ == "__main__":
    print(json.dumps(analyze_repo(sys.argv[1])))
