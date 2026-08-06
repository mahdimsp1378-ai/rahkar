import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payloadDir = resolve(root, 'update-payload-v123');
const partNames = ['part01.txt', 'part02.txt', 'part03.txt', 'part04.txt', 'part05.txt', 'part06.txt', 'part07.txt', 'part08.txt'];
const expectedPatchSha256 = '2e2bc2474d7beaf4b7b2f41abbeb22b0f04e0ae19231c8b45ca65a010c0b6bc0';
const expectedFiles = {
  ".env.local.example": "a710e2f68f157bc364b2341b61fea6e43ce90d8d55e25c55e52e934322aab616",
  ".github/workflows/deploy-pages.yml": "56933667ce76231c5700997ac8b81b0177b28cb36ef7a0aafb29277d40cebf7a",
  ".gitignore": "40d903e6f1477f2085d88e228c44bf33f505732a97a8ab3a8d18fec5a956ccd2",
  "README-DEPLOY-FA.md": "62b44f46fbe597a50527e35794c83f08d7b4c46b31205e6af75a83eda6820379",
  "README-LOCAL-FA.md": "3bea46d777c7e7a4f01bc97fe6d127b761a078e3263b638e20c31a462f6c6acf",
  "ai-consultation.html": "66e1687abc6ce56e1dfd64c5310469558cf53105da4bedf5c692448d6b3f1e01",
  "index.html": "091c34c5be329aa90c76e0e323bfcd43399a992f904898b548e760e9a8367cb8",
  "server/ai-provider.js": "6e1a0afc8f5f5a7945f8eef976907c253ffa3dea5236333c9f355d5b9291e163",
  "server/app.js": "2762791ca0a9e7721a32cbab4ffc9831d66e7a7672cccb924d58c84af5f011f9",
  "server/db.js": "403db68eaa8b5906168912e9c75d96268b046968974ba9463e56a60d67f94286",
  "server/public-ai-consultation.js": "6fd46f094c0a922711ff0cf89107f8329625ff787cb5898769fcb838194cac2e",
  "server/start.js": "f56f62bba8848c45a5547142b1fd067cf3b3b1089cb9f8e1470774548a777d2f",
  "setup-local.ps1": "52476482aa51da91f8cd773b8958c34c0a87f5dcdaedbdfe7f7810cdbfa2a000",
  "src/account.css": "495ad8e8e04280a85147d45cdbbb0e6d66ac5b7a0648f6bb9869617af8e2e10f",
  "src/account.jsx": "db2caa7c7dc426ad1e2eb439d57784e1bae7f868c09b2d83e21c069b69a8079e",
  "src/ai-consultation.css": "82c2e1cb608d7e178ca76655abe5e5eb7bf29058d4a45a5e2222e4a64b4638b0",
  "src/ai-consultation.js": "0b74a79a5a6705dbbe09a2dc38a6c25ac3bba49f33ee000c74bdf31ebbf4d1d8",
  "src/home-v3.css": "c16a5041cc5d11d496dd305f5e637abd19c57a9d48bd26d3b3313a6ffe38b407",
  "src/home-v3.jsx": "388d43390c7a5803ea3622f2151086be913c24f50d94787425c424cefa63a1ac",
  "src/main.jsx": "2c1ffb0e86609a1d75f91f10d4907f801c4d46974fec0494fd4de246a1e8109d",
  "src/marketing-enhancements.js": "a32dee2f285f3fbcc629601673313e56ae75adcf983ee03ac866ce4e0caf48a3",
  "start-local.bat": "a6618ed964c5378a74c544d3aa01a3db2e0cf10f9aadb8fdcd94143019887a7c",
  "vite.config.js": "ad92fbbfce4a171a9ce60f9e9c479e10f691b905e44fc356752e143d23369b86"
};
const sha256 = data => createHash('sha256').update(data).digest('hex');
const targetsAreCurrent = () => Object.entries(expectedFiles).every(([path, expected]) => {
  const fullPath = resolve(root, path);
  return existsSync(fullPath) && sha256(readFileSync(fullPath)) === expected;
});

if (targetsAreCurrent()) {
  console.log('Rahkar AI source v1.2.3 is already applied.');
  process.exit(0);
}

const encoded = partNames.map(name => readFileSync(resolve(payloadDir, name), 'utf8').trim()).join('');
const patch = Buffer.from(encoded, 'base64');
const patchSha256 = sha256(patch);
if (patchSha256 !== expectedPatchSha256) {
  throw new Error(`Rahkar AI payload integrity failed: ${patchSha256}`);
}

const patchPath = resolve(root, '.rahkar-ai-v123.patch');
writeFileSync(patchPath, patch);
try {
  const check = spawnSync('git', ['apply', '--check', '--whitespace=nowarn', patchPath], { cwd: root, encoding: 'utf8' });
  if (check.status !== 0) {
    if (targetsAreCurrent()) process.exit(0);
    throw new Error(`Unable to apply Rahkar AI source update.\n${check.stderr || check.stdout || 'git apply check failed'}`);
  }
  const apply = spawnSync('git', ['apply', '--whitespace=nowarn', patchPath], { cwd: root, encoding: 'utf8' });
  if (apply.status !== 0) throw new Error(apply.stderr || apply.stdout || 'git apply failed');
  if (!targetsAreCurrent()) throw new Error('Rahkar AI source update was applied but final verification failed.');
  console.log(`Rahkar AI source v1.2.3 applied successfully (${patchSha256}).`);
} finally {
  rmSync(patchPath, { force: true });
}
