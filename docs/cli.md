# CLI commands

Run commands through the `ga:*` npm scripts in the consuming project. Local execution is the default. Set `execution: "service"` in `ga.config.json` or add `--service` to connect to the companion.

| Command                                                                            | Result                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ga init`                                                                          | Create study and runtime configuration, preserving existing files                                 |
| `ga check`                                                                         | Evaluate the configured baseline twice, check named metrics and repeatability; nonzero on failure |
| `ga up`                                                                            | Snapshot, build, start and register the study                                                     |
| `ga baseline`                                                                      | Evaluate the baseline in memory; add `--export PATH` to save                                      |
| `ga run [--population N] [--generations N] [--seed N] [--inspect] [--export PATH]` | Baseline, search and finalist validation; optional live inspector and explicit export             |
| `ga inspect [PATH]`                                                                | Open an archive read-only, or a local live study; service mode opens the companion                |
| `ga status`                                                                        | Query health, revisions, runs and jobs                                                            |
| `ga logs`                                                                          | Show recent service logs                                                                          |
| `ga down`                                                                          | Stop services, preserving data                                                                    |
| `ga backup DIRECTORY`                                                              | Export database metadata, artifact bytes and runtime snapshots                                    |
| `ga cleanup --delete-data`                                                         | Explicitly delete this project's v4 volumes                                                       |

Runtime files and locked dependencies are declared once. No hand-written NDJSON or container paths are needed for the managed local workflow. [Backend setup](./backend.md) documents custom runtimes, volumes and recovery.
