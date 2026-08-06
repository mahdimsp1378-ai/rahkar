import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = join(root, 'server', 'public-ai-consultation.js');
const payloadDirectory = join(root, 'update-payload');
const expectedDigest = '7f594caaeb5db2c7c2ca66cdac7b1d4da94417eefd2c97ceeabf630967472673';
const excludedPaths = new Set(['package.json', 'vercel.json']);

if (existsSync(marker)) {
  console.log('Rahkar AI consultation sources are already present.');
  process.exit(0);
}
if (!existsSync(payloadDirectory)) throw new Error('Rahkar AI update payload is missing.');

const parts = readdirSync(payloadDirectory).filter(name => /^part\d+$/.test(name)).sort();
if (parts.length !== 8) throw new Error(`Expected 8 Rahkar AI payload parts, found ${parts.length}.`);
const encoded = parts.map(name => readFileSync(join(payloadDirectory, name), 'utf8').trim()).join('');
const patchBuffer = gunzipSync(Buffer.from(encoded, 'base64'));
const digest = createHash('sha256').update(patchBuffer).digest('hex');
if (digest !== expectedDigest) throw new Error(`Rahkar AI update checksum mismatch: ${digest}`);

function parsePatch(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git ')) { i += 1; continue; }
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[i]);
    if (!match) throw new Error(`Unsupported diff header: ${lines[i]}`);
    const file = { oldPath: match[1], newPath: match[2], newFile: false, deletedFile: false, hunks: [] };
    i += 1;
    while (i < lines.length && !lines[i].startsWith('diff --git ')) {
      const line = lines[i];
      if (line.startsWith('new file mode ')) file.newFile = true;
      if (line.startsWith('deleted file mode ')) file.deletedFile = true;
      if (line.startsWith('@@ ')) {
        const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!hunkMatch) throw new Error(`Unsupported hunk header: ${line}`);
        const hunk = { oldStart: Number(hunkMatch[1]), oldCount: Number(hunkMatch[2] ?? 1), newStart: Number(hunkMatch[3]), newCount: Number(hunkMatch[4] ?? 1), lines: [] };
        i += 1;
        while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff --git ')) {
          const hunkLine = lines[i];
          if (hunkLine.startsWith(' ') || hunkLine.startsWith('+') || hunkLine.startsWith('-') || hunkLine.startsWith('\\')) hunk.lines.push(hunkLine);
          i += 1;
        }
        file.hunks.push(hunk);
        continue;
      }
      i += 1;
    }
    files.push(file);
  }
  return files;
}

function applyFilePatch(file) {
  const relativePath = file.deletedFile ? file.oldPath : file.newPath;
  if (excludedPaths.has(relativePath)) return;
  const absolutePath = join(root, relativePath);
  const original = file.newFile ? '' : readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
  const hadFinalNewline = original.endsWith('\n');
  const source = original.length === 0 ? [] : (hadFinalNewline ? original.slice(0, -1) : original).split('\n');
  const output = [];
  let cursor = 0;
  let finalNewline = true;
  for (const hunk of file.hunks) {
    const target = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (target < cursor || target > source.length) throw new Error(`Invalid hunk position for ${relativePath}`);
    output.push(...source.slice(cursor, target));
    cursor = target;
    let oldSeen = 0;
    let newSeen = 0;
    let previousPrefix = null;
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) { if (previousPrefix === '+') finalNewline = false; continue; }
      const prefix = line[0];
      const value = line.slice(1);
      previousPrefix = prefix;
      if (prefix === ' ') {
        if (source[cursor] !== value) throw new Error(`Context mismatch in ${relativePath} at source line ${cursor + 1}`);
        output.push(value); cursor += 1; oldSeen += 1; newSeen += 1;
      } else if (prefix === '-') {
        if (source[cursor] !== value) throw new Error(`Deletion mismatch in ${relativePath} at source line ${cursor + 1}`);
        cursor += 1; oldSeen += 1;
      } else if (prefix === '+') { output.push(value); newSeen += 1; }
    }
    if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount) throw new Error(`Hunk length mismatch in ${relativePath}: expected ${hunk.oldCount}/${hunk.newCount}, got ${oldSeen}/${newSeen}`);
  }
  output.push(...source.slice(cursor));
  if (file.deletedFile) { unlinkSync(absolutePath); return; }
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, output.join('\n') + (finalNewline ? '\n' : ''), 'utf8');
}

const files = parsePatch(patchBuffer.toString('utf8'));
for (const file of files) applyFilePatch(file);
console.log(`Rahkar AI consultation update applied successfully (${digest}; ${files.length} files).`);
