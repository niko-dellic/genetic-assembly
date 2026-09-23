# First baseline and optimization

After [installing the SDK and CLI](./installation.md), `ga init` creates `study.mjs` and `ga.config.json`, and adds `ga:*` npm scripts without overwriting existing scripts.

```js
import { defineStudy } from '@genetic-assembly/sdk'
export default defineStudy({
  name: 'Two targets', version: '1', inputs: {},
  decisions: { x: { kind: 'real', lower: 0, upper: 1, baseline: 0.5 } },
  objectives: {
    left: { metric: 'left', direction: 'minimize' },
    right: { metric: 'right', direction: 'minimize' }
  },
  searchSeeds: [42, 43], validationSeeds: [142, 143],
  evaluate: ({ x }) => ({ metrics: { left: x * x, right: (1-x) * (1-x) } }),
  materialize: decisions => decisions
})
```

```sh
npm run ga:check
npm run ga:baseline
npm run ga:run -- --population 12 --generations 4 --seed 42 --export study.ga.json
npm run ga:inspect -- study.ga.json
```

`check` imports your actual model and repeats the baseline evaluation with the same seed. It rejects invalid decisions, missing goal measurements, non-finite numbers, and differing repeated results. `baseline` retains seed-level measurements and any dataset your model produces. `run` uses the packaged WASM solver, validates finalists, and exports only when `--export` is supplied. Local execution requires no Docker. Add `--inspect` for a live inspector.

Open the inspector to select a run, inspect individual seeds, and compare search with validation. Neither optimization nor export changes your application; applying an exported design is an explicit application action.

See [local execution](./local) for the `new Optimizer()` API and browser setup.

## Durable service execution

Set `execution: "service"` in `ga.config.json`, then run `npm run ga:up` to build and register an immutable model snapshot. The following API connects to a prepared service study.

```js
import { StudyClient } from '@genetic-assembly/sdk'
const client = new StudyClient('http://127.0.0.1:3001')
const { items: studies } = await client.studies()
const run = await client.run(studies[0].id, { population_size: 12, generations: 4, seed: 42 })
for await (const status of run.progress()) console.log(status.status)
console.log(await run.results())
console.log(await run.export())
```

Use the study ID saved by `ga up` when multiple revisions exist. [Run handles](./api-reference/sdk/classes/RunHandle.md) can also cancel, wait, read history, and retrieve analytics.
