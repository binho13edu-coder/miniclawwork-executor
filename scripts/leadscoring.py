import sys, json

def score_lead(lead_json):
    lead = json.loads(lead_json)
    score = 0
    breakdown = {"budget": 0, "authority": 0, "need": 0, "timing": 0}
    
    # Budget scoring
    budget = lead.get("budget", "0").lower()
    if any(x in budget for x in ["10k", "10000", "20k", "50000", "mil"]):
        breakdown["budget"] = 25
    elif any(x in budget for x in ["5k", "5000", "8k", "8000"]):
        breakdown["budget"] = 20
    elif any(x in budget for x in ["1k", "1000", "2k", "2000"]):
        breakdown["budget"] = 15
    elif budget not in ["n/a", "na", ""]:
        breakdown["budget"] = 10
    else:
        breakdown["budget"] = 5
    
    # Authority scoring
    auth = lead.get("authority", "").lower()
    if any(x in auth for x in ["ceo", "cto", "diretor", "founder", "founder", "proprietário"]):
        breakdown["authority"] = 25
    elif any(x in auth for x in ["gerente", "manager", "head", "coordenador"]):
        breakdown["authority"] = 20
    elif any(x in auth for x in ["analista", "especialista", "consultor"]):
        breakdown["authority"] = 15
    elif auth not in ["n/a", "na", ""]:
        breakdown["authority"] = 10
    else:
        breakdown["authority"] = 5
    
    # Need scoring
    need = lead.get("need", "").lower()
    if any(x in need for x in ["urgente", "crítico", "critical", "asap", "imediato"]):
        breakdown["need"] = 25
    elif any(x in need for x in ["alto", "high", "importante", "prioridade"]):
        breakdown["need"] = 20
    elif any(x in need for x in ["médio", "medium", "moderado"]):
        breakdown["need"] = 15
    elif need not in ["n/a", "na", ""]:
        breakdown["need"] = 10
    else:
        breakdown["need"] = 5
    
    # Timing scoring
    timing = lead.get("timing", "").lower()
    if any(x in timing for x in ["agora", "now", "esta semana", "this week", "imediato"]):
        breakdown["timing"] = 25
    elif any(x in timing for x in ["este mês", "this month", "30 dias", "30 days"]):
        breakdown["timing"] = 20
    elif any(x in timing for x in ["este trimestre", "this quarter", "90 dias"]):
        breakdown["timing"] = 15
    elif timing not in ["n/a", "na", ""]:
        breakdown["timing"] = 10
    else:
        breakdown["timing"] = 5
    
    score = sum(breakdown.values())
    
    if score >= 85:
        qual = "🔥 HOT LEAD (Qualificado)"
        rec = "Priorize imediatamente. Proposta em 24h."
    elif score >= 70:
        qual = "🟡 WARM LEAD (Potencial)"
        rec = "Nutrição ativa. Follow-up em 48h."
    elif score >= 50:
        qual = "🟠 COOL LEAD (Em desenvolvimento)"
        rec = "Cadastre na sequência de nutrição."
    else:
        qual = "🔵 COLD LEAD (Descartar)"
        rec = "Não investir tempo agora. Reavaliar em 6 meses."
    
    return {
        "score": score,
        "qualification": qual,
        "breakdown": breakdown,
        "recommendation": rec
    }

if __name__ == "__main__":
    print(json.dumps(score_lead(sys.argv[1])))
