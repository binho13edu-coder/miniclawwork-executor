const manifest = [];

function register(cmd) {
    if (!cmd || !cmd.name) return;
    
    const existingIndex = manifest.findIndex(c => c.name === cmd.name);
    
    const newCmd = {
        name: cmd.name,
        description: cmd.description || '',
        aliases: Array.isArray(cmd.aliases) ? cmd.aliases : [],
        category: cmd.category || 'Uncategorized',
        examples: Array.isArray(cmd.examples) ? cmd.examples : []
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
    getHelpText
};

// V90-NEW-Z3 — Registro de comandos para /help semântico
register({ name: 'hackflow', description: 'Pipeline hacking integrado: recon → scan → osint → attack → analyze', category: 'Seguranca', examples: ['/hackflow example.com credential_exfiltration'] });
register({ name: 'trimmer', description: 'Comprime chunks antigos de baixa importancia via LLM', category: 'Sistema', examples: ['/trimmer'] });
register({ name: 'heal', description: 'Auto-healing: remove chunks orfaos, duplicados e arquiva antigos', category: 'Sistema', examples: ['/heal'] });
register({ name: 'aiattack', description: 'Simula ataque de ciberseguranca educacional', category: 'Seguranca', examples: ['/aiattack test.com credential_exfiltration'] });
register({ name: 'aimonitor', description: 'Monitora ataque simulado em tempo real', category: 'Seguranca', examples: ['/aimonitor attack_20260603213338'] });
register({ name: 'aianalyze', description: 'Analisa resultados de ataque simulado', category: 'Seguranca', examples: ['/aianalyze {"orchestrator":{"start_time":"2026-06-03T21:33:38"}}'] });
register({ name: 'ctx', description: 'Gerencia contexto e knowledge base', category: 'Sistema', examples: ['/ctx forget', '/ctx buscar leads', '/ctx recente'] });
register({ name: 'plan', description: 'Gera plano de acao estrategico via LLM', category: 'Produtividade', examples: ['/plan aumentar vendas B2B'] });
register({ name: 'leads', description: 'Busca leads B2B por termo', category: 'Negocios', examples: ['/leadssoftware', '/leads status'] });
register({ name: 'fin', description: 'Registra gastos e receitas', category: 'Financeiro', examples: ['/fin almoco 45.50', '/fin salario -5000'] });
register({ name: 'status', description: 'Status do sistema e recursos', category: 'Sistema', examples: ['/status'] });
register({ name: 'btc', description: 'Cotacao do Bitcoin', category: 'Crypto', examples: ['/btc'] });
register({ name: 'dolar', description: 'Cotacao do Dolar', category: 'Crypto', examples: ['/dolar'] });
register({ name: 'menu', description: 'Menu principal com todos os comandos', category: 'Sistema', examples: ['/menu'] });
