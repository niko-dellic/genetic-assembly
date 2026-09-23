# Author a study

A study combines serializable baseline inputs and named choices with executable model functions. Export `defineStudy({...})` from your configured entry file. Put every file the model reads in `ga.config.json`'s `files` list, and declare runtime dependencies in `package.json`.

## Decision domains

| Kind | Fields | Meaning |
|---|---|---|
| real | lower, upper, baseline | Bounded continuous value |
| integer | lower, upper, step, baseline | Bounded integer slots |
| boolean | baseline | Active or inactive |
| categorical | choices, baseline | Unordered alternatives |

Use stable names such as `facility.shop.capacity`. Evaluators receive names and values. The SDK compiles them into solver positions internally. Categorical crossover selects a parent category; mutation selects another category uniformly, without numeric interpolation.

## Evaluation

`evaluate(decisions, inputs, context)` returns `{metrics, warnings?}`. Every selected objective and constraint must reference a finite named metric. Return additional raw metrics for inspection even when they are not optimization goals.

The context contains `seed`, `phase`, `signal`, a temporary `directory`, and `retainReplay`. Use the supplied seed for all randomness. Check the signal during long work. The phases are `baseline`, `search`, `validation`, and `replay`.

Optional `repair` returns `{decisions, repairs}`. Make repairs deterministic and report each change. Optional `validate` returns domain-invalidity messages. Invalid candidates are explicitly infeasible and do not run the simulation. Throw errors for configuration mistakes, unavailable dependencies, and runtime failures; those failures are retained and stop the run.

Optional `materialize` produces an application design from canonical decisions. Optional `dataset` returns `{directory, manifestKey, runHash}` after a retained evaluation. Dataset files are uploaded before temporary files are removed. See [replay storage](./replay.md).

[Node API reference](./api-reference/node/index.md) · [Goal selection](./goals.md) · [grabm example](./grabm.md)
