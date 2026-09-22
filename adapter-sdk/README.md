# @genetic-assembly/adapter-sdk

TypeScript helpers and conformance testing for trusted Genetic Assembly project adapters.

```bash
npm install /path/to/genetic-assembly/artifacts/genetic-assembly-adapter-sdk-0.2.1.tgz
```

```ts
import { defineAdapter, serveAdapter } from "@genetic-assembly/adapter-sdk";

const adapter = defineAdapter({
  version: "model-v1",
  initialize: () => ({ operator_mode: "builtin" }),
  evaluateBatch: (candidates) => candidates.map((candidate) => ({
    id: candidate.id,
    genes: candidate.genes,
    evaluation: {
      objectives: [candidate.genes[0]],
      constraints: [],
    },
  })),
});

await serveAdapter(adapter);
```

Exports include `defineAdapter`, `serveAdapter`, `runConformanceSuite`, protocol types, and JSON Schemas for problem bundles, adapter launches, and NDJSON envelopes.

See the [complete integration guide](https://github.com/niko-dellic/genetic-assembly/blob/main/docs/integrating-another-repository.md) and [protocol reference](https://github.com/niko-dellic/genetic-assembly/blob/main/docs/adapter-protocol.md).

Registry publication is deferred. Build local tarballs with `npm run pack` from the source checkout. See the [installation guide](https://genetic-assembly-docs.vercel.app/installation.html).
