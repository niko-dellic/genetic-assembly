import { defineAdapter, serveAdapter } from '@genetic-assembly/adapter-sdk';
export const adapter = defineAdapter({
  version: 'two-targets-v1',
  initialize: () => ({ operator_mode: 'builtin', max_concurrency: 1, materialize: true }),
  evaluateBatch: candidates => candidates.map(candidate => ({
    id: candidate.id, genes: candidate.genes,
    evaluation: { objectives: [candidate.genes[0] ** 2, (1 - candidate.genes[0]) ** 2], constraints: [] },
  })),
  materialize: candidates => candidates.map(candidate => ({
    id: candidate.id, media_type: 'application/json', data: { x: candidate.genes[0] },
  })),
});
await serveAdapter(adapter);
