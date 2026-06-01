import sys, json

def catalog_prompts(niche):
    prompts = {
        "copywriting": [
            {"title": "Headline Viral", "category": "Copywriting", "prompt": "Crie 10 headlines para [PRODUTO] usando frameworks AIDA, PAS e 4U. Público-alvo: [AUDIÊNCIA]. Tom: [TOM].", "value": "$5-15"},
            {"title": "Email Sequência Vendas", "category": "Email Marketing", "prompt": "Escreva uma sequência de 5 emails de vendas para [PRODUTO]. Dia 1: problema. Dia 2: agitação. Dia 3: solução. Dia 4: prova social. Dia 5: CTA urgente.", "value": "$10-25"},
        ],
        "seo": [
            {"title": "Artigo SEO Completo", "category": "SEO", "prompt": "Escreva um artigo de 2000 palavras sobre [KEYWORD]. Estrutura: H2 a cada 300 palavras, FAQ no final, meta description otimizada. Inclua LSI keywords naturalmente.", "value": "$15-30"},
            {"title": "Cluster de Conteúdo", "category": "SEO", "prompt": "Crie um content cluster para [TOPICO PILLAR]. Liste 10 sub-tópicos (H2), 5 perguntas para cada (H3), e interligue tudo logicamente.", "value": "$10-20"},
        ],
        "social": [
            {"title": "30 Dias de Posts", "category": "Social Media", "prompt": "Crie um calendário de 30 posts para [REDE SOCIAL] sobre [NICHO]. Mix: 40% educativo, 30% entretenimento, 20% promocional, 10% engajamento. Inclua hooks e CTAs.", "value": "$15-35"},
            {"title": "Reels/TikTok Scripts", "category": "Vídeo", "prompt": "Escreva 5 scripts de 30-60 segundos para [PLATAFORMA] sobre [TEMA]. Estrutura: hook (0-3s), problema (3-15s), solução (15-45s), CTA (45-60s).", "value": "$10-25"},
        ],
        "business": [
            {"title": "Pitch Deck", "category": "Investimentos", "prompt": "Crie um pitch deck de 10 slides para [STARTUP]. Slides: problema, solução, TAM/SAM/SOM, modelo de receita, tração, time, competição, ask, contato.", "value": "$20-50"},
            {"title": "Business Model Canvas", "category": "Estratégia", "prompt": "Preencha um Business Model Canvas para [NEGÓCIO]. Para cada bloco (9 total), dê 3 opções e justifique a melhor escolha.", "value": "$10-25"},
        ]
    }
    
    result = prompts.get(niche.lower(), [])
    if not result:
        # Generic fallback
        result = [
            {"title": f"Prompt {niche.title()} #1", "category": niche.title(), "prompt": f"Crie um conteúdo completo sobre {niche} usando técnicas de copywriting avançadas. Estruture com headlines, bullets e CTAs.", "value": "$5-15"},
            {"title": f"Prompt {niche.title()} #2", "category": niche.title(), "prompt": f"Gere 10 ideias de produtos/serviços no nicho {niche} com análise de viabilidade e proposta de valor.", "value": "$10-20"},
        ]
    
    return {"prompts": result}

if __name__ == "__main__":
    print(json.dumps(catalog_prompts(sys.argv[1])))
