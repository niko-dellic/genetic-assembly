# Deployment

The default is the [managed local companion](./backend.md). `ga up` binds its API to localhost and keeps Postgres internal. Static documentation hosting does not host an optimization backend.

## Native companion

Build with `cargo build --release -p genetic-assembly-server`, provision Postgres, then set `DATABASE_URL`, `GA_BIND` and `GA_ARTIFACT_ROOT` before launching the binary. Install the model interpreter and dependencies separately. Register immutable runtime paths with `StudyClient.prepare`; they refer to this host.

## Custom Docker runtime

Extend the versioned local image to add interpreters or system libraries. Set `image` in `ga.config.json`. Runtime identity includes the base image ID, declared files and lockfile. Keep model code and data in declared snapshot files; do not rely on a mutable host mount.

The default build disables npm install scripts. Native modules that need build steps must be installed in a compatible custom runtime. Do not assume a Windows or macOS dependency tree can run inside Linux.

## Authentication and storage

Use `GA_API_TOKEN` for a deployed companion and pass the bearer token to `StudyClient`. The local inspector has a connection authentication field. Frontend assets and health are readable without the token; study APIs remain protected. Use an authenticated reverse proxy and TLS when exposing a trusted-team service beyond localhost.

By default artifact bytes live below `GA_ARTIFACT_ROOT`. S3 deployment uses `GA_S3_BUCKET` with the credentials, endpoint and region understood by the server's S3 storage configuration. Preserve the same store and Postgres metadata together. Dataset manifests map resource paths to stored artifacts; moving metadata alone does not move the data.

A database backup plus artifact and snapshot archives is needed for complete recovery. Restore each into a new, empty namespace and test a retained replay before disposing of old data. `ga down` keeps data; `ga cleanup --delete-data` explicitly removes the current managed project's v2 volumes.
