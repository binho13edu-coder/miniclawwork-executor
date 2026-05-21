const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = ['commands', 'skills', 'core', 'jobs', 'tools'];
const IGNORE_DIRS = ['node_modules', '.git', 'backups', 'logs'];

const LEAK_PATTERNS = [
    {
        type: 'Event Listener',
        severity: 'warn',
        regex: /\.on\(\s*['"][^'"]+['"]\s*,/,
        clearRegex: /\.removeListener\(|\.off\(/,
        desc: 'Listener added (ensure .removeListener or .off is called if not bounded)'
    },
    {
        type: 'Database Connection',
        severity: 'critical',
        regex: /new Database\(/,
        clearRegex: /\.close\(\)/,
        desc: 'better-sqlite3 Database opened (ensure .close() is called if transient)'
    },
    {
        type: 'Interval/Timeout',
        severity: 'warn',
        regex: /(setInterval|setTimeout)\(/,
        clearRegex: /(clearInterval|clearTimeout)\(/,
        desc: 'Timer created (ensure it is cleared to prevent memory/CPU leaks)'
    }
];

function walkDir(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(entry)) {
                walkDir(fullPath, files);
            }
        } else if (fullPath.endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function scanFile(filePath) {
    const relativePath = path.relative(ROOT_DIR, filePath);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const findings = [];
    const fullContent = lines.join('\n');

    const hasClear = {};
    for (const pattern of LEAK_PATTERNS) {
        if (pattern.clearRegex) {
            hasClear[pattern.type] = pattern.clearRegex.test(fullContent);
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of LEAK_PATTERNS) {
            if (pattern.regex.test(line)) {
                if (hasClear[pattern.type] === false) {
                    findings.push({
                        line: i + 1,
                        type: pattern.type,
                        severity: pattern.severity,
                        desc: pattern.desc,
                        code: line.trim()
                    });
                } else {
                    findings.push({
                        line: i + 1,
                        type: pattern.type,
                        severity: 'info',
                        desc: `${pattern.desc} (Clear operation detected in file, but manual review recommended)`,
                        code: line.trim()
                    });
                }
            }
        }

        if (!line.includes('const ') && !line.includes('let ') && !line.includes('var ') && /^[a-zA-Z_$][0-9a-zA-Z_$]*\s*=[^=]/.test(line.trim())) {
            if (line.trim().startsWith('module.exports') || line.trim().startsWith('exports.')) continue;
            findings.push({
                line: i + 1,
                type: 'Implicit Global',
                severity: 'critical',
                desc: 'Variable assigned without var/let/const (leaks into global scope)',
                code: line.trim()
            });
        }
    }

    if (findings.length > 0) {
        console.log(`\n📄 ${relativePath}`);
        findings.forEach(f => {
            const color = f.severity === 'critical' ? '\x1b[31m' : f.severity === 'warn' ? '\x1b[33m' : '\x1b[36m';
            console.log(`  ${color}[${f.severity.toUpperCase()}]\x1b[0m Line ${f.line}: ${f.type}`);
            console.log(`    → ${f.desc}`);
            console.log(`    > ${f.code.length > 80 ? f.code.substring(0, 77) + '...' : f.code}`);
        });
    }
}

function runAuditor() {
    console.log('🔍 Starting Leak Auditor...');
    console.log('Scanning directories:', TARGET_DIRS.join(', '));

    const allFiles = [];
    for (const targetDir of TARGET_DIRS) {
        walkDir(path.join(ROOT_DIR, targetDir), allFiles);
    }

    const rootFiles = ['index.js', 'ecosystem.config.js'];
    for (const file of rootFiles) {
        const fullPath = path.join(ROOT_DIR, file);
        if (fs.existsSync(fullPath)) {
            allFiles.push(fullPath);
        }
    }

    for (const filePath of allFiles) {
        scanFile(filePath);
    }

    console.log('\n✅ Audit complete. Review warnings above.');
}

runAuditor();
