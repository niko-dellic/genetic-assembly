# Core concepts

## Variables and genes

A genome is an ordered array of numbers. Real variables have lower/upper bounds; integer variables may specify a step; binary variables take 0 or 1. Keep variable IDs and ordering stable across problem, evaluation, and materialization.

## Objectives and trade-offs

Declare each objective as `minimize` or `maximize`. Genetic Assembly normalizes maximization internally. NSGA-II uses non-dominated sorting and crowding distance to retain diverse trade-offs. The Pareto front is a set of candidates for the application or user to choose among, not a promise of a global optimum.

## Constraints

Return one finite value for each declared constraint. A value `<= 0` is feasible. For capacity that must be at least 80, return `80 - capacity`. Feasible candidates dominate infeasible ones; constraint violation guides selection among infeasible candidates.

## Evolution

Each generation creates offspring and selects from parents plus offspring. Built-in operators support real, stepped integer, and binary variables. Adapter-owned operators let the project construct and repair domain-specific candidates while Rust retains NSGA-II selection.

## Reproducibility

Use fixed seeds and stable input ordering. Adapter results must not depend on wall time, request arrival order, or ambient randomness. For stochastic simulations, evaluate using a fixed set of model seeds. Change the adapter version whenever its mathematical behavior changes. Revisions and checkpoints identify exact input contracts; they do not snapshot arbitrary project files or adapter process memory.

## Trusted execution

Adapters execute project code in the companion environment. The built-in QuickJS evaluator restricts ambient capabilities, but this system is intended for trusted project code. Keep the service local or behind access controls for trusted users.
