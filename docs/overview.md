# Genetic Assembly

Start with [local execution](./local): the packaged Rust/WASM solver runs in Node or a browser without Docker. Use the managed service for durable shared history and restart recovery. Try the [live neighborhood study](./live-neighborhood) before integrating your own model.

Turn an application's design choices into a reproducible optimization study. Define what may change, measure competing goals, compare candidates with a baseline, and export a chosen design.

The JavaScript SDK integrates your model with a local Rust NSGA-II companion. Docker manages the companion and its internal Postgres database. Simulation code stays in your application; the solver understands decisions, measurements, and feasibility.

## Start with your application

1. [Install local packages](./installation.md) into your own project.
2. [Define and check a baseline](./quickstart.md).
3. [Declare decisions and goals](./integrating-another-repository.md).
4. [Run an experiment](./runs.md) with fixed simulation seeds.
5. [Compare results](./results.md), [retain selected replays](./replay.md), and export.

For a complete simulation example, use the [grabm neighborhood study](./grabm.md). It changes bounded graph geometry and capacity while holding population and authored demand fixed.

## Choose an integration

| Package | Purpose |
|---|---|
| `@genetic-assembly/sdk` | Browser-safe study client, contracts, run handles |
| `@genetic-assembly/sdk/node` | Study definitions, validation, model execution |
| `@genetic-assembly/cli` | Initialize, package, run and manage local services |
| `@genetic-assembly/grabm` | Optional bounded graph simulation adapter |
| `@genetic-assembly/inspector` | Optional mountable study browser |
| `@genetic-assembly/three` | Optional existing scene integration |
| `@genetic-assembly/visualizations` | Optional charts |

Version 0.4 introduces the study workflow and `/v2` API. npm publication is deferred; use coordinated local tarballs. The previous client/adapter packages and scene HTTP routes have been removed.
