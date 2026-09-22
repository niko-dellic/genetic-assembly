import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompanionClient } from '../../headless-client/dist/index.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const client = new CompanionClient(process.env.GA_SERVER_URL ?? 'http://127.0.0.1:3001');
const problem = { schema_version: 1, name: 'Two targets', variable_ids: ['x'], problem: { variables: [{kind:'real',lower:0,upper:1}], objectives:[{name:'Left target',direction:'minimize'},{name:'Right target',direction:'minimize'}]}, constraints:[],artifacts:[] };
const launch = {name:'two-targets',adapter_version:'two-targets-v1',protocol_version:'genetic-assembly-adapter-v1',command:'node',args:[process.env.GA_DOCS_ADAPTER ?? '/workspace/adapter.mjs'],working_directory:process.env.GA_DOCS_WORKDIR ?? '/workspace',timeout_ms:30000,retry_limit:1};
const p = await client.createProblem(problem), a = await client.createAdapter(launch);
const config = {population_size:32,generations:12,seed:42};
async function execute() {
 const run = await client.startRun(p.id,a.id,config);
 await client.subscribe(run.id,()=>{},AbortSignal.timeout(120000));
 const status=await client.getRun(run.id); if(status.status!=='completed') throw Error(status.error ?? status.status);
 return {run,results:await client.getResults(run.id),analytics:await client.getAnalytics(run.id)};
}
const first = await execute(), second = await execute();
const signature = value => JSON.stringify(value.results.members.map(m=>({genes:m.individual.genes,objectives:m.individual.objectives})));
if(signature(first)!==signature(second)) throw Error('Seeded documentation example is not reproducible');
const cancelled = await client.startRun(p.id,a.id,{...config,generations:100000});
await client.cancel(cancelled.id);
let status;
for(let attempt=0;attempt<100;attempt++) {
 status=await client.getRun(cancelled.id); if(['cancelled','failed','completed'].includes(status.status)) break;
 await new Promise(resolve=>setTimeout(resolve,100));
}
if(status.status!=='cancelled') throw Error(`Cancellation ended as ${status.status}`);
await mkdir(resolve(root,'docs/public/examples'),{recursive:true});
await writeFile(resolve(root,'docs/public/examples/two-targets.json'),JSON.stringify({provenance:{description:'Recorded from the Rust companion; repeated seeded run and cancellation verified.',packageVersion:JSON.parse(await readFile(resolve(root,'package.json'))).version,config,problem,adapter:launch.adapter_version},dataset:first.analytics},null,2)+'\n');
console.log('Recorded genuine optimization history; fixed-seed repetition and cancellation passed.');
