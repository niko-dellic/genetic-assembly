# CLI commands

Run commands in the consuming project containing `ga.config.json`.

| Command | Result |
|---|---|
| `ga init [--template grabm]` | Create study and runtime configuration, preserving existing files |
| `ga check` | Evaluate the configured baseline twice, check named metrics and repeatability; nonzero on failure |
| `ga up` | Snapshot, build, start and register the study |
| `ga baseline` | Prepare and retain baseline evaluations/replays |
| `ga run [--population N] [--generations N] [--seed N]` | Prepare, optimize, observe and export |
| `ga inspect` | Open the companion's local inspector |
| `ga status` | Query health, revisions, runs and jobs |
| `ga logs` | Show recent service logs |
| `ga down` | Stop services, preserving data |
| `ga backup DIRECTORY` | Export database metadata, artifact bytes and runtime snapshots |
| `ga cleanup --delete-data` | Explicitly delete this project's v2 volumes |

Runtime files and locked dependencies are declared once. No hand-written NDJSON or container paths are needed for the managed local workflow. [Backend setup](./backend.md) documents custom runtimes, volumes and recovery.
