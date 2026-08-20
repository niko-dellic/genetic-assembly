# @genetic-assembly/client

Framework-independent API client for the Genetic Assembly local NSGA-II companion.

```bash
npm install @genetic-assembly/client
```

```ts
import { CompanionClient } from "@genetic-assembly/client";

const client = new CompanionClient("http://127.0.0.1:3001");
const problemRevision = await client.createProblem(problem);
const adapterRevision = await client.createAdapter(launch);
const run = await client.startRun(problemRevision.id, adapterRevision.id, {
  population_size: 100,
  generations: 200,
  seed: 42,
});
await client.subscribe(run.id, console.log);
const results = await client.getResults(run.id);
```

The package has no React or Three.js dependency. It exposes artifacts, immutable problem and adapter revisions, run control, reconnecting SSE, results, analytics, and all public data types.

See the [complete integration guide](https://github.com/niko-dellic/genetic-assembly/blob/main/docs/integrating-another-repository.md).
