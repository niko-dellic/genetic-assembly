import assert from 'node:assert/strict';
import { CompanionClient } from '../headless-client/dist/index.js';
import { GeneticAssemblyClient } from '../client/dist/index.js';
const original = globalThis.fetch;
try {
  for (const Client of [CompanionClient, GeneticAssemblyClient]) {
    for (const event of [{ type: 'completed' }, {type:'failed'}, {type:'status',status:'cancelled'}]) {
      let cancelled = false;
      globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(`id: 1\ndata: ${JSON.stringify(event)}\n\n`)); },
        cancel() { cancelled = true; },
      }));
      const received=[];
      await new Client().subscribe('run', value => received.push(value));
      assert.deepEqual(received,[event]);
      assert(cancelled, `${Client.name} leaked the terminal event connection`);
    }
  }
  console.log('Both clients release streaming connections on completed, failed, and cancelled events.');
} finally { globalThis.fetch=original; }
