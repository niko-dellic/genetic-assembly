import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {Optimizer,defineStudy,defineWorkerStudy,EvaluatorPool,collectPages,openArchive} from '../dist/index.js';
const spec={name:'runtime',version:'1',inputs:{},decisions:{x:{kind:'real',lower:0,upper:1,baseline:.5}},objectives:{value:{metric:'value',direction:'minimize'}},searchSeeds:[1,2],validationSeeds:[3]};
const worker=()=>new Worker(new URL('./fixtures/evaluator.mjs',import.meta.url),{execArgv:[]});
test('one study reuses its slots, isolated mode starts fresh, and studies do not share slots',async()=>{
 for(const mode of ['pooled','isolated']){
  let starts=0; const factory=()=>{starts++;return worker();};
  const optimizer=new Optimizer({evaluationConcurrency:2});
  try {
   const model=defineWorkerStudy(spec,factory,{}, {mode});
   await (await optimizer.baseline(model)).completed();
   await (await optimizer.baseline(model)).completed();
   assert.equal(starts,mode==='pooled'?1:4);
   await (await optimizer.baseline(defineWorkerStudy({...spec,name:'other'},factory))).completed();
   assert.equal(starts,mode==='pooled'?2:5);
  }finally{optimizer.dispose();}
 }
});
test('events replay by cursor, actual snapshots reference retained candidates, archives preserve both',async()=>{
 const optimizer=new Optimizer({evaluationConcurrency:3});
 try{
  const model=defineStudy({...spec,evaluate(d,i,c){return{metrics:{value:d.x+c.seed}};}});
  const run=await optimizer.run(model,{populationSize:8,generations:3});
  run.subscribe(()=>{throw Error('broken observer');});
  await run.wait();
  const events=await Array.fromAsync(run.events());
  assert.equal(events.at(-1).type,'completed');
  assert.deepEqual(events.map(e=>e.sequence),Array.from({length:events.length},(_,i)=>i+1));
  assert.deepEqual(await Array.fromAsync(run.events({after:events[5].sequence})),events.slice(6));
  const snapshots=await collectPages(o=>run.generations(o));
  const candidates=await collectPages(o=>run.candidates(o));
  assert.equal(snapshots.length,4);assert.equal(candidates.length,32);
  const seen=new Set();
  for(const s of snapshots){
   s.evaluatedCandidateIds.forEach(id=>seen.add(id));assert.equal(s.population.length,8);
   assert(s.population.every(c=>seen.has(c.candidateId)));
   assert.deepEqual(s.paretoCandidateIds,s.population.filter(c=>c.rank===0).map(c=>c.candidateId));
   const eligible=candidates.filter(c=>seen.has(c.candidateId));
   assert.deepEqual(s.discoveredParetoCandidateIds,eligible.filter(c=>!eligible.some(other=>other.metrics.value<c.metrics.value-1e-12)).map(c=>c.candidateId));
  }
  const result=await run.results();
  assert.deepEqual(snapshots.at(-1).population.map(c=>c.candidateId),result.search.final_population.map(c=>String(c.id)));
  const archive=await openArchive(await optimizer.export());
  assert.equal(archive.snapshot().version,2);assert.deepEqual(archive.events(run.id),events);
  assert.deepEqual(archive.generations(run.id).items,snapshots);
  assert(events.filter(e=>e.type==='evaluation-started').every(e=>e.active<=3&&e.queued>=0));
 }finally{optimizer.dispose();}
});
test('pool enforces bounds, ignores stale responses, and terminates active and queued work',async()=>{
 const workers=[];let active=0,peak=0;
 class FakeWorker {
  on(type,cb){this[type]=cb;}
  postMessage(job){this.job=job;active++;peak=Math.max(peak,active);}
  finish(){active--;this.message({id:this.job.id-1,measurement:{metrics:{value:-1}}});this.message({id:this.job.id,measurement:{metrics:{value:this.job.seed}}});}
  terminate(){this.terminated=true;}
 }
 const pool=new EvaluatorPool(()=>{const w=new FakeWorker();workers.push(w);return w;},2);
 const controller=new AbortController();
 const context={seed:1,phase:'search',signal:controller.signal,retainReplay:false,retainDataset(){}};
 const jobs=Array.from({length:4},()=>pool.evaluate({x:1},{},context));
 workers[0].finish();workers[1].finish();workers[0].finish();workers[1].finish();
 assert.equal(peak,2);assert.equal(workers.length,2);assert((await Promise.all(jobs)).every(r=>r.metrics.value===1));
 const pending=Array.from({length:4},()=>pool.evaluate({x:1},{},context));
 controller.abort();assert((await Promise.allSettled(pending)).every(r=>r.status==='rejected'));
 pool.dispose();assert(workers.every(w=>w.terminated));
});
test('a worker crash is structured and never retried',async()=>{
 let starts=0;let crash;
 const pool=new EvaluatorPool(()=>{starts++;return{on(type,fn){if(type==='error')crash=fn;},postMessage(){queueMicrotask(()=>crash(Error('worker exploded')));},terminate(){}};},1);
 try{await assert.rejects(pool.evaluate({x:1},{},{seed:7,phase:'search',signal:new AbortController().signal,retainReplay:false,retainDataset(){}}),e=>e.detail.code==='WORKER_FAILED'&&e.detail.seed===7);assert.equal(starts,1);}finally{pool.dispose();}
});
test('history exhaustion preserves committed generations and exposes a terminal failure',async()=>{
 const optimizer=new Optimizer({memoryLimitBytes:45000});
 try{
  const run=await optimizer.run(defineStudy({...spec,evaluate(d){return{metrics:{value:d.x}};}}),{populationSize:8,generations:30});
  await assert.rejects(run.wait(),/Retained data/);
  const history=await collectPages(o=>run.generations(o));assert(history.length>0&&history.length<31);
  const events=await Array.fromAsync(run.events());assert.equal(events.at(-1).type,'failed');assert.equal(events.filter(e=>e.type==='generation-completed').length,history.length);
 }finally{optimizer.dispose();}
});
test('service connection and protocol failures include actionable context',async()=>{
 const {StudyClient}=await import('../dist/index.js');const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>{throw new TypeError('connection refused');};
  await assert.rejects(new StudyClient('http://localhost:1').studies(),error=>error.detail.code==='SERVICE_CONNECT'&&new URL(error.detail.asset).pathname==='/v3/studies');
  globalThis.fetch=async()=>new Response('<html>wrong server</html>');
  await assert.rejects(new StudyClient().studies(),error=>error.detail.code==='SERVICE_PROTOCOL');
 }finally{globalThis.fetch=original;}
});
test('solver factory startup failures retain their stage',async()=>{
 const optimizer=new Optimizer({solverWorkerFactory(){throw Error('worker construction denied');}});
 try{const run=await optimizer.run(defineStudy({...spec,evaluate:()=>({metrics:{value:1}})}));await assert.rejects(run.wait(),error=>error.detail.code==='WORKER_STARTUP'&&error.detail.stage==='solver-startup');}finally{optimizer.dispose();}
});
