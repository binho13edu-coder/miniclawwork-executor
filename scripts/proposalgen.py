import sys, json

def generate_proposal(prop_json):
    p = json.loads(prop_json)
    
    scope_text = f"""1. *Diagnóstico Inicial*
   - Análise de requisitos e contexto do negócio
   - Entrega: relatório de 5-10 páginas

2. *Execução Principal*
   - {p.get('service', 'Serviço contratado')}
   - Metodologia ágil com sprints de 2 semanas
   - Reuniões de acompanhamento semanais

3. *Entregáveis*
   - Documentação técnica completa
   - Código fonte (se aplicável)
   - Treinamento de 2h para equipe
   - Suporte por 30 dias pós-entrega

4. *Cronograma*
   - Início: após aprovação da proposta
   - Duração: {p.get('deadline', '30 dias')}
   - Milestones: a cada 25% do projeto"""
    
    terms = """• Pagamento: 50% na assinatura, 50% na entrega
• Validade da proposta: 15 dias corridos
• Alterações de escopo: mediante aditivo
• Confidencialidade: NDA padrão aplicável
• Foro: cidade do cliente, lei brasileira"""
    
    return {
        "client": p.get("client", "Cliente"),
        "service": p.get("service", "Serviço"),
        "value": p.get("value", "R$ 0,00"),
        "deadline": p.get("deadline", "30 dias"),
        "scope_text": scope_text,
        "terms": terms
    }

if __name__ == "__main__":
    print(json.dumps(generate_proposal(sys.argv[1])))
