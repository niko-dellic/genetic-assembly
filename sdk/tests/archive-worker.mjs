import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {Optimizer,defineWorkerStudy,defineStudy,openArchive} from '../dist/index.js';
const spec={name:'worker',version:'1',inputs:{},decisions:{x:{kind:'real',lower:0,upper:1,baseline:.5}},objectives:{value:{metric:'value',direction:'minimize'}},searchSeeds:[1],validationSeeds:[2]};
const factory=()=>new Worker(new URL('./fixtures/evaluator.mjs',import.meta.url),{execArgv:[]});
test('explicit evaluator modules execute and a hanging worker can be cancelled',async()=>{
 const optimizer=new Optimizer();
 try{
 const model=defineWorkerStudy(spec,factory);
 assert.equal((await (await optimizer.baseline(model)).completed()).metrics.value,1.5);
 const run=(await optimizer.run(defineWorkerStudy({...spec,inputs:{hang:true}},factory),{populationSize:4,generations:1}));
 await new Promise(resolve=>setTimeout(resolve,50));run.cancel();assert.equal((await run.wait()).status,'cancelled');
 }finally{optimizer.dispose();}
});
test('archives reopen replay bytes without model execution and reject tampering',async()=>{
 const optimizer=new Optimizer();
 const model=defineStudy({...spec,evaluate(d,i,c){if(c.retainReplay)c.retainDataset({manifestKey:'manifest.json',runHash:'abc',resources:{'manifest.json':new TextEncoder().encode('{"hello":true}'),'chunk.bin':new Uint8Array([0,255,128])}});return{metrics:{value:Number(d.x)}};}});
 try{
 await (await optimizer.baseline(model)).completed();const archive=await openArchive(await optimizer.export());optimizer.dispose();
 const record=archive.history()[0];assert.deepEqual([...archive.dataset(record.datasetId).resources['chunk.bin']],[0,255,128]);assert.equal(archive.snapshot().studies.length,1);assert.equal(archive.readOnly,true);
 const bytes=new TextEncoder().encode(JSON.stringify({sha256:'0'.repeat(64),data:archive.snapshot()}));await assert.rejects(openArchive(bytes),/checksum/);
 await assert.rejects(openArchive(bytes,{maxBytes:1}),/maximum size/);
 }finally{optimizer.dispose();}
});
