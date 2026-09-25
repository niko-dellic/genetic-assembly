import {Worker} from 'node:worker_threads';
import {writeFileSync,mkdirSync} from 'node:fs';
import {Optimizer,defineWorkerStudy} from '../sdk/dist/index.js';
const results=[];
for(const mode of ['isolated','pooled']) {
 let workers=0;
 const model=defineWorkerStudy({name:'Startup benchmark',version:'1',inputs:{},decisions:{x:{kind:'real',lower:0,upper:1,baseline:.5}},objectives:{value:{metric:'value',direction:'minimize'}},searchSeeds:[1],validationSeeds:[2]},()=>{workers++;return new Worker(new URL('../sdk/tests/fixtures/evaluator.mjs',import.meta.url),{execArgv:[]});},{},{mode});
 const optimizer=new Optimizer({evaluationConcurrency:4});const start=performance.now();
 try {await (await optimizer.run(model,{populationSize:12,generations:2,validate:false})).completed();results.push({mode,workers,milliseconds:performance.now()-start});}finally{optimizer.dispose();}
}
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/worker-benchmark.json',JSON.stringify({node:process.version,platform:process.platform,results,note:'36 trivial evaluations, four slots; includes worker and solver startup. Illustrative measurement, no hardware-specific pass threshold.'},null,2));
console.log(JSON.stringify(results));
