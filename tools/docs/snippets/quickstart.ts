import { CompanionClient, type ProblemBundle, type AdapterLaunch } from '@genetic-assembly/client';
const client = new CompanionClient('http://127.0.0.1:3001');
const problem: ProblemBundle = {
  schema_version: 1, name: 'Two targets', variable_ids: ['x'],
  problem: { variables: [{ kind: 'real', lower: 0, upper: 1 }],
    objectives: [{ name: 'Left target', direction: 'minimize' }, { name: 'Right target', direction: 'minimize' }] },
  constraints: [], artifacts: [],
};
const launch: AdapterLaunch = {
  name: 'two-targets', adapter_version: 'two-targets-v1',
  protocol_version: 'genetic-assembly-adapter-v2', command: 'node',
  args: ['/workspace/adapter.mjs'], working_directory: '/workspace', timeout_ms: 30000, retry_limit: 1,
};
const problemRevision = await client.createProblem(problem);
const adapterRevision = await client.createAdapter(launch);
const run = await client.startRun(problemRevision.id, adapterRevision.id, {
  population_size: 32, generations: 12, seed: 42,
});
await client.subscribe(run.id, event => console.log(event.type));
const status = await client.getRun(run.id);
if (status.status !== 'completed') throw new Error(status.error ?? status.status);
const results = await client.getResults(run.id);
const analytics = await client.getAnalytics(run.id);
console.log(results.members, analytics.generations);
