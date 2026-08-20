# Genetic Assembly usage guide

This guide covers ordinary use of the Genetic Assembly repository and its local NSGA-II companion. For connecting a different application or simulation, continue with [Integrating another repository](integrating-another-repository.md).

## Requirements

- Docker Desktop or another Docker Compose-compatible runtime.
- Node.js 20 or newer.
- Rust 1.89 or newer only when developing the Rust crates natively. It is not required for the normal Docker workflow.

## Start everything

From the repository root, run:

```bash
npm run up
```

This single command:

1. Installs missing or stale dependencies.
2. Builds the adapter SDK and executable reference adapter.
3. Builds and starts Postgres and the Rust companion in Docker.
4. Waits for both containers to become healthy.
5. Starts the React/Three.js workspace.

The frontend prefers [http://127.0.0.1:3333](http://127.0.0.1:3333). If that port is occupied, the terminal prints the next selected port. The API remains at [http://127.0.0.1:3001](http://127.0.0.1:3001).

Press Ctrl+C to stop the frontend. Postgres and the companion remain running so active and completed runs stay available.

## Lifecycle commands

```bash
npm run up          # bootstrap dependencies, start the backend, then run the UI
npm run up:backend  # start only Postgres and the Rust companion
npm run status      # show container state and health
npm run logs        # follow Postgres and server logs
npm run down        # stop the backend containers without deleting stored data
```

The named Docker volumes retain Postgres records, checkpoints, GLBs, and result artifacts across `npm run down` and subsequent starts.

To remove all local companion data, `docker compose down -v` deletes those named volumes. This is destructive and cannot be undone unless the volumes were backed up.

## Run the included Three.js problems

1. Open the frontend URL printed by `npm run up`.
2. Open **Current problem** and choose a problem. Changing the problem replaces the preview scene and evaluator definition.
3. Set the population size and generation count. Leave worker threads blank to use available native parallelism.
4. Select **Start optimization**.
5. Follow generation progress in the left pane and live analytics in the right pane.

The included problems demonstrate different front shapes:

- **Two-target placement** produces a two-objective tradeoff curve.
- **Three-anchor facility** produces a three-objective spatial Pareto surface.

The browser is only a client. Closing or refreshing it does not become the source of solver state; Postgres and the artifact store remain authoritative.

## Explore and apply results

The analytics inspector provides three linked workspaces:

- **Explore** shows the Pareto objective space and parallel coordinates.
- **Compare** shows diamond fitness, lever profiles, and constraint feasibility for the active and pinned candidates.
- **History** shows objective mean, population standard deviation, min/max envelopes, Pareto size, and feasibility counts by generation.

Interactions are linked:

- Hover a candidate to highlight it across charts.
- Click a candidate to apply its patch to the Three.js preview.
- Pin up to three candidates for comparison.
- Use **Browse all** for searchable and sortable access to the final front.
- Select **Revert** to restore the original scene values.

The scene is patched only when a candidate is clicked. Hovering never mutates the scene.

## Interpret solver values

Genetic Assembly uses declared objective directions. A minimizing objective prefers smaller values; a maximizing objective prefers larger values. Charts display raw values and preserve those declared directions when calculating fitness ranks.

Constraints follow one convention:

```text
constraint <= 0  means feasible
constraint > 0   means violated
```

Constraint domination is applied before objective dominance:

1. A feasible candidate dominates an infeasible candidate.
2. Between infeasible candidates, lower total positive violation is preferred.
3. Between feasible candidates, ordinary Pareto dominance and crowding distance apply.

The final results endpoint returns the ordered rank-zero front. Candidate IDs are stable within a run but should not be treated as identities across separate runs.

## Configuration defaults

The API accepts the following NSGA-II configuration:

| Field | Default | Meaning |
| --- | ---: | --- |
| `population_size` | `100` | Parent population size; must be at least 4. |
| `generations` | `200` | Number of completed generations. |
| `crossover_probability` | `0.9` | Probability of crossover; from 0 to 1. |
| `mutation_probability` | `null` | Per-variable probability; `null` means `1 / variable_count`. |
| `sbx_distribution_index` | `15` | Positive SBX distribution index. |
| `mutation_distribution_index` | `20` | Positive polynomial-mutation distribution index. |
| `seed` | `0` | Deterministic 64-bit solver seed. |
| `threads` | automatic | Rayon thread count for native built-in evaluation. External adapters own their concurrency. |

Start with a small population and generation count while developing an evaluator. Increase them only after evaluation correctness and runtime are understood.

## Cancellation and recovery

Cancellation is cooperative between evaluation batches and generations. Use the UI cancel control or:

```bash
curl -X POST http://127.0.0.1:3001/v1/runs/RUN_ID/cancel
```

Checkpoints are written every five completed generations, on cancellation boundaries, and at completion. On restart, an expired run lease is recovered only when its problem, adapter, protocol, engine, configuration, and artifact hashes still match.

Only one optimization is active in the local companion at a time. Additional runs remain queued. This avoids CPU oversubscription and makes the current execution-isolation boundary explicit.

## Storage

Postgres stores revision metadata, run state, leases, generation summaries, final front members, and durable SSE events. The artifact backend stores GLBs, compressed checkpoints, large materializations, and other binary inputs or outputs.

The default Docker workflow uses named local volumes. Native development uses `GA_ARTIFACT_ROOT`. Setting `GA_S3_BUCKET` and the standard `AWS_*` variables switches the server to S3-compatible object storage.

Browser storage may cache UI state, but it is never authoritative solver storage.

## Health and troubleshooting

Check the stack first:

```bash
npm run status
curl http://127.0.0.1:3001/health
npm run logs
```

A healthy API returns:

```json
{
  "adapter_protocol": "genetic-assembly-adapter-v1",
  "execution_mode": "single_run_in_process",
  "status": "ok"
}
```

Common failures:

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Frontend chooses 3334 or higher | Port 3333 is occupied. | Use the URL printed by the command or stop the other frontend. |
| Docker cannot bind port 3001 | Another API process owns the fixed backend port. | Stop that process or change the Compose port and the client base URL together. |
| `run is failed` | The server recorded a structured evaluator or adapter error. | Read the run status and `npm run logs`; the stored `error` is the primary diagnostic. |
| Adapter executable not found | The launch path is a host path rather than a container path, or the adapter was not built. | Use a `/workspace/...` path in Docker mode and build/bundle the adapter first. |
| Adapter version mismatch | `adapter_version` differs from the value returned by `initialize`. | Change both versions together and register a new immutable adapter revision. |
| Wrong objective or constraint count | The adapter response does not match the problem bundle. | Return one finite objective per declared objective and one constraint per declared constraint. |
| NaN or infinity failure | A model produced a non-finite number. | Convert invalid model states into finite penalty objectives or positive constraint violations. |
| Run stays queued | Another run is active. | Wait, cancel the active run, or inspect its lease and logs. |

## Development checks

Before committing solver or integration changes, run:

```bash
npm test
npm run build
cargo clippy --workspace --all-targets -- -D warnings
```

The non-spatial adapter can be exercised end to end against a running backend with:

```bash
npm run test:companion
```
