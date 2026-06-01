import sys, json

def generate_template(type_, topic):
    templates = {
        "notion": f"""📐 *Template Notion: {topic.title()}*

*Estrutura:*
1. 🎯 *Objetivos* — OKR ou SMART goals
2. 📋 *Tarefas* — Kanban (To Do / Doing / Done)
3. 📅 *Calendário* — Timeline de entregas
4. 📊 *Métricas* — Dashboard com progresso
5. 📝 *Notas* — Reuniões e decisões

*Como usar:*
1. Duplique o template
2. Preencha os objetivos
3. Mova cards no Kanban
4. Acompanhe métricas semanalmente

💡 Venda no Gumroad por $5-15""",
        
        "airtable": f"""📐 *Template Airtable: {topic.title()}*

*Tabelas:*
1. *Projetos* — Nome, Status, Responsável, Prazo
2. *Tarefas* — Vinculada a Projetos, Prioridade
3. *Recursos* — Orçamento, Horas, Custo
4. *Dashboard* — Gráficos de progresso

*Views:*
- Grid (padrão)
- Kanban (por status)
- Calendar (por prazo)
- Gallery (por responsável)

💡 Venda no Gumroad por $7-20""",
        
        "excel": f"""📐 *Template Excel: {topic.title()}*

*Abas:*
1. *Dashboard* — KPIs principais com gráficos
2. *Dados* — Tabela estruturada com validação
3. *Análise* — Tabela dinâmica + filtros
4. *Relatório* — Print-ready com formatação

*Features:*
- Fórmulas automáticas (SUM, VLOOKUP, IF)
- Validação de dados (dropdowns)
- Formatação condicional
- Gráficos dinâmicos

💡 Venda no Etsy por $3-10""",
        
        "sheets": f"""📐 *Template Google Sheets: {topic.title()}*

*Abas:*
1. *Dashboard* — KPIs com sparklines
2. *Dados* — Tabela com QUERY e FILTER
3. *Automação* — Apps Script para emails
4. *Relatório* — Compartilhável via link

*Features:*
- Fórmulas: ARRAYFORMULA, QUERY, IMPORTRANGE
- Script: envio automático de relatórios
- Trigger: diário/semanal
- Permissões: view-only para clientes

💡 Venda no Gumroad por $5-15"""
    }
    
    return {"template": templates.get(type_, templates["notion"])}

if __name__ == "__main__":
    print(json.dumps(generate_template(sys.argv[1], sys.argv[2])))
