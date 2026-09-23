# JSON schemas

The adapter SDK includes these files in its tarball:

| Package path | Contract |
| --- | --- |
| `@genetic-assembly/sdk/schemas/problem-bundle.schema.json` | Problem, variables, objectives, constraints, and artifact references |
| `@genetic-assembly/sdk/schemas/adapter-launch.schema.json` | Runtime command, adapter version, environment, and limits |
| `@genetic-assembly/sdk/schemas/adapter-protocol.schema.json` | NDJSON protocol envelopes |

Use the schemas with your JSON validator or editor. They complement server validation and the adapter conformance harness; schemas alone do not verify mathematical determinism or ordering.

The [generated SDK types](./api-reference/sdk/index.md) describe TypeScript usage. The [protocol guide](./adapter-protocol.md) explains message lifecycle and payload limits.

## Download schemas

- [Problem bundle](./schemas/problem-bundle.schema.json)
- [Adapter launch](./schemas/adapter-launch.schema.json)
- [Adapter protocol](./schemas/adapter-protocol.schema.json)

## Study contracts

The SDK exports Zod schemas and inferred TypeScript types from one contract source. Generated JSON Schemas are shipped in `@genetic-assembly/sdk/schemas/`: [study](/docs/schemas/study.schema.json), [evaluation](/docs/schemas/evaluation.schema.json), [measurement](/docs/schemas/measurement.schema.json), and [decision](/docs/schemas/decision.schema.json). Runtime checks also enforce relational rules such as unique categories, valid baselines, and disjoint seed sets. Study schema version is 2.
