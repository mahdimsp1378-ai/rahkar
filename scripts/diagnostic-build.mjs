import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const checks = [
  'server/public-ai-consultation.js',
  'server/start.js',
  'src/home-v3.jsx',
  'src/account.jsx',
  'README-LOCAL-FA.md',
].map(path => ({ path, exists: existsSync(resolve(root, path)) }));
const ok = checks.every(item => item.exists);
mkdirSync(resolve(root, 'dist'), { recursive: true });
const payload = { ok, node: process.version, checks, createdAt: new Date().toISOString() };
writeFileSync(resolve(root, 'dist', 'diagnostic.json'), JSON.stringify(payload, null, 2));
writeFileSync(resolve(root, 'dist', 'index.html'), `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>Rahkar diagnostic</title><body><pre>${JSON.stringify(payload, null, 2)}</pre></body></html>`);
if (!ok) process.exit(1);
console.log('Rahkar diagnostic build completed.');
