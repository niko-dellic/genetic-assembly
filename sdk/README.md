# @genetic-assembly/sdk

Define a study, evaluate its baseline, optimize, inspect evidence and export.

```js
import { Optimizer, defineStudy } from "@genetic-assembly/sdk";
const study = defineStudy({
  name: "Example",
  version: "1",
  inputs: {},
  decisions: { x: { kind: "real", lower: 0, upper: 1, baseline: 0.5 } },
  objectives: { cost: { metric: "cost", direction: "minimize" } },
  evaluate: ({ x }) => ({ metrics: { cost: Number(x) ** 2 } }),
});
const optimizer = new Optimizer();
try {
  await (await optimizer.baseline(study)).completed();
  const run = await optimizer.run(study, {
    populationSize: 12,
    generations: 4,
    seed: 42,
  });
  await run.wait();
  console.log(await run.results());
  const bytes = await optimizer.export();
} finally {
  optimizer.dispose();
}
```

Local execution uses packaged Rust WebAssembly in Node/browser workers. No Docker or Rust is needed in consumers. Memory retention defaults to 256 MiB; exports are explicit data-only archives, not resumable checkpoints.

Use `execution:'service'` with a prepared study for durable companion jobs. Node adapter/filesystem helpers live under `/node`. `defineWorkerStudy` and `serveEvaluator` support explicit module evaluators without serializing closures.

Both modes implement `OperationHandle<T>` with common status, cancellation, abortable observation, and paginated history. `RunOptions` uses identical defaults and validation/concurrency semantics. Browser applications provide a standard module-worker factory; Vite is optional and absent from the core dependency graph. See the [runtime guide](https://genetic-assembly.vercel.app/docs/runtime.html).

[Local guide](https://genetic-assembly.vercel.app/docs/local.html) · [API](https://genetic-assembly.vercel.app/docs/api-reference/sdk/)

npm publication remains deferred; install coordinated local tarballs.
