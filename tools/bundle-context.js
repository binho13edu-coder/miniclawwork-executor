/**
 * tools/bundle-context.js
 * Automated context snapshot generator
 * 
 * Generates docs/context-snapshot.md with system info, active modules,
 * recent commits, PM2 status, backlog, and DB info.
 * 
 * Runs safely using only built-ins and git/pm2 CLIs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'context-snapshot.md');

// Helper to run bash commands safely
function runCmd(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
        return 'N/A';
    }
}

// 1. Cabeçalho (Header)
const timestamp = new Date().toISOString();
const gitHash = runCmd('git rev-parse --short HEAD');
const systemUptimeSecs = Math.floor(require('os').uptime());
const systemUptime = `${Math.floor(systemUptimeSecs / 3600)}h ${Math.floor((systemUptimeSecs % 3600) / 60)}m`;
let pm2StatusHeader = 'N/A';
try {
    const pm2Output = runCmd('pm2 jlist');
    if (pm2Output !== 'N/A') {
        const pm2List = JSON.parse(pm2Output);
        if (pm2List.length > 0) {
            pm2StatusHeader = pm2List[0].pm2_env.status || 'N/A';
        }
    }
} catch (e) {}

let headerSection = `## Cabeçalho
- **Timestamp:** ${timestamp}
- **Git Hash:** ${gitHash}
- **PM2 Status:** ${pm2StatusHeader}
- **System Uptime:** ${systemUptime}
`;

// 2. Módulos Ativos (Active Modules)
let modulesSection = `## Módulos Ativos\n`;
const directoriesToScan = ['core', 'jobs', 'tools'];
directoriesToScan.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
        files.forEach(file => {
            const filePath = path.join(dirPath, file);
            let exportsList = 'N/A';
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const exportRegex = /module\.exports\s*=\s*{([^}]+)}/g;
                let match;
                const foundExports = [];
                while ((match = exportRegex.exec(fileContent)) !== null) {
                    const exportsString = match[1];
                    const props = exportsString.split(',').map(s => s.trim().split(':')[0]).filter(s => s);
                    foundExports.push(...props);
                }
                if (foundExports.length > 0) {
                    exportsList = foundExports.join(', ');
                }
            } catch (e) {
                // Ignore parsing errors
            }
            modulesSection += `- **${dir}/${file}**: ${exportsList}\n`;
        });
    }
});
if (modulesSection === `## Módulos Ativos\n`) modulesSection += `N/A\n`;

// 3. Commits Recentes (Recent Commits)
let commitsSection = `## Commits Recentes\n`;
const recentCommits = runCmd('git log --oneline -10');
if (recentCommits && recentCommits !== 'N/A') {
    commitsSection += '```\n' + recentCommits + '\n```\n';
} else {
    commitsSection += `N/A\n`;
}

// 4. Status Operacional (Operational Status)
let opStatusSection = `## Status Operacional\n`;
let pm2Found = false;
try {
    const pm2Output = runCmd('pm2 jlist');
    if (pm2Output !== 'N/A') {
        const pm2List = JSON.parse(pm2Output);
        if (pm2List.length > 0) {
            pm2Found = true;
            pm2List.forEach(app => {
                const memMB = Math.round(app.monit.memory / 1024 / 1024);
                const upTimeMs = Date.now() - app.pm2_env.pm_uptime;
                const upTimeHrs = Math.floor(upTimeMs / 1000 / 3600);
                const upTimeMins = Math.floor((upTimeMs / 1000 % 3600) / 60);
                opStatusSection += `- **${app.name}**: ${memMB}MB RAM, Uptime: ${upTimeHrs}h ${upTimeMins}m, Restarts: ${app.pm2_env.restart_time}\n`;
            });
        }
    }
} catch (e) {}
if (!pm2Found) {
    opStatusSection += `N/A\n`;
}

// 5. Backlog Pendente (Pending Backlog)
let backlogSection = `## Backlog Pendente\n`;
const miniclawworkPath = path.join(__dirname, '..', 'MINICLAWWORK.md');
if (fs.existsSync(miniclawworkPath)) {
    const content = fs.readFileSync(miniclawworkPath, 'utf8');
    const roadmapMatch = content.match(/##\s*9\.\s*Roadmap[\s\S]*?(?=##\s*10\.|$)/i);
    if (roadmapMatch) {
        const roadmapText = roadmapMatch[0];
        const blockedItems = roadmapText.match(/.*BLOCKED.*/gi);
        if (blockedItems && blockedItems.length > 0) {
            blockedItems.forEach(item => {
                backlogSection += `${item.trim()}\n`;
            });
        } else {
            backlogSection += `No BLOCKED items found in Roadmap.\n`;
        }
    } else {
        backlogSection += `Roadmap section not found.\n`;
    }
} else {
    backlogSection += `MINICLAWWORK.md not found.\n`;
}

// 6. Resumo do Banco de Dados (Database Summary)
let dbSection = `## Resumo do Banco de Dados\n`;
const dataDir = path.join(__dirname, '..', 'data');
if (fs.existsSync(dataDir)) {
    try {
        const lsOutput = runCmd(`ls -lh "${dataDir}" | grep "\\.db"`);
        if (lsOutput && lsOutput !== 'N/A') {
            const files = lsOutput.split('\n').filter(l => l.trim());
            files.forEach(line => {
                const parts = line.split(/\s+/);
                if (parts.length >= 9) {
                    const size = parts[4];
                    const name = parts.slice(8).join(' ');
                    dbSection += `- **${name}**: ${size}\n`;
                } else {
                    dbSection += `- ${line}\n`;
                }
            });
        } else {
             dbSection += `N/A\n`;
        }
    } catch(e) {
        dbSection += `N/A\n`;
    }
} else {
    dbSection += `Data directory not found.\n`;
}

// 7. Verificação de Ambiente (Environment Check)
let envSection = `## Verificação de Ambiente\n`;
const envPath = path.join(__dirname, '..', '.env');
const envExists = fs.existsSync(envPath);
envSection += `- **.env exists:** ${envExists ? 'Yes' : 'No'}\n\n`;

const indexPath = path.join(__dirname, '..', 'index.js');
let requiredEnvVars = [];
if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const reqEnvMatch = indexContent.match(/REQUIRED_ENV\s*=\s*\[([^\]]+)\]/);
    if (reqEnvMatch) {
        const varsStr = reqEnvMatch[1];
        requiredEnvVars = varsStr.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(s => s);
    }
}

if (requiredEnvVars.length > 0) {
    let envContent = '';
    if (envExists) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }
    requiredEnvVars.forEach(v => {
        const isPresent = envExists && new RegExp(`^${v}=`, 'm').test(envContent);
        envSection += `- **${v}**: ${isPresent ? 'Present' : 'Missing'}\n`;
    });
} else {
    envSection += `N/A\n`;
}

// Combine all sections
const finalOutput = `${headerSection}
${modulesSection}
${commitsSection}
${opStatusSection}
${backlogSection}
${dbSection}
${envSection}`;

// Write to output file
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, finalOutput, 'utf8');
console.log(`Snapshot generated at ${OUTPUT_PATH}`);
