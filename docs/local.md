# Local optimization

`new Optimizer()` runs the Rust solver as packaged WebAssembly in an owned worker. It needs neither Docker nor a Rust installation in the consuming project. Use the companion when you need durable history, restart recovery, or shared access.

```ts
import {Optimizer, defineStudy} from '@genetic-assembly/sdk'

const study = defineStudy({
  name: 'Two targets', version: '1', inputs: {},
  decisions: {x: {kind: 'real', lower: 0, upper: 1, baseline: 0.5}},
  objectives: {
    left: {metric: 'left', direction: 'minimize'},
    right: {metric: 'right', direction: 'minimize'},
  },
  searchSeeds: [42, 43], validationSeeds: [142, 143],
  evaluate: ({x}) => ({metrics: {left: Number(x) ** 2, right: (1 - Number(x)) ** 2}}),
})
const optimizer = new Optimizer({execution: 'local', storage: 'memory'})
try {
  const baseline = await (await optimizer.baseline(study)).completed()
  const run = await optimizer.run(study, {populationSize: 16, generations: 8, seed: 42})
  await run.wait()
  console.log(baseline, await run.results(), await run.history())
  const archive = await optimizer.export()
  // Save these bytes explicitly if you want to inspect the session later.
} finally {
  optimizer.dispose()
}
```

Local operations queue per optimizer. `evaluationConcurrency` defaults to one; increase it only when the model can safely evaluate concurrently. Each candidate uses the declared simulation seeds independently of the solver seed. Search and finalist validation measurements remain separate.

Inline evaluation receives a cooperative `AbortSignal`. Synchronous application code must yield before cancellation can be observed. Disposing the optimizer terminates its solver worker and aborts evaluations. A service optimizer does not cancel durable jobs when disposed.

The default retained-data limit is 256 MiB, configurable with `memoryLimitBytes`. Reaching it fails explicitly; history is not silently dropped. This limit accounts for retained records and replay resource bytes, not the simulation's working memory or browser process overhead. Large models can still exhaust process memory.

## CLI

After installation and initialization:

```sh
npm run ga:check
npm run ga:baseline
npm run ga:run -- --population 12 --generations 4 --seed 42 --export neighborhood.ga.json
npm run ga:inspect -- neighborhood.ga.json
```

Add `--inspect` to `ga run` to keep a temporary localhost inspector open. Press Ctrl+C to close it. The local command runs the baseline, search, and finalist validation; no background database is started. `ga inspect PATH` opens a read-only export without loading the original model.

Set `execution` to `service` in `ga.config.json`, or pass `--service`, for the managed companion. `ga up`, storage backups, and service logs still belong to that mode.

## Archives and replay

Use `openArchive(bytes)` to verify and open an archive. A service run also provides `await run.archive()` to download a self-contained archive, including retained replay resources. It contains data and replay resources, never executable model code. An archive supports inspection and playback of included replays. It cannot resume optimization or generate missing replays without the original model.

## Browser bundling

Use a bundler with module-worker and WebAssembly asset support, such as the tested Vite recipe. Deploy the emitted worker scripts and `.wasm` asset alongside the application. The solver is single-threaded inside its worker; it does not require shared memory or cross-origin isolation. Node uses `worker_threads` with the same packaged binary.

Reproducibility is scoped to compatible engine/model/runtime versions. Do not assume floating-point results are bit-identical across unrelated platforms or model implementations.

## Module evaluator workers

Use `defineWorkerStudy(spec, createWorker)` when evaluation should run in a worker. The factory creates an owned worker from a module supplied by your application; functions and closures are never serialized. In that module, import your evaluator and call `serveEvaluator(evaluate)`. For Node, pass `parentPort` as the second argument. Keep repair, validation and materialization hooks on the study definition.

```ts
const study = defineWorkerStudy(spec, () =>
  new Worker(new URL('./evaluation.worker.ts', import.meta.url), {type: 'module'})
)
```

Workers are reused within one optimizer and study. Choose isolated mode for fresh module state; cancellation terminates an active worker, including when evaluation hangs. Use bounded concurrency; do not create uncontrolled nested worker pools. Inline models can keep application closures, but their cache identity is limited to the registered model object within that optimizer session. Update the declared version and model registration when behavior changes.

## Runtime comparison

The repository checks native/WASM solver fixtures within a `1e-12` relative/absolute tolerance and compares the seeded neighborhood measurements in Node, Chromium, Firefox and WebKit. Tiny last-digit differences can occur in travel-time arithmetic across JavaScript engines. Benchmark records are written to `artifacts/solver-benchmark.json` and `artifacts/grabm-benchmark.json`; the small numerical fixture does not predict simulation throughput.

See [runtime, workers, and observation](./runtime.md) for the supported Vite recipe, operation handles, generation snapshots, cursor streams, and structured errors.
