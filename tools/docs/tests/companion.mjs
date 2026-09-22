import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=mkdtempSync(join(tmpdir(),'ga-companion-'));
const port=process.env.GA_TEST_PORT ?? '43171';
const env={...process.env,COMPOSE_PROJECT_NAME:`ga-docs-${process.pid}`,GA_SERVER_PORT:port,GA_POSTGRES_PORT:process.env.GA_TEST_POSTGRES_PORT ?? '43172',GA_IMAGE:process.env.GA_IMAGE ?? 'genetic-assembly:0.2.1'};
const run=(command,args,extra={})=>execFileSync(command,args,{cwd:directory,stdio:'inherit',env,timeout:180000,...extra});
try {
 writeFileSync(join(directory,'package.json'),JSON.stringify({private:true,type:'module'}));
 const artifacts=JSON.parse(readFileSync(resolve(root,'artifacts/manifest.json')));
 run('npm',['install','--no-audit','--no-fund',...artifacts.filter(a=>['@genetic-assembly/client','@genetic-assembly/adapter-sdk','@genetic-assembly/cli'].includes(a.name)).map(a=>resolve(root,'artifacts',a.filename)),'esbuild','tsx']);
 run('npx',['--no-install','ga','init']);
 run('npx',['--no-install','ga','test-adapter']);
 cpSync(resolve(root,'tools/docs/snippets/adapter.mjs'),join(directory,'adapter-source.mjs'));
 run('npx',['--no-install','esbuild','adapter-source.mjs','--bundle','--platform=node','--format=esm','--outfile=adapter.mjs']);
 run('npx',['--no-install','ga','up']);
 run('npx',['--no-install','ga','doctor'],{env:{...env,GA_SERVER_URL:`http://127.0.0.1:${port}`}});
 writeFileSync(join(directory,'run.ts'),readFileSync(resolve(root,'tools/docs/snippets/quickstart.ts'),'utf8').replace('127.0.0.1:3001',`127.0.0.1:${port}`));
 run('npx',['--no-install','tsx','run.ts']);
 run('npx',['--no-install','esbuild',resolve(root,'examples/reference-adapter/src/adapter.ts'),'--bundle','--platform=node','--format=esm','--outfile=reference.mjs']);
 run('node',[resolve(root,'scripts/test-companion.mjs')],{cwd:root,env:{...env,GA_SERVER_URL:`http://127.0.0.1:${port}`,GA_ADAPTER_PATH:'/workspace/reference.mjs',GA_ADAPTER_COMMAND:'node',GA_ADAPTER_WORKDIR:'/workspace'}});
 run('node',[resolve(root,'tools/docs/record.mjs')],{env:{...env,GA_SERVER_URL:`http://127.0.0.1:${port}`}});
 console.log('Consumer quickstart passed with local Docker image, streaming, repeatability, cancellation, and materialization.');
} finally {
 try {run('docker',['compose','-f',join(directory,'.genetic-assembly/compose.yml'),'down','--volumes']);} finally {rmSync(directory,{recursive:true,force:true});}
}
