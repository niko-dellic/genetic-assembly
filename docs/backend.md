# Managed backend

`ga up` packages the project, builds the companion if necessary, and starts Postgres and the companion with Docker Compose. Only the companion port is published, bound to `127.0.0.1`. Postgres is reachable only inside Compose.

```json
{
  "entry": "study.mjs",
  "files": ["study.mjs", "inputs"],
  "project": "my-study",
  "port": 3001
}
```

The runtime snapshots declared files, the package manifest, the lockfile, and local dependency tarballs. Dependencies are installed in Linux. Whole package directories survive installation, including grabm's `child.js`. Each revision runs from a read-only snapshot volume; editing the working project does not alter a running revision.

`files` must include data and dynamically loaded modules. Secrets, directory links, and host `node_modules` cannot be snapshot inputs. Runtime dependencies must be production dependencies. Install scripts are disabled by default; use a custom base image for packages requiring native build steps or system libraries.

## Services and storage

- `ga status`: health, prepared revisions, runs and jobs.
- `ga logs`: recent companion and database logs.
- `ga down`: stop services while retaining data.
- `ga backup ./backup`: export database metadata, artifact bytes and runtime snapshots together.
- `ga cleanup --delete-data`: explicitly remove this project's new data volumes.

Compose uses project name `ga-<project>-v4`, with `database`, `artifacts`, and `ga-<project>-snapshots-v4` volumes. Version 0.4 does not delete previous development data. Stop the old services, inspect their volumes and retain a backup before disposing of them yourself.

## Existing companion and custom runtime

Set `baseUrl` to the companion URL and provide `.genetic-assembly/remote-runtime.json` with the SDK `Runtime` contract: command, args, workingDirectory, identity, and optional environment/timeoutMs. Provision that immutable directory in the remote companion first. Remote runtime paths refer to the companion host, not your laptop.

Set `image` for a custom managed base image containing the companion and your interpreter/system libraries. See [deployment](./deployment.md) and [Python](./python.md).
