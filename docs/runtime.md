# Runtime, workers, and observation

Version 0.5.0 is a breaking release. Install all Genetic Assembly packages at 0.5.0. Studies use schema version 3, companion endpoints use `/v3`, and portable archives use format version 2. The managed companion uses new `v5` storage volumes; previous volumes and archives are not migrated or read.

## Operation handles

`await optimizer.baseline(study)`, `await optimizer.run(study, options)`, and `await optimizer.replay(study, decisions)` return operation handles. Creating a handle does not mean execution has completed. Use `await handle.wait()` for terminal status or `await handle.completed()` for results. `wait()` throws a structured error on failure; cancellation returns a cancelled status. `results()` requires available results.

Every handle exposes asynchronous `status()`, `history({offset})`, `generations({offset})`, `cancel()`, `wait()`, and `events({after, signal})`. Baseline and replay have no generation snapshots. Local handles additionally offer a guarded status callback through `subscribe`; throwing from a callback never changes execution.

```ts
const run = await optimizer.run(study, {populationSize: 24, generations: 12})
let cursor = 0
for await (const event of run.events({after: cursor})) {
  cursor = event.sequence
  if (event.type === 'generation-completed') {
    const snapshots = await run.generations()
    console.log(snapshots.items)
  }
}
const results = await run.completed()
```

Persist the last processed sequence if a service observer must reconnect. Cursors are opaque monotonically increasing numbers, not array indexes; gaps are permitted. Local streams replay retained events before following execution. Aborting a stream disconnects that observer. It does not cancel the operation. Call `cancel()` explicitly to cancel work.

Events identify the operation, phase, candidate, simulation seed, and retained evaluation record where applicable. Evaluation events carry active and queued counts. Generation completion means the surviving population snapshot is available. A phase event separates search from independent finalist validation. Terminal events are completed, cancelled, or failed.

## Browser packaging

The supported explicit Vite setup works with dependency prebundling enabled, development servers, production assets, and non-root deployment bases:

```ts
import {Optimizer} from '@genetic-assembly/sdk'
import SolverWorker from '@genetic-assembly/sdk/solver-worker?worker'
const optimizer = new Optimizer({
  solverWorkerFactory: () => new SolverWorker(),
  evaluationConcurrency: 4,
})
```

Ship the emitted worker and WASM files. `/solver-worker` and `/solver.wasm` are supported package exports. A custom `solverWorkerFactory` owns worker creation; the SDK owns the returned worker's lifetime. Node automatically uses its packaged worker and WASM file. For an application using the default relative worker factory instead, merge `geneticAssemblyVite()` from `@genetic-assembly/sdk/vite` into the Vite configuration; this keeps that entry out of development prebundling.

## Evaluator ownership

`defineWorkerStudy(spec, factory, hooks, {mode: 'pooled'})` uses an optimizer-owned pool, isolated per registered study. Workers handle one evaluation at a time. Each receives cloned decisions, inputs, seed, phase, and replay-retention context. Do not retain mutable simulation state across jobs. Use `{mode: 'isolated'}` when a module requires a fresh process state for each evaluation.

`serveEvaluator(evaluate)` serves a browser module; pass Node's `parentPort` for worker threads. The optimizer's `evaluationConcurrency` is bounded from 1 to 64. A run can override it with `evaluationConcurrency`. Results are delivered to the solver in candidate order regardless of completion order. Simulation seeds are independent of the solver seed.

Prepared companion modules use persistent slots through the CLI-generated worker factory and negotiate supported concurrency in the adapter handshake. A directly supplied `serveStudy` without a worker factory declares one slot. Do not create another independent pool inside each slot; use the simulation's single-evaluation entry point. The service terminates the evaluator process group on forced cancellation. Worker-backed local cancellation terminates active slots and removes queued work. Inline callbacks must cooperate with their abort signal.

`optimizer.dispose()` releases local workers and retained data. Service disposal disconnects observation and leaves durable jobs running. Observer errors never enter the solver's evaluation path. Failed evaluations are not silently retried.

## History and evidence

`generations()` returns exact Rust solver survivors, ranks, crowding distances, population Pareto IDs, and a separate cumulative discovered Pareto front. `candidates({generation, phase})` returns aggregate evidence; `history()` returns individual seed measurements. Use `collectPages` for more than one page. Snapshots refer to candidate IDs; seed evidence is retained once. Search evidence is never replaced by validation evidence. `results().validated` includes all evaluated finalists; `validatedFront` contains the feasible independent validation front.

The companion commits each generation snapshot, completion event, and recovery checkpoint together. Recovery resumes committed generations and deduplicates logical evaluation identities. Local history, snapshots, events, and replay bytes count against `memoryLimitBytes` (default 256 MiB). Exceeding the limit raises `MEMORY_LIMIT` rather than discarding history.

## Errors and exports

`OptimizationError.detail` contains `code`, `stage`, `message`, and available `candidateId`, `seed`, `asset`, or `cause`. Examples include `WORKER_STARTUP`, `WORKER_FAILED`, `WORKER_PROTOCOL`, `WASM_LOAD`, and `MEMORY_LIMIT`. Surface the stage and message in the application; include asset context for browser deployment failures.

Archives retain events, generation snapshots, candidate and seed evidence, failures, and requested replay resources. `openArchive` validates the version, checksum, and resource paths, and returns a data-only reader. Opening an archive executes no model code. Exported data is not a resumable checkpoint; only the companion's committed internal checkpoints support execution recovery.

## Integration conventions and trade-offs

Keep model reconstruction, simulation measurements, and replay rendering in the consuming application. Genetic Assembly owns optimization, worker scheduling, and evidence; the simulation library owns simulation behavior. Use public package exports rather than private paths or sibling checkouts.

The `?worker` import above is a Vite-specific asset convention. Other bundlers can use the same public worker entry and supply `solverWorkerFactory`; no Vite configuration is required by the core SDK. The optional Vite helper excludes the SDK from prebundling for the default relative worker factory. Prefer the explicit worker import when using normal prebundling.

Service event streams use cursor-based HTTP polling behind their async-iterator interface, rather than a persistent push connection. This simplifies reconnects and persisted replay, with polling latency and request overhead as the trade-off. Local streams follow retained in-memory events.

Local and service handles share asynchronous lifecycle methods, but their metadata and setup are not identical. Local execution accepts a model object and constructor-level worker/memory settings; service execution accepts an immutable prepared study and configures evaluation concurrency per run. The `validate: false` run option applies to local execution; the prepared Node service runtime always validates finalists. Local history belongs to the optimizer, while service history belongs to durable operations. Portable export entry points also differ as described above.

Until registry publication, coordinated tarballs provide reproducible installation. A repository may vendor a pinned artifact with its lockfile integrity, as the examples do. This is a distribution choice rather than a runtime dependency on a sibling checkout. Publishing coordinated package versions would allow ordinary registry installation without changing the integration code.
