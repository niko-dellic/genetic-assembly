# Adapter protocol v1

`genetic-assembly-adapter-v1` is newline-delimited JSON over a trusted child process's stdin/stdout. Stdout is protocol-only; diagnostics go to stderr. Every envelope contains `protocol_version`, `request_id`, and `type`. Responses must preserve the request ID.

## Lifecycle

1. `initialize` supplies the run ID and immutable problem bundle. The adapter returns its version, operator mode, concurrency, validation, and materialization capabilities. Its version must match the immutable adapter launch revision.
2. In adapter-operator mode, `seed_population` and `make_offspring` receive deterministic decimal-string seeds and return canonical bounded genomes in request order.
3. `evaluate_batch` receives indexed genomes. The adapter returns one ordered result per ID with finite objectives, `<= 0` constraints, and optional compact evidence.
4. `validate_front` may reevaluate the retained front at higher fidelity. Validation values are retained as evidence without silently replacing exploratory NSGA-II fitness.
5. `materialize` turns retained genomes into project-specific JSON or artifact references. Inline JSON larger than 64 KiB is moved to companion artifact storage.
6. `cancel` and `shutdown` end the lifecycle. Cancellation kills the adapter process group if a request is blocked.

The complete JSON Schemas are published with `@genetic-assembly/adapter-sdk` under `schemas/`.

## Determinism and recovery

- Requests and responses are indexed; scheduling may not reorder mathematical results.
- Operation seeds are decimal strings to preserve all 64 bits in JavaScript.
- Retried requests must be idempotent for the same run and request ID.
- Adapters are reconstructed from immutable problem, artifact, and launch revisions after restart. Mutable process memory is never part of a checkpoint.
- Checkpoint compatibility includes problem, adapter, protocol, engine, configuration, and referenced artifact hashes.

## Payload boundaries

Genes, objective values, constraints, warnings, timing, hashes, and artifact keys may be returned inline. Simulation traces, full project snapshots, meshes, and other large evidence should be uploaded as artifacts and referenced by key.

External adapters own concurrency. A Node adapter may use worker threads or subprocesses; Rust will not add a second Rayon layer around it. `SharedArrayBuffer` is an adapter-specific optimization and requires the project model to use suitable immutable binary storage.
