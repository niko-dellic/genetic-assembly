# Visualizations

Install the visualization tarball and `three`. Renderers are framework-neutral and mount into DOM elements with a nonzero width and height.

<<< ../tools/docs/snippets/visualizations.ts

Use a separate element for each chart and call the returned cleanup function when your view unmounts. Pass updated data or selection through `update`, resize with the container, and destroy chart resources on removal.

## Available views

| Function | Purpose |
| --- | --- |
| `createParetoScatter` | Two-objective trade-offs and candidate selection |
| `createParetoSpace3d` | Three-objective spatial view |
| `createParallelCoordinates` | Compare several objectives |
| `createDiamondFitness` | Direction-aware relative objective profiles |
| `createLeverProfile` | Compare design variables |
| `createConstraintFeasibility` | Inspect feasible and violated constraints |
| `createConvergenceHistory` | Objective statistics over generations |
| `createGenerationCounts` | Population and feasibility counts |

Use `validateDataset` at integration boundaries. Selection state links views through candidate IDs. Missing complete history should remain visible as unavailable rather than being filled with invented values.

[Recorded interactive examples](./examples.md) · [All visualization functions and types](./api-reference/visualizations/index.md)

Use `fromGenerationSnapshots(study, snapshots, candidates)` to adapt SDK-owned generation history. It uses exact population and front membership, computes chart statistics from the referenced aggregate measurements, and rejects missing candidate evidence. It does not infer survivors from evaluation order.
