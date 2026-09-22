import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export const packages = ['headless-client', 'adapter-sdk', 'cli', 'client', 'visualizations'];
const mode = process.argv[2] ?? 'check';
const version = JSON.parse(readFileSync(resolve(root, 'package.json'))).version;
if (process.env.GITHUB_REF?.startsWith('refs/tags/v') && process.env.GITHUB_REF !== `refs/tags/v${version}`) throw new Error('Release tag must match package version');
if (!readFileSync(resolve(root, 'Cargo.toml'), 'utf8').includes(`version = "${version}"`)) throw new Error('Rust version mismatch');
if (!readFileSync(resolve(root, 'cli/src/cli.ts'), 'utf8').includes(`genetic-assembly:${version}`)) throw new Error('CLI image version mismatch');
const output = resolve(root, 'artifacts');
mkdirSync(output, { recursive: true });
const artifacts = [];
for (const folder of packages) {
  const manifest = JSON.parse(readFileSync(resolve(root, folder, 'package.json')));
  if (manifest.version !== version) throw new Error(`Version mismatch: ${folder}`);
  if (mode === 'build') {
    execFileSync(process.execPath, ['scripts/prepare-package.mjs', folder], { cwd: root, stdio: 'inherit' });
    continue;
  }
  const args = ['pack', '--json', '--pack-destination', output];
  if (mode === 'check') args.push('--dry-run');
  const [packed] = JSON.parse(execFileSync('npm', args, { cwd: resolve(root, folder), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  for (const required of ['package.json', 'README.md', 'LICENSE', folder === 'cli' ? 'dist/cli.js' : 'dist/index.js', folder === 'cli' ? 'dist/cli.d.ts' : 'dist/index.d.ts']) {
    if (!packed.files.some(file => file.path === required)) throw new Error(`${manifest.name}: missing ${required}`);
  }
  if (folder === 'adapter-sdk' && !packed.files.some(file => file.path === 'schemas/adapter-protocol.schema.json')) throw new Error('Missing SDK schemas');
  if (packed.files.some(file => /\.(test|spec)\.|node_modules|^src\//.test(file.path))) throw new Error(`Development files in ${manifest.name}`);
  artifacts.push({ name: manifest.name, version, filename: packed.filename, integrity: packed.integrity });
  console.log(`${manifest.name}: ${packed.files.length} files, ${packed.filename}`);
}
if (mode === 'pack') writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(artifacts, null, 2) + '\n');
