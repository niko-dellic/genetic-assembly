import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {instantiateSolver} from '../sdk/dist/wasm-runtime.js';
const fixture=JSON.parse(execFileSync('cargo',['run','--release','-q','-p','genetic-assembly-core','--example','parity'],{encoding:'utf8'}));
const solver=await instantiateSolver(readFileSync(new URL('../sdk/dist/solver.wasm',import.meta.url)));
solver({op:'init',problem:fixture.problem,config:fixture.config});
const started=performance.now();
const snapshots=[];
for(let batch; (batch=solver({op:'ask'}));){
 solver({op:'tell',candidates:batch.map(({id,genes})=>({id,genes,evaluation:{objectives:[genes.reduce((sum,v)=>sum+v,0),(1-genes[0])**2],constraints:[genes[1]-4]}}))});
 const snapshot=solver({op:'snapshot'});snapshots.push({generation:snapshot.generations,population:snapshot.final_population,summary:solver({op:'summary'})});
}
const result=solver({op:'result'});
function comparable(actual,expected,path='result') {
 if(typeof expected==='number') {assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<=1e-12*Math.max(1,Math.abs(expected)),path);return;}
 if(expected===null||typeof expected!=='object'){assert.equal(actual,expected,path);return;}
 assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path);
 for(const key of Object.keys(expected))comparable(actual[key],expected[key],`${path}.${key}`);
}
const {checkpoint,...observation}=fixture.result;
comparable(result,observation);
comparable(snapshots,fixture.snapshots,"snapshots");
assert.equal(Object.hasOwn(result,"checkpoint"),false);
console.log(`Native/WASM mixed-variable fixture matches within 1e-12 relative/absolute tolerance; WASM execution ${(performance.now()-started).toFixed(2)} ms (40 evaluations, same seed, constraints, ranking).`);

mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/solver-benchmark.json',JSON.stringify({fixture:'mixed variables, 40 evaluations',nativeMs:fixture.nativeMs,wasmMs:performance.now()-started,node:process.version,platform:process.platform,architecture:process.arch,tolerance:1e-12,note:'Small synchronous numerical fixture; excludes binary startup and does not predict simulation throughput.'},null,2));
