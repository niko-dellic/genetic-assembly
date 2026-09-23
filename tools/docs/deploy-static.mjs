import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=join(root,'docs/dist');
for(const path of ['index.html','docs/index.html','docs/local.html','docs/live-neighborhood.html']){
 if(!existsSync(join(output,path)))throw Error(`Missing built page ${path}; run npm run docs:build first`);
}
const project=JSON.parse(readFileSync(join(root,'.vercel/project.json'),'utf8'));
if(project.projectName!=='genetic-assembly'||!project.projectId||!project.orgId)throw Error('Verify the configured Genetic Assembly Vercel project first');
const stage=mkdtempSync(join(tmpdir(),'ga-docs-static-'));
const destination=join(stage,'.vercel/output/static');
mkdirSync(join(stage,'.vercel/output'),{recursive:true});
cpSync(output,destination,{recursive:true});
let files=0;
function verify(path){
 for(const entry of readdirSync(path,{withFileTypes:true})){
  if(entry.isSymbolicLink()||entry.name.startsWith('.')||['package.json','Cargo.toml'].includes(entry.name))throw Error(`Unexpected file in public output: ${entry.name}`);
  if(entry.isDirectory())verify(join(path,entry.name));else files++;
 }
}
verify(destination);
if(files<10||!existsSync(join(destination,'docs/live-neighborhood.html')))throw Error('Incomplete static output');
writeFileSync(join(stage,'.vercel/project.json'),JSON.stringify(project));
writeFileSync(join(stage,'.vercel/output/config.json'),JSON.stringify({version:3,routes:[{src:'/',dest:'/index.html'},{src:'/docs',status:308,headers:{Location:'/docs/'}},{src:'/docs/',dest:'/docs/index.html'},{src:'/docs/(.*)/',dest:'/docs/$1/index.html'},{handle:'filesystem'},{src:'/docs/(.*)',dest:'/docs/$1.html'}]}));
console.log(`Verified ${files} public files for ${project.projectName}: ${stage}`);
if(!process.argv.includes('--prepare-only'))execFileSync('npx',['--yes','vercel','deploy','--prebuilt','--prod','--yes'],{cwd:stage,stdio:'inherit'});
