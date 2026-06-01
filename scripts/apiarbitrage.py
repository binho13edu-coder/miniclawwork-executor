import sys, json

def find_apis(niche):
    # Curated list of high-value free APIs
    api_db = {
        "general": [
            {"name": "RapidAPI Hub", "description": "Marketplace com 40k+ APIs, muitas com tier gratuito", "value": "Alto", "free_tier": "500-1000 req/mês"},
            {"name": "GitHub REST API", "description": "Acesso a repositórios, issues, PRs. 5000 req/h", "value": "Alto", "free_tier": "5000/h"},
            {"name": "OpenWeatherMap", "description": "Dados meteorológicos globais", "value": "Médio", "free_tier": "1000/dia"},
            {"name": "NewsAPI", "description": "Notícias de 30k+ fontes", "value": "Alto", "free_tier": "100/dia"},
            {"name": "CoinGecko", "description": "Dados crypto em tempo real", "value": "Alto", "free_tier": "10-30 calls/min"},
            {"name": "ExchangeRate-API", "description": "Câmbio em tempo real", "value": "Médio", "free_tier": "1500/mês"},
            {"name": "Abstract API", "description": "Validação email, geolocalização, holidays", "value": "Médio", "free_tier": "100-500/mês"},
            {"name": "IPGeolocation", "description": "Geolocalização por IP", "value": "Médio", "free_tier": "1000/dia"},
        ],
        "finance": [
            {"name": "Alpha Vantage", "description": "Dados financeiros e técnicos", "value": "Alto", "free_tier": "25 calls/dia"},
            {"name": "Financial Modeling Prep", "description": "Fundamentos de ações", "value": "Alto", "free_tier": "250 calls/dia"},
            {"name": "Twelve Data", "description": "Precisa de ações, forex, crypto", "value": "Alto", "free_tier": "800/dia"},
            {"name": "CoinGecko", "description": "Crypto dados completos", "value": "Alto", "free_tier": "Ilimitado (rate limited)"},
        ],
        "marketing": [
            {"name": "Clearbit Logo API", "description": "Logos de empresas por domínio", "value": "Médio", "free_tier": "Ilimitado"},
            {"name": "Hunter.io", "description": "Busca de emails profissionais", "value": "Alto", "free_tier": "25/mês"},
            {"name": "SerpAPI", "description": "Resultados Google Search", "value": "Alto", "free_tier": "100/mês"},
        ],
        "ai": [
            {"name": "Hugging Face Inference", "description": "100k+ modelos ML gratuitos", "value": "Alto", "free_tier": "Rate limited"},
            {"name": "Cohere API", "description": "Embeddings e geração de texto", "value": "Alto", "free_tier": "1000 calls/mês"},
            {"name": "Groq API", "description": "LLMs ultra-rápidas (Llama, Mixtral)", "value": "Alto", "free_tier": "Generoso"},
        ]
    }
    
    apis = api_db.get(niche.lower(), api_db["general"])
    # Add niche-specific suggestions
    if niche.lower() not in api_db:
        apis = api_db["general"] + [{"name": f"{niche.title()}API", "description": f"Busque APIs de {niche} no RapidAPI ou ProgrammableWeb", "value": "Varia", "free_tier": "Verificar"}]
    
    return {"apis": apis}

if __name__ == "__main__":
    print(json.dumps(find_apis(sys.argv[1])))
