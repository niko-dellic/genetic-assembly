# Core concepts

## Studies and revisions

A study describes baseline inputs, named decisions, selected objectives, constraints and simulation seed sets. Preparing it produces an immutable revision with a runtime identity. An experiment runs the solver against that revision. Candidate designs and seed-level evaluations retain their relationship to the revision even after the application changes.

## Decisions

Real and integer decisions have bounds; integers may use a step. Boolean decisions activate a declared choice. Categorical decisions select unordered alternatives. The SDK handles numeric solver positions internally, so model code uses stable names and values.

## Objectives and constraints

Objectives declare `minimize` or `maximize`. NSGA-II retains non-dominated trade-offs rather than promising one universally best candidate. Each constraint references a measurement and bound; signed values of zero or less are feasible. Feasible candidates dominate infeasible ones, with aggregate violation guiding selection among infeasible candidates.

## Evaluations and replay

Each candidate is evaluated against the same search seed set, and every seed's raw measurements remain available. Baselines and selected replay jobs may also retain full simulation datasets. A measured candidate does not necessarily have replay data.

Finalists are evaluated on disjoint validation seeds. Their validated front is distinct from the original search front, including when validation changes feasibility.

## Reproducibility

Keep inputs and seed policies fixed and use `context.seed` inside the model. Managed preparation snapshots declared files and locked dependencies. The solver seed controls evolutionary variation independently of simulation seeds. Checkpoints and idempotent evaluation identities support compatible recovery without inventing new measurements for completed work.

## Trusted execution

Models execute application code in the companion environment. Keep the default localhost configuration or deploy behind appropriate access controls for a trusted team. See [model authoring](./integrating-another-repository.md), [goals](./goals.md) and [backend setup](./backend.md).
