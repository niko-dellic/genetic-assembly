import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(root,'docs/dist');
function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]); }
const html=walk(output).filter(p=>p.endsWith('.html'));
assert(html.length>50,'Expected generated API pages');
for(const file of html) {
 const source=readFileSync(file,'utf8');
 for(const [,href] of source.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
  if(/^(https?:|mailto:|data:|javascript:)/.test(href)) continue;
  const clean=decodeURIComponent(href.split(/[?#]/)[0]);
  const target=clean.startsWith('/')?resolve(output,'.'+clean):resolve(dirname(file),clean);
  assert(existsSync(target)||existsSync(target+'.html')||existsSync(resolve(target,'index.html')),`${file}: broken link ${href}`);
 }
}
const context=readFileSync(resolve(root,'crates/genetic-assembly-script/src/lib.rs'),'utf8').split('return Object.freeze({{')[1].split('}});')[0];
const guide=readFileSync(resolve(root,'docs/evaluator-context.md'),'utf8');
for(const [,name] of context.matchAll(/^    (\w+): /gm)) assert(guide.includes('`'+name+'('),`Undocumented evaluator function ${name}`);
const server=readFileSync(resolve(root,'crates/genetic-assembly-server/src/lib.rs'),'utf8')+readFileSync(resolve(root,'crates/genetic-assembly-server/src/studies.rs'),'utf8');
const http=readFileSync(resolve(root,'docs/http-api.md'),'utf8');
for(const [,route] of server.matchAll(/\.route\(\s*"([^"]+)"/g)) assert(http.includes(route),`Undocumented route ${route}`);
const recording=JSON.parse(readFileSync(resolve(output,'examples/two-targets.json')));
assert(recording.provenance.config.seed===42 && recording.dataset.generations.length===12);
console.log(`Validated ${html.length} HTML pages, links, evaluator/HTTP coverage, and recorded example.`);
