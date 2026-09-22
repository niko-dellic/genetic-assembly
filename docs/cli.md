# CLI commands

Install the CLI tarball as a development dependency and use `npx ga <command>` from your consumer repository.

| Command | Behavior |
| --- | --- |
| `init` | Creates `.genetic-assembly` problem, adapter, environment, and Compose files; preserves existing files |
| `up` | Starts Postgres and the companion and waits for health checks |
| `down` | Stops the stack while retaining named volumes |
| `doctor` | Prints Docker availability, companion health, and checks scaffold files |
| `test-adapter` | Exercises initialize/evaluate/shutdown on the scaffold's `adapter.mjs` |
| `help` | Prints command usage |

`test-adapter` is a scaffold smoke check, not a full test of every custom launch configuration. Use `runConformanceSuite` for SDK adapters and domain tests for your model. `doctor` prints service failures; inspect the output rather than relying only on its exit status.

## Environment

Set `GA_IMAGE` to your local or released companion image. `.genetic-assembly/.env` sets `PROJECT_ROOT`, `GA_SERVER_PORT`, and `GA_POSTGRES_PORT`. `GA_SERVER_URL` selects the URL checked by `doctor`.

Container launch records use `/workspace` paths; native launches use host paths. If ports are occupied, change them in the environment file and use the matching base URL in the client.
