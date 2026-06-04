import json
import subprocess
import argparse
import sys
from datetime import datetime

# Importa analysis_engine diretamente para evitar subprocess com JSON
sys.path.insert(0, 'scripts')
from analysis_engine import analyze_attack

class AIAttackSimulator:
    def __init__(self):
        self.attack_id = None
        self.start_time = None
        
    def simulate_attack(self, target, scenario, parameters=None):
        self.attack_id = f"attack_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        self.start_time = datetime.now()
        
        cmd = ["python3", "scripts/attack_engine.py", "--target", target, "--scenario", scenario]
        if parameters:
            for k, v in parameters.items():
                cmd.extend(["--" + k, str(v)])
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            return json.loads(result.stdout)
        except Exception as e:
            return {"error": str(e)}
            
    def monitor_attack(self, attack_id):
        cmd = ["python3", "scripts/monitor_engine.py", "--attack-id", attack_id]
        result = subprocess.run(cmd, capture_output=True, text=True)
        return json.loads(result.stdout)
        
    def analyze_results(self, attack_data):
        # Chama diretamente em vez de subprocess
        return analyze_attack(attack_data)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=["simulate", "monitor", "analyze"])
    parser.add_argument("--target")
    parser.add_argument("--scenario")
    parser.add_argument("--parameters", type=json.loads, default="{}")
    args = parser.parse_args()
    
    simulator = AIAttackSimulator()
    
    if args.action == "simulate":
        print(json.dumps(simulator.simulate_attack(args.target, args.scenario, args.parameters)))
    elif args.action == "monitor":
        print(json.dumps(simulator.monitor_attack(args.target)))
    elif args.action == "analyze":
        # Lê JSON do stdin
        input_data = sys.stdin.read()
        try:
            attack_data = json.loads(input_data) if input_data else {"orchestrator": {"start_time": datetime.now().isoformat()}}
        except:
            attack_data = {"orchestrator": {"start_time": datetime.now().isoformat()}}
        print(json.dumps(simulator.analyze_results(attack_data)))
