import { Application } from 'typedoc';
import { readFile, mkdir, rm, writeFile, readdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'docs/api-reference');
const entries = [ ['headless-client', 'client', 'quickstart'], ['adapter-sdk', 'adapter-sdk', 'integrating-another-repository'], ['client', 'three', 'three'], ['visualizations', 'visualizations', 'visualizations'] ];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const index = [], functions = [];
for (const [directory, slug, guide] of entries) {
  const manifest = JSON.parse(await readFile(resolve(root, directory, 'package.json'), 'utf8'));
  if (manifest.main !== 'dist/index.js' || manifest.types !== 'dist/index.d.ts') throw new Error(`Review API entry points for ${directory}`);
  if (manifest.exports) throw new Error(`Document new subpath exports for ${directory}`);
  const app = await Application.bootstrapWithPlugins({
    entryPoints: [resolve(root, directory, 'src/index.ts')], tsconfig: resolve(root, directory, 'tsconfig.json'),
    plugin: ['typedoc-plugin-markdown'], name: manifest.name, out: resolve(output, slug), readme: 'none',
    excludePrivate: true, excludeProtected: true, excludeInternal: true, disableSources: true,
    entryFileName: 'index.md', hidePageHeader: true, hideBreadcrumbs: true, useHTMLAnchors: true, useCodeBlocks: true,
  });
  const project = await app.convert();
  if (!project) throw new Error(`Cannot document ${manifest.name}`);
  await app.generateOutputs(project);
  const page = await readFile(resolve(output, slug, 'index.md'), 'utf8');
  const sections = page.split(/(?=^## )/m);
  functions.push(`## ${manifest.name}\n\n[Usage guide](../${guide}.md) · [All exports](./${slug}/index.md)\n\n` + sections.filter(s => /^## (Functions|Classes)/.test(s)).join('\n').replace(/^## /gm, '### ').replace(/\]\(([^)]+)\)/g, `](./${slug}/$1)`));
  async function label(dir) {
    for (const file of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, file.name);
      if (file.isDirectory()) await label(path);
      else if (file.name.endsWith('.md')) {
        let md = await readFile(path, 'utf8');
        if (file.name !== 'index.md') md = md.replace(/^# /m, `# ${manifest.name} / `);
        await writeFile(path, '---\nprev: false\nnext: false\n---\n\n' + md);
      }
    }
  }
  await label(resolve(output, slug));
  index.push(`- [${manifest.name}](./${slug}/index.md) — ${manifest.version}`);
}
await writeFile(resolve(output, 'index.md'), '# Public API reference\n\nGenerated from the current source. Select an export to see its signature, parameters, return values, and public members.\n\n[All functions and classes](./functions.md)\n\n' + index.join('\n') + '\n\nAlso see the [CLI](../cli.md), [schemas](../schemas.md), [HTTP API](../http-api.md), and [evaluator context](../evaluator-context.md).\n');
await writeFile(resolve(output, 'functions.md'), '# All public functions and classes\n\n' + functions.join('\n'));

await mkdir(resolve(root, 'docs/public/schemas'), { recursive: true });
await cp(resolve(root, 'adapter-sdk/schemas'), resolve(root, 'docs/public/schemas'), { recursive: true });
