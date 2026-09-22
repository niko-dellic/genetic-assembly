# JSON schemas

The adapter SDK includes these files in its tarball:

| Package path | Contract |
| --- | --- |
| `@genetic-assembly/adapter-sdk/schemas/problem-bundle.schema.json` | Problem, variables, objectives, constraints, and artifact references |
| `@genetic-assembly/adapter-sdk/schemas/adapter-launch.schema.json` | Runtime command, adapter version, environment, and limits |
| `@genetic-assembly/adapter-sdk/schemas/adapter-protocol.schema.json` | NDJSON protocol envelopes |

Use the schemas with your JSON validator or editor. They complement server validation and the adapter conformance harness; schemas alone do not verify mathematical determinism or ordering.

The [generated SDK types](./api-reference/adapter-sdk/index.md) describe TypeScript usage. The [protocol guide](./adapter-protocol.md) explains message lifecycle and payload limits.

## Download schemas

- [Problem bundle](./schemas/problem-bundle.schema.json)
- [Adapter launch](./schemas/adapter-launch.schema.json)
- [Adapter protocol](./schemas/adapter-protocol.schema.json)
