# Goals, feasibility and seeds

Each objective references a named measurement and declares `minimize` or `maximize`. Units describe the raw value; the solver handles direction internally. Do not negate a maximizing metric yourself.

A constraint references a metric, an operator (`<=` or `>=`), and a bound. The SDK converts it into signed violation: zero or less is feasible. Domain validation adds its own constraint. Missing or non-finite goal measurements fail evaluation; they never become favorable default scores.

`searchSeeds` declares simulation replicates used to compare every search candidate and the baseline. `validationSeeds` is a separate, disjoint fixed set used to reevaluate finalists. The experiment's `seed` controls evolutionary randomness, independently of simulation seeds.

Every replicate is retained. Search objectives and constraints use arithmetic means over the declared seed set. This is a mean constraint policy, not a guarantee that every replicate satisfies a limit. Use a model metric that expresses the desired risk policy if a different decision rule is needed.

Successful evaluation reuse requires the same canonical design, baseline inputs, model/runtime identity, phase, seed, and measurement configuration. Model edits produce a new runtime snapshot and invalidate that identity. Replay evaluations execute again to generate datasets.

Keep raw measurements even when you change which goals matter. Prepare a new study revision for changed goal mappings so results retain their original interpretation.
