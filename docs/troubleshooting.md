# Troubleshooting

| Symptom | Action |
|---|---|
| Missing metric | Check the goal's metric name and return a finite value for every selected goal and constraint |
| Baseline differs across repeats | Seed every random source with `context.seed`; avoid clock/time, mutable state and nondeterministic external data |
| Baseline invalid | Read validation issues, then fix inputs or declared bounds before optimizing |
| Connection refused | Run `ga status`, inspect `ga logs`, and verify the configured port |
| Package missing in Docker | Put it in production dependencies and retain the lockfile |
| Missing data or child entry point | Add model assets to `files`; use complete tarballs instead of bundling the model into one file |
| Local dependency directory rejected | Install a `.tgz` package instead of a linked source directory |
| Native dependency fails | Use a compatible custom base image and explicit system dependencies |
| Replay unavailable | Request replay for the selected candidate; search measurements do not retain every simulation trace |
| Changed validation feasibility | Inspect validation seeds and constraints separately from the original search front |
| Port already in use | Choose another port in `ga.config.json`; prepare the study again |
| Restart cannot load runtime | Restore the snapshot volume together with Postgres and artifact storage |

`ga check` runs the actual configured model and returns a nonzero status for actionable failures. Runtime errors remain explicit failed evaluations. For setup details see [backend setup](./backend.md); for seed semantics see [goals](./goals.md).
