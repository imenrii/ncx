import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = 'node_modules/pyodide';
const { version } = JSON.parse(readFileSync(`${source}/package.json`, 'utf8'));
const target = `dist/assets/python-${version}`;
mkdirSync(target, { recursive: true });
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  copyFileSync(`${source}/${file}`, `${target}/${file}`);
}
const lock = JSON.parse(readFileSync(`${source}/pyodide-lock.json`, 'utf8'));
const packages = JSON.parse(readFileSync('python/packages.json', 'utf8'));
for (const item of [...['numpy', 'pyyaml'].map(name => ({file: lock.packages[name].file_name, sha256: lock.packages[name].sha256})), ...packages]) {
  const wheel = readFileSync(`python/${item.file}`);
  if (createHash('sha256').update(wheel).digest('hex') !== item.sha256) throw new Error(`Checksum differs for ${item.file}`);
  copyFileSync(`python/${item.file}`, `${target}/${item.file}`);
}
copyFileSync('python/packages.json', `${target}/packages.json`);
copyFileSync('python/PYODIDE-LICENSE.txt', `${target}/PYODIDE-LICENSE.txt`);
