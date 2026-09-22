# Run lifecycle

## Register immutable inputs

Upload artifacts, then create a problem and an adapter revision. Store their returned IDs with your experiment configuration. A Three.js run instead references scene and evaluator revisions. Supply exactly one revision pair to the run API.

## Start and observe

`CompanionClient.startRun(problemId, adapterId, config)` returns a run ID. Status progresses through `queued`, `running`, then `completed`, `failed`, or `cancelled`. Poll `getRun(id)` or await `subscribe(id, callback, signal)` for SSE progress.

The clients reconnect using the last event ID and stop at terminal events. Aborting the subscription only stops observation; use `cancel(id)` to stop the optimization. Always inspect final status before treating results as a successful run.

## Cancellation and failures

Cancellation is cooperative at evaluation boundaries. An adapter can take time to respond; configure its timeout and retry limit. Inspect `RunStatus.error` on failure. API errors expose the HTTP status and response body. Do not assume a timed-out request was never accepted; inspect known run IDs before resubmitting.

## Recovery and storage

Postgres stores metadata, leases, and progress. Versioned compressed checkpoints support restart recovery with compatible problem, adapter, and solver inputs. Keep artifact storage with the database when moving a deployment. Do not remove Docker volumes unless you intend to discard stored runs.

The companion executes one active run at a time. External adapters manage their own concurrency; declaring `max_concurrency` does not create workers automatically.
