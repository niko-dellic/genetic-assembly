# Genetic Assembly

Reproducible optimization studies for applications and simulation libraries. Keep your model in your project; use the JavaScript SDK and managed Rust NSGA-II companion to evaluate competing goals, retain evidence, compare candidates and export a selected design.

[Documentation](https://genetic-assembly.vercel.app/docs/) · [First baseline](docs/quickstart.md) · [grabm example](docs/grabm.md)

## Local installation

Version 0.4 is a breaking, local-tarball release. npm publication is deferred.

In this development checkout:

```sh
npm ci
npm run setup
npm run pack
```

In a separate project, with Node 22.12+:

```sh
npm install /path/to/artifacts/genetic-assembly-sdk-0.5.0.tgz /path/to/artifacts/genetic-assembly-cli-0.5.0.tgz
npx ga init
npm run ga:check
npm run ga:baseline
npm run ga:run -- --population 12 --generations 4 --export study.ga.json
npm run ga:inspect -- study.ga.json
```

Local runs use the packaged Rust/WASM solver in a worker. No Docker or Rust installation is needed. Choose `execution: "service"` in `ga.config.json` for durable history and restart recovery.

For service execution, the CLI includes the companion's build recipe and Rust sources. Consumers do not need a checkout or host Rust. It snapshots declared files, inputs and locked dependencies into a versioned Linux runtime; installed package assets and child entry points remain intact.

## Define a study

```js
import { defineStudy } from "@genetic-assembly/sdk";
export default defineStudy({
  name: "Two targets",
  version: "1",
  inputs: {},
  decisions: { x: { kind: "real", lower: 0, upper: 1, baseline: 0.5 } },
  objectives: {
    left: { metric: "left", direction: "minimize" },
    right: { metric: "right", direction: "minimize" },
  },
  searchSeeds: [42, 43],
  validationSeeds: [142, 143],
  evaluate: ({ x }) => ({ metrics: { left: x * x, right: (1 - x) * (1 - x) } }),
  materialize: (decisions) => decisions,
});
```

Named real, integer, boolean and categorical decisions compile internally. All seed-level measurements are retained. Baselines and selected candidates can retain replay datasets; search and validated fronts remain separate. Repair, domain validation, materialization and dataset hooks keep application knowledge out of the solver.

Optional packages provide a mountable inspector, Three.js integration and charts. Application-specific examples live in `examples/` and can be explored in the [examples dashboard](https://genetic-assembly.vercel.app/docs/examples). The grabm example keeps demand fixed while changing bounded graph choices and optimizes fulfillment, accessibility and a documented cost proxy.

## Development and checks

```sh
npm test
cargo clippy --workspace --all-targets -- -D warnings
npm run pack
npm run test:packed
npm run test:consumer-companion
npm run docs:test
```

The consumer suite installs tarballs outside the checkout and tests Docker setup, grabm child processes, durable datasets, repeatability, history integrity, cancellation and restart.

Data uses the new `ga-<project>-v5` namespace. Old development volumes are left intact. Use `ga backup DIRECTORY` before explicit cleanup. [Backend setup](docs/backend.md) documents ports, volumes, remote runtimes and disposal.

The local companion executes trusted application code. Keep it on localhost or deploy behind suitable authentication. Local browser execution runs the Rust solver as packaged WASM in a worker. Service execution runs it in the Rust companion; the browser observes and controls durable jobs.

MIT licensed.
