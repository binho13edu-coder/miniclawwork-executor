#!/usr/bin/env python3
import sys
import json
import subprocess

def main():
    args_file = sys.argv[1]
    with open(args_file, "r") as f:
        args = json.load(f)
    target = args.get("target", "")
    if not target:
        print("Alvo nao especificado")
        return
    try:
        result = subprocess.run(["/usr/bin/whois", target], capture_output=True, text=True, timeout=10)
        output = result.stdout if result.returncode == 0 else result.stderr
        lines = output.splitlines()
        filtered = [l for l in lines if any(k in l.lower() for k in ["domain", "registrar", "creation", "expiration", "name server", "status"])]
        print("\n".join(filtered[:30]))
    except Exception as e:
        print(f"Erro WHOIS: {e}")

if __name__ == "__main__":
    main()
