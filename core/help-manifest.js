const manifest = [];

function register(cmd) {
    if (!cmd || !cmd.name) return;
    
    const existingIndex = manifest.findIndex(c => c.name === cmd.name);
    
    const newCmd = {
        name: cmd.name,
        description: cmd.description || '',
        aliases: Array.isArray(cmd.aliases) ? cmd.aliases : [],
        category: cmd.category || 'Uncategorized',
        examples: Array.isArray(cmd.examples) ? cmd.examples : [],
        status: cmd.status || 'active',
        risk: cmd.risk || 'low',
        requiresConfirmation: Boolean(cmd.requiresConfirmation)
    };

    if (existingIndex !== -1) {
        manifest[existingIndex] = newCmd;
    } else {
        manifest.push(newCmd);
    }
}

function search(query) {
    if (!query) return [];
    const q = String(query).toLowerCase();
    return manifest.filter(cmd => {
        return String(cmd.name).toLowerCase().includes(q) ||
               String(cmd.description).toLowerCase().includes(q) ||
               String(cmd.category).toLowerCase().includes(q) ||
               cmd.aliases.some(alias => String(alias).toLowerCase().includes(q));
    });
}

function listByCategory() {
    return manifest.reduce((acc, cmd) => {
        const cat = cmd.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(cmd);
        return acc;
    }, {});
}

function getHelpText(cmdName) {
    if (!cmdName) return '';
    const q = String(cmdName).toLowerCase();
    const cmd = manifest.find(c => 
        String(c.name).toLowerCase() === q || 
        c.aliases.some(a => String(a).toLowerCase() === q)
    );
    
    if (!cmd) return 'Command not found.';
    
    let text = `Command: ${cmd.name}\n`;
    if (cmd.aliases.length > 0) {
        text += `Aliases: ${cmd.aliases.join(', ')}\n`;
    }
    text += `Category: ${cmd.category}\n`;
    text += `Description: ${cmd.description}\n`;
    
    if (cmd.examples.length > 0) {
        text += `Examples:\n`;
        cmd.examples.forEach(ex => {
            text += `- ${ex}\n`;
        });
    }
    
    return text.trim();
}

module.exports = {
    register,
    search,
    listByCategory,
    getHelpText,
    listAll: () => manifest.map(command => ({ ...command })),
    get: (name) => manifest.find(command =>
        command.name === String(name || '').toLowerCase() ||
        command.aliases.includes(String(name || '').toLowerCase())
    ) || null
};

// V90-NEW-Z3 — Registro de comandos para /help semântico
register({ name: 'trimmer', description: 'Comprime chunks antigos de baixa importancia via LLM', category: 'Sistema', examples: ['/trimmer'], risk: 'high', requiresConfirmation: true });
register({ name: 'heal', description: 'Auto-healing: remove chunks orfaos, duplicados e arquiva antigos', category: 'Sistema', examples: ['/heal'], risk: 'high', requiresConfirmation: true });
register({ name: 'ctx', description: 'Gerencia contexto e knowledge base', category: 'Sistema', examples: ['/ctx forget', '/ctx buscar leads', '/ctx recente'] });
register({ name: 'plan', description: 'Gera plano de acao estrategico via LLM', category: 'Produtividade', examples: ['/plan aumentar vendas B2B', '/plan calc 5|A,2,300,300,1|B,3,500,500,1'], risk: 'medium' });
register({ name: 'leads', description: 'Busca leads B2B por termo', category: 'Negocios', examples: ['/leads software', '/leads status'], risk: 'medium' });
register({ name: 'fin', description: 'Registra gastos e receitas', category: 'Financeiro', examples: ['/fin almoco 45.50', '/fin salario -5000'], risk: 'medium' });
register({ name: 'status', description: 'Status do sistema e recursos', category: 'Sistema', examples: ['/status'] });
register({ name: 'btc', description: 'Cotacao do Bitcoin', category: 'Crypto', examples: ['/btc'] });
register({ name: 'dolar', description: 'Cotacao do Dolar', category: 'Crypto', examples: ['/dolar'] });
register({ name: 'menu', description: 'Menu principal com todos os comandos', category: 'Sistema', examples: ['/menu'] });
register({
    name: 'osint',
    description: 'Diagnóstico externo defensivo, proposta e validação pós-correção',
    aliases: ['seguranca', 'security'],
    category: 'Seguranca',
    status: 'active',
    risk: 'medium',
    requiresConfirmation: true,
    examples: [
        '/osint avaliar exemplo.com',
        '/osint proposta exemplo.com',
        '/osint comparar exemplo.com',
        '/osint historico exemplo.com',
        '/osint exportar exemplo.com',
        '/osint catalogo',
        '/osint dns exemplo.com',
        '/osint headers exemplo.com',
        '/osint tech exemplo.com',
        '/osint email contato@exemplo.com'
    ]
});
register({ name: 'dominancia', description: 'Consulta dominância do Bitcoin', category: 'Crypto', examples: ['/dominancia'], risk: 'low' });
register({ name: 'alertas', description: 'Lista alertas de mercado ativos', category: 'Crypto', examples: ['/alertas'], risk: 'low' });
register({ name: 'metrics', description: 'Exibe métricas de uso do sistema', category: 'Sistema', examples: ['/metrics'], risk: 'low' });
register({ name: 'cache', description: 'Exibe estatísticas do cache LLM', category: 'Sistema', examples: ['/cache'], risk: 'low' });
register({ name: 'corrigir', description: 'Registra correções para aprendizado controlado', category: 'Knowledge', examples: ['/corrigir <texto>', '/corrigir list'], risk: 'medium' });
register({ name: 'help', description: 'Consulta ajuda determinística ou semântica', category: 'Sistema', examples: ['/help', '/help osint'], risk: 'low' });
register({ name: 'dump', description: 'Faz triagem executiva e registra o resultado', category: 'Knowledge', examples: ['/dump <texto>'], risk: 'medium' });
register({ name: 'git', description: 'Executa operações Git com prévia e confirmação', category: 'Sistema', examples: ['/git status', '/git log', '/git confirmar'], risk: 'high', requiresConfirmation: true });
register({ name: 'reminder', description: 'Agenda e gerencia lembretes', category: 'Produtividade', examples: ['/reminder 30 revisar proposta'], risk: 'medium' });
register({ name: 'schedule', description: 'Gerencia agendamentos recorrentes', category: 'Produtividade', examples: ['/schedule list'], risk: 'medium' });
register({ name: 'export', description: 'Exporta leads ou finanças para CSV', category: 'Produtividade', examples: ['/export leads', '/export fin'], risk: 'low' });
register({ name: 'invoicetrack', description: 'Gerencia rastreamento de faturas', category: 'Financeiro', examples: ['/invoicetrack'], risk: 'medium' });
register({ name: 'ctx_forget', description: 'Remove memórias selecionadas com confirmação', category: 'Knowledge', examples: ['/ctx_forget list'], risk: 'high', requiresConfirmation: true });
