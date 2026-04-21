import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'downloads', 'dist']);
const ignoredFiles = new Set(['package-lock.json', 'scan-sensitive.js']);

const patterns = [
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'AWS access key', regex: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'Private key block', regex: /BEGIN [A-Z ]*PRIVATE KEY/g },
  { name: 'Bearer token', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  { name: 'Signed URL marker', regex: /(?:Signature=|Expires=|Policy=|X-Amz-Signature=|X-Amz-Credential=)/g },
  { name: 'Session/cookie literal', regex: /\b(?:cookie|sessionid|csrf_token|auth_token)\b\s*[:=]\s*['"][^'"]+['"]/gi },
];

const findings = [];
walk(rootDir);

if (findings.length > 0) {
  console.error('Sensitive-looking content detected:\n');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}  ${finding.name}`);
  }
  process.exit(1);
}

console.log('No sensitive hardcoded content detected in tracked source files.');

function walk(currentDir) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(path.join(currentDir, entry.name));
      }
      continue;
    }

    if (ignoredFiles.has(entry.name)) {
      continue;
    }

    const filePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, filePath);

    if (!isTextLike(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const pattern of patterns) {
      for (let index = 0; index < lines.length; index += 1) {
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(lines[index])) {
          findings.push({
            file: relativePath,
            line: index + 1,
            name: pattern.name,
          });
        }
      }
    }
  }
}

function isTextLike(relativePath) {
  return /\.(?:md|txt|json|ya?ml|ts|js|mjs|cjs|gitignore|npmignore)$/i.test(relativePath) ||
    path.basename(relativePath).startsWith('.');
}
