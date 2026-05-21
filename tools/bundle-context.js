const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'context-snapshot.md');

const TARGET_DIRS = ['commands', 'skills', 'core', 'jobs'];
const IGNORE_DIRS = ['node_modules', '.git', 'backups', 'logs'];
const IGNORE_EXTS = ['.bak', '.log'];
const ALLOWED_EXTS = ['.js', '.json'];

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(file)) walkDir(filePath, callback);
        } else {
            const ext = path.extname(file).toLowerCase();
            if (ALLOWED_EXTS.includes(ext) && !IGNORE_EXTS.includes(ext)) {
                callback(filePath);
            }
        }
    }
}

function generateSnapshot() {
    console.log('Generating context-snapshot.md...');
    let outputContent = '# MiniClawwork Context Snapshot\n\n';
    let fileCount = 0;
    for (const targetDir of TARGET_DIRS) {
        const fullPath = path.join(ROOT_DIR, targetDir);
        walkDir(fullPath, (filePath) => {
            try {
                const relativePath = path.relative(ROOT_DIR, filePath);
                const content = fs.readFileSync(filePath, 'utf8');
                const lang = filePath.endsWith('.json') ? 'json' : 'javascript';
                outputContent += `### ${relativePath}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
                fileCount++;
            } catch (err) {
                console.error(`Error reading ${filePath}:`, err.message);
            }
        });
    }
    fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf8');
    console.log(`Snapshot generated successfully at ${OUTPUT_FILE} (${fileCount} files included).`);
}

generateSnapshot();
