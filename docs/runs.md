# Run experiments

Prepare a study with `ga up`, then run `ga baseline` before optimization. Use `ga run --population 24 --generations 8 --seed 42`, or call `StudyClient.run(studyId, config)`.

Runs transition through queued, running, completed, failed or cancelled. A run handle observes status with `progress()`, waits with `wait()`, cancels with `cancel()`, retrieves per-seed `history()`, and exports results. Aborting a progress observer only stops observation; call `cancel()` to stop computation.

Seed-level records are persisted before each adapter batch response. Recovery deduplicates candidate/phase/seed identities; failed simulations are not silently retried. Successful measurement reuse is scoped to the immutable runtime and study definition. Solver checkpoints preserve supported restart recovery; already stored measurements remain queryable after failure or cancellation.

Keep the database, artifact storage and snapshot volume together across restarts. A missing runtime directory is an actionable run failure; restoring only the database cannot recreate executable code or replay bytes.

Validation reevaluates finalists with separate seeds. `results().search` retains the original search front; `results().validated` is computed separately from fully measured validation candidates. Validation can change feasibility and dominance. Never present validation scores as though they were the original search measurements.

Use `events({after})` for replayable observation and `generations()` for committed solver snapshots. See [runtime and observation](./runtime.md).
