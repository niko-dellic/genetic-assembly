import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Optimizer, defineStudy, openArchive} from '../dist/index.js';
const study = defineStudy({name:'mixed', version:'1', inputs:{},
 decisions:{x:{kind:'real',lower:0,upper:1,baseline:.5}, count:{kind:'integer',lower:0,upper:4,baseline:2}, on:{kind:'boolean',baseline:true}, category:{kind:'categorical',choices:['a','b','c'],baseline:'b'}},
 objectives:{cost:{metric:'cost',direction:'minimize'}, value:{metric:'value',direction:'maximize'}}, searchSeeds:[1,2], validationSeeds:[3,4],
 evaluate(d, inputs, context) {return {metrics:{cost:d.x+d.count+(d.on?1:0),value: d.category === 'c' ? 3 : 1}};}
});
test('packaged WASM runs mixed decisions with reproducible ordered results across concurrency', async () => {
 const outputs=[];
 for(const concurrency of [1,4]) {
  const optimizer=new Optimizer({evaluationConcurrency:concurrency});
  try {
   const baseline=await (await optimizer.baseline(study)).completed(); assert.equal(baseline.seedCount,2);
   const run=(await optimizer.run(study,{populationSize:8,generations:3,seed:42}));
   assert.equal((await run.wait()).status,'completed');
   const result=(await run.results()); outputs.push(result);
   assert.equal(result.search.evaluations,32);
   assert.equal((await run.history({limit:1000})).items.filter(r=>r.phase==='search').length,64);
   const archive=await openArchive(await optimizer.export()); assert.equal(archive.snapshot().runs.find(r=>r.engineVersion).engineVersion,"0.5.0");
   assert.ok(result.validated.length); assert.ok(result.validatedFront.length);
   assert.ok((await run.history({limit:1000})).items.filter(r=>r.phase==='validation').every(r=>r.seed===3||r.seed===4));
  } finally {optimizer.dispose();}
 }
 assert.deepEqual(outputs[0],outputs[1]);
});
test('missing metrics fail explicitly and retain failed evaluations', async () => {
 const optimizer=new Optimizer();
 try {
 const run=(await optimizer.run({...study,evaluate:()=>({metrics:{}})},{populationSize:4,generations:0}));
 await assert.rejects(run.wait(),/Required metric/);
 assert.equal((await run.status()).status,'failed'); assert.equal((await run.history({limit:1000})).items[0].status,'failed');
 }finally{optimizer.dispose();}
});
test('memory limit fails explicitly without dropping existing history', async () => {
 const optimizer=new Optimizer({memoryLimitBytes:1});
 try {await assert.rejects(async()=>optimizer.baseline(study),/Retained data exceeds/); assert.equal(optimizer.history().length,0);}finally{optimizer.dispose();}
});
test('cancels queued and active runs, then releases workers', async () => {
 const optimizer=new Optimizer();
 const slow={...study,async evaluate(d,i,c){await new Promise(resolve=>setTimeout(resolve,20)); c.signal.throwIfAborted(); return study.evaluate(d,i,c);}};
 const first=(await optimizer.run(slow,{populationSize:8,generations:100}));
 const second=(await optimizer.run(study)); second.cancel();
 await new Promise(resolve=>setTimeout(resolve,50)); first.cancel();
 assert.equal((await first.wait()).status,'cancelled'); assert.equal((await second.wait()).status,'cancelled');
 optimizer.dispose(); await assert.rejects(optimizer.run(study),/disposed/);
});
test('validation can change feasibility without rewriting search results',async()=>{
 const optimizer=new Optimizer();
 try{
  const model={...study,constraints:{limit:{metric:'gate',operator:'<=',bound:0}},evaluate(d,i,c){return {metrics:{...study.evaluate(d,i,c).metrics,gate:c.phase==='validation'?1:0}};}};
  const run=(await optimizer.run(model,{populationSize:4,generations:1}));await run.wait();
  const result=(await run.results());assert(result.search.pareto_front.every(c=>c.constraint_violation===0));assert(result.validated.every(c=>!c.feasible&&c.constraints.limit===1));
 }finally{optimizer.dispose();}
});
test('retention rejects malformed bytes and prevents memory accounting bypass',async()=>{
 const optimizer=new Optimizer();
 try{
  await assert.rejects(async()=>(await optimizer.baseline({...study,evaluate(d,i,c){c.retainDataset({manifestKey:'manifest',runHash:'x',resources:{manifest:'not bytes'}});return study.evaluate(d,i,c);}})).completed(),/Uint8Array/);
  assert.equal(optimizer.history().length,0);
 }finally{optimizer.dispose();}
});
test('one failed concurrent evaluation aborts a sibling that never resolves',async()=>{
 const optimizer=new Optimizer({evaluationConcurrency:2});let calls=0;
 try{
  const model={...study,evaluate(){if(++calls===1)return new Promise(()=>{});return {metrics:{}};}};
  const run=(await optimizer.run(model,{populationSize:4,generations:1}));
  await assert.rejects(run.wait(),/Required metric/);assert.equal((await run.status()).status,'failed');
 }finally{optimizer.dispose();}
});
