import {copyFileSync} from 'node:fs';
copyFileSync(new URL('../wasm/solver.wasm',import.meta.url),new URL('../dist/solver.wasm',import.meta.url));
