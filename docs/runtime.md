# Runtime, workers, and observation

Version 0.5.0 is a breaking release. Install all Genetic Assembly packages at 0.5.0. Studies use schema version 3, companion endpoints use `/v3`, and portable archives use format version 2. The managed companion uses new `v5` storage volumes; previous volumes and archives are not migrated or read.

## Operation handles

`await optimizer.baseline(study)`, `await optimizer.run(study, options)`, and `await optimizer.replay(study, decisions)` return operation handles. Creating a handle does not mean execution has completed. Use `await handle.wait()` for terminal status or `await handle.completed()` for results. `wait()` throws a structured error on failure; cancellation returns a cancelled status. `results()` requires available results.

Every handle implements `OperationHandle<T>`: asynchronous `status()`, `history({offset, limit, phase, status, candidateId})`, `generations({offset, limit})`, `cancel()`, `wait(signal?)`, `completed(signal?)`, `results()`, and `events({after, signal})`. Status and cancellation return the same `OperationStatus` shape in both modes, with optional completed-generation progress and structured failure details. Cancellation requests a stop; use `wait()` to observe completion. Aborting a wait only stops observation. `OptimizationHandle` extends the common contract with candidate aggregates for searches. Baseline and replay have no generation snapshots. Local handles additionally offer a guarded status callback through `subscribe`; throwing from a callback never changes execution.

```ts
const run = await optimizer.run(study, { populationSize: 24, generations: 12 });
let cursor = 0;
for await (const event of run.events({ after: cursor })) {
  cursor = event.sequence;
  if (event.type === "generation-completed") {
    const snapshots = await run.generations();
    console.log(snapshots.items);
  }
}
const results = await run.completed();
```

Persist the last processed sequence if a service observer must reconnect. Cursors are opaque monotonically increasing numbers, not array indexes; gaps are permitted. Local streams replay retained events before following execution. Aborting a stream disconnects that observer. It does not cancel the operation. Call `cancel()` explicitly to cancel work.

Events identify the operation, phase, candidate, simulation seed, and retained evaluation record where applicable. Evaluation events carry active and queued counts. Generation completion means the surviving population snapshot is available. A phase event separates search from independent finalist validation. Terminal events are completed, cancelled, or failed.

## Browser packaging

The SDK core has no Vite dependency. `solverWorkerFactory` accepts a worker created by the application's bundler or asset setup. Node automatically uses the packaged worker. In a Vite application, use its explicit worker import to preserve relative WASM resolution through dependency prebundling:

```ts
import { Optimizer } from "@genetic-assembly/sdk";
// Vite application adapter, not a core SDK requirement.
import SolverWorker from "@genetic-assembly/sdk/solver-worker?worker";
const optimizer = new Optimizer({
  solverWorkerFactory: () => new SolverWorker(),
  evaluationConcurrency: 4,
});
```

Other bundlers can create a module worker from the public entry using their own asset conventions. A plain app-owned worker that imports the SDK worker can still be prebundled by Vite, relocating its relative WASM URL; do not substitute that wrapper for the explicit import without controlling asset resolution. The explicit Vite recipe is tested in development, production, and under a non-root base path.

Ship the emitted worker and WASM files. `/solver-worker` and `/solver.wasm` are supported package exports. A custom `solverWorkerFactory` owns worker creation; the SDK owns the returned worker's lifetime. Node automatically uses its packaged worker and WASM file. For an application using the default relative worker factory instead, merge `geneticAssemblyVite()` from `@genetic-assembly/sdk/vite` into the Vite configuration; this keeps that entry out of development prebundling.

## Evaluator ownership

`defineWorkerStudy(spec, factory, hooks, {mode: 'pooled'})` uses an optimizer-owned pool, isolated per registered study. Workers handle one evaluation at a time. Each receives cloned decisions, inputs, seed, phase, and replay-retention context. Do not retain mutable simulation state across jobs. Use `{mode: 'isolated'}` when a module requires a fresh process state for each evaluation.

`serveEvaluator(evaluate)` serves a browser module; pass Node's `parentPort` for worker threads. The optimizer's `evaluationConcurrency` is bounded from 1 to 64. A run can override it with `evaluationConcurrency`. Results are delivered to the solver in candidate order regardless of completion order. Simulation seeds are independent of the solver seed.

Prepared companion modules use persistent slots through the CLI-generated worker factory and negotiate supported concurrency in the adapter handshake. A directly supplied `serveStudy` without a worker factory declares one slot. Do not create another independent pool inside each slot; use the simulation's single-evaluation entry point. The service terminates the evaluator process group on forced cancellation. Worker-backed local cancellation terminates active slots and removes queued work. Inline callbacks must cooperate with their abort signal.

`optimizer.dispose()` releases local workers and retained data. Service disposal disconnects observation and leaves durable jobs running. Observer errors never enter the solver's evaluation path. Failed evaluations are not silently retried.

## History and evidence

`generations()` returns exact Rust solver survivors, ranks, crowding distances, population Pareto IDs, and a separate cumulative discovered Pareto front. `candidates({generation, phase})` returns aggregate evidence; search candidates are limited to completed generations so partial batches do not enter the discovered history; `history()` returns individual seed measurements. Use `collectPages` for more than one page. Snapshots refer to candidate IDs; seed evidence is retained once. Search evidence is never replaced by validation evidence. `results().validated` includes all evaluated finalists; `validatedFront` contains the feasible independent validation front.

The companion commits each generation snapshot, completion event, and recovery checkpoint together. Recovery resumes committed generations and deduplicates logical evaluation identities. Local history, snapshots, events, and replay bytes count against `memoryLimitBytes` (default 256 MiB). Exceeding the limit raises `MEMORY_LIMIT` rather than discarding history.

## Errors and exports

`OptimizationError.detail` contains `code`, `stage`, `message`, and available `candidateId`, `seed`, `asset`, or `cause`. Examples include `WORKER_STARTUP`, `WORKER_FAILED`, `WORKER_PROTOCOL`, `WASM_LOAD`, and `MEMORY_LIMIT`. Surface the stage and message in the application; include asset context for browser deployment failures.

Archives retain events, generation snapshots, candidate and seed evidence, failures, and requested replay resources. `openArchive` validates the version, checksum, and resource paths, and returns a data-only reader. Opening an archive executes no model code. Exported data is not a resumable checkpoint; only the companion's committed internal checkpoints support execution recovery.

## Integration conventions and trade-offs

Keep model reconstruction, simulation measurements, and replay rendering in the consuming application. Genetic Assembly owns optimization, worker scheduling, and evidence; the simulation library owns simulation behavior. Use public package exports rather than private paths or sibling checkouts.

Vite-specific `?worker` imports belong to the application integration and are not part of the core API. The optional `/vite` helper remains isolated from the main entry point. The explicit worker import above works with normal dependency prebundling and does not require the helper.

Service event streams use cursor-based HTTP polling behind their async-iterator interface, rather than a persistent push connection. This simplifies reconnects and persisted replay, with polling latency and request overhead as the trade-off. Local streams follow retained in-memory events.

`Optimizer.run` uses the same `RunOptions` in both modes: population 32, 20 generations, seed 42, validation enabled, and evaluation concurrency 1 by default. Both optimizer constructors accept `evaluationConcurrency` (1–64), and a run can override it without changing the next run's default. `validate: false` skips finalist validation in both modes. `OptimizationResults` separates search, all validated finalists, and the validated front. Both modes expose filtered, paginated operation history with a default page size of 50 and a maximum of 1,000, and `optimizer.runHandle(id)` retrieves a search handle.

Execution setup remains distinct: local execution receives executable model code and owns workers and memory; service execution receives a prepared study reference, URL, and credentials, and owns durable jobs. Low-level `StudyClient` resources retain HTTP metadata and snake-case solver configuration. Use the `Optimizer` and `OperationHandle<T>` interfaces for portable application code. Local session exports and service archives have different ownership scopes; see [Results and archives](./results.md).

Until registry publication, coordinated tarballs provide reproducible installation. A repository may vendor a pinned artifact with its lockfile integrity, as the examples do. This is a distribution choice rather than a runtime dependency on a sibling checkout. Publishing coordinated package versions would allow ordinary registry installation without changing the integration code.
