import {parentPort} from 'node:worker_threads';
import {serveEvaluator} from '../../dist/index.js';
serveEvaluator(async (decisions,inputs,context)=>{
 if(inputs.hang) await new Promise(()=>{});
 return {metrics:{value:decisions.x+context.seed}};
},parentPort);
