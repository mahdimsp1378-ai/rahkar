import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = join(root, 'server', 'public-ai-consultation.js');
const payloadDirectory = join(root, '.github', 'update-payload');
const expectedDigest = '7f594caaeb5db2c7c2ca66cdac7b1d4da94417eefd2c97ceeabf630967472673';

if (existsSync(marker)) {
  console.log('Rahkar AI consultation sources are already present.');
  process.exit(0);
}

if (!existsSync(payloadDirectory)) {
  throw new Error('Rahkar AI update payload is missing.');
}

const parts = readdirSync(payloadDirectory)
  .filter(name => /^part\d+$/.test(name))
  .sort();

if (parts.length !== 8) {
  throw new Error(`Expected 8 Rahkar AI payload parts, found ${parts.length}.`);
}

const encoded = parts
  .map(name => readFileSync(join(payloadDirectory, name), 'utf8').trim())
  .join('');
const patch = gunzipSync(Buffer.from(encoded, 'base64'));
const digest = createHash('sha256').update(patch).digest('hex');

if (digest !== expectedDigest) {
  throw new Error(`Rahkar AI update checksum mismatch: ${digest}`);
}

const patchPath = join(root, '.rahkar-ai-update.patch');
writeFileSync(patchPath, patch);

const check = spawnSync('git', ['apply', '--check', patchPath], {
  cwd: root,
  stdio: 'inherit',
});
if (check.status !== 0) {
  unlinkSync(patchPath);
  throw new Error('Rahkar AI update cannot be applied to this source revision.');
}

const apply = spawnSync('git', ['apply', '--whitespace=fix', patchPath], {
  cwd: root,
  stdio: 'inherit',
});
unlinkSync(patchPath);

if (apply.status !== 0) {
  throw new Error('Rahkar AI update application failed.');
}

console.log(`Rahkar AI consultation update applied successfully (${digest}).`);
