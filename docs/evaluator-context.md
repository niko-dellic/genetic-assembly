# Evaluator context

A study's `evaluate(decisions, inputs, context)` returns `{metrics, warnings?}`. Metrics are named finite numbers. Missing objective or constraint measurements fail the evaluation and remain visible in history.

| Context member | Meaning |
|---|---|
| `seed` | Declared simulation seed; independent of the solver seed |
| `phase` | `baseline`, `search`, `validation`, or `replay` |
| `signal` | Cooperative cancellation signal; check it between bounded operations |
| `retainReplay` | Whether this evaluation should produce replay resources |
| `retainDataset(dataset)` | Retain one dataset with `manifestKey`, `runHash`, and a map of relative paths to `Uint8Array` bytes |

Only baseline and selected replay evaluations retain replay resources. Do not attach every search trace. Raw seed measurements remain retained even when no replay exists.

`repair(decisions, inputs)` returns canonical decisions and a list of repair messages. `validate(decisions, inputs)` returns domain-invalidity messages; invalid designs become infeasible. Configuration errors, exceptions and invalid measurements remain failures. `materialize(decisions, inputs)` returns portable application data; it does not apply changes to the consumer.

Node companion evaluators additionally receive an isolated temporary `directory` for filesystem-oriented integrations. Portable models should use byte resources so the same model can execute in a browser. The companion uploads those resources to its configured artifact store.

For explicit module workers, `serveEvaluator` installs the evaluation message handler. The host supplies the seed, phase and inputs; cancellation terminates the owned worker. For inline evaluation, synchronous code must yield before it can observe `signal`.
