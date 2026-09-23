# @genetic-assembly/cli

Managed local optimization studies for consuming repositories. Requires Node 22.12+. Docker with Compose is optional for durable service execution. The archive includes the companion build recipe and Rust sources; you do not need a checkout or host Rust.

Install the coordinated SDK and CLI tarballs together, then run:

```sh
npx ga init
npm run ga:check
npm run ga:baseline
npm run ga:run -- --export study.ga.json
npm run ga:inspect -- study.ga.json
```

`ga init` adds the `ga:*` npm scripts above and preserves existing scripts with the same names. Pass command options after `--`, for example `npm run ga:run -- --population 12`.

`ga init --template grabm` creates the optional neighborhood example. Install `@genetic-assembly/grabm` and grabm's public tarball first.

`ga.config.json` declares your study entry, snapshot files, project name and local port. Runtime dependencies come from the lockfile. Complete package assets and subprocess entry points survive installation.

Use `ga status`, `ga logs`, `ga down`, and `ga backup DIRECTORY` for service management. `ga cleanup --delete-data` explicitly removes this project's v4 volumes. Previous development data is left intact.

[Study guide](https://genetic-assembly.vercel.app/docs/quickstart.html) · [Runtime and storage](https://genetic-assembly.vercel.app/docs/backend.html)

npm publication remains deferred.
