# @genetic-assembly/cli

Managed local optimization studies for consuming repositories. Requires Node 22.12+ and Docker with Compose. The archive includes the companion build recipe and Rust sources; you do not need a checkout or host Rust.

Install the coordinated SDK and CLI tarballs together, then run:

```sh
npx ga init
npx ga check
npx ga up
npx ga baseline
npx ga run
npx ga inspect
```

`ga init --template grabm` creates the optional neighborhood example. Install `@genetic-assembly/grabm` and grabm's public tarball first.

`ga.config.json` declares your study entry, snapshot files, project name and local port. Runtime dependencies come from the lockfile. Complete package assets and subprocess entry points survive installation.

Use `ga status`, `ga logs`, `ga down`, and `ga backup DIRECTORY` for service management. `ga cleanup --delete-data` explicitly removes this project's v2 volumes. Previous development data is left intact.

[Study guide](https://genetic-assembly-docs.vercel.app/quickstart.html) · [Runtime and storage](https://genetic-assembly-docs.vercel.app/backend.html)

npm publication remains deferred.
