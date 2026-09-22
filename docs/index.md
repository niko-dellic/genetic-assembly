# Genetic Assembly

## Optimization for your application

Turn project decisions into a reproducible search. Describe the variables you can change, evaluate the objectives you care about, and inspect a set of trade-offs instead of a single opaque answer.

Genetic Assembly runs deterministic NSGA-II in a Rust companion. Your application connects with a small TypeScript client; your model runs in a trusted adapter or the built-in Three.js evaluator. Docker provides the companion and Postgres locally.

[Install the packages](./installation.md) · [Run your first optimization](./quickstart.md) · [Browse all functions](./api-reference/functions.md)

## Choose your integration

| Your project | Start with |
| --- | --- |
| Simulation, scheduling, layout, or another custom model | [Adapter integration](./integrating-another-repository.md) |
| Static Three.js scene with numeric levers | [Three.js guide](./three.md) |
| Existing optimization results to display | [Visualization guide](./visualizations.md) |
| Python or another runtime | [NDJSON adapter protocol](./adapter-protocol.md) |

## What runs where

The application submits immutable problem and adapter revisions over HTTP. The companion performs evolution and selection, asks the adapter to evaluate candidate batches, and stores run state in Postgres. Artifacts and checkpoints use local or S3-compatible storage. Your application receives progress over SSE and retrieves the final Pareto front.

Installing the JavaScript packages does not embed the optimizer. The companion must be running. Browser/WASM solving, NSGA-III, and hostile multi-tenant execution are outside the current release.

[Explore recorded results](./examples.md) to understand the output before connecting your model.
