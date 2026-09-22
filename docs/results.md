# Reading results

## Final candidates

`getResults(runId)` returns `members`. Each member contains an `individual` with ordered genes, objectives, constraints, rank, crowding distance, and total constraint violation. Generic adapters can add a `materialization`; Three.js runs return scene patches.

Use objective names and directions from the problem when presenting trade-offs. A numerically smaller maximizing objective is not better. Inspect constraint feasibility before applying a candidate. Rank and crowding distance are selection metadata, not domain quality scores.

## Materialization

Keep evaluation responses compact. Use `materialize` to create application-facing output only for the retained front. Large outputs can be represented through stored artifacts. Applications own validation and the final choice to apply a solution.

## Analytics

`getAnalytics(runId)` returns objective, lever, and constraint metadata, retained candidates, and generation summaries. `history_complete` indicates whether full history is available. Do not present sampled fronts as complete historical populations.

Convergence charts show objective statistics over generations; they do not establish optimality. The [visualizations package](./visualizations.md) consumes an `OptimizationDataset` matching these concepts.
