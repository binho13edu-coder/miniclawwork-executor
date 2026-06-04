import json
import argparse
from datetime import datetime

def monitor_attack(attack_id):
    status = {
        "attack_id": attack_id,
        "current_phase": "database_extraction",
        "progress": 100,
        "duration_seconds": 120,
        "anomalies_detected": 0,
        "defenses_bypassed": 3
    }
    
    if datetime.now().minute % 5 == 0:
        status["anomalies_detected"] += 1
    
    return status

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--attack-id")
    args = parser.parse_args()
    
    print(json.dumps(monitor_attack(args.attack_id)))
