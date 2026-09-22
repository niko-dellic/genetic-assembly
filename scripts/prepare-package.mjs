import { execFileSync } from 'node:child_process';
import { cpSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, process.argv[2]);
rmSync(join(directory, 'dist'), { recursive: true, force: true });
execFileSync('npm', ['run', 'build'], { cwd: directory, stdio: 'inherit' });
cpSync(join(root, 'LICENSE'), join(directory, 'LICENSE'));
function prune(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) prune(path);
    else if (/\.(test|spec)\./.test(entry.name)) rmSync(path);
  }
}
prune(join(directory, 'dist'));
