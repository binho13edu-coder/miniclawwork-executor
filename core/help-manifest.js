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
