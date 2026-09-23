import {execFileSync} from 'node:child_process';
import {mkdirSync, copyFileSync} from 'node:fs';
const root = new URL('../../', import.meta.url);
execFileSync('cargo', ['build', '-p', 'genetic-assembly-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {cwd: root, stdio: 'inherit'});
mkdirSync(new URL('../dist/', import.meta.url), {recursive: true});
copyFileSync(new URL('target/wasm32-unknown-unknown/release/genetic_assembly_wasm.wasm', root), new URL('../dist/solver.wasm', import.meta.url));
copyFileSync(new URL('../dist/solver.wasm', import.meta.url), new URL('../wasm/solver.wasm', import.meta.url));
