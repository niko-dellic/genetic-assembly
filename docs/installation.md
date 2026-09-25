# Install into another project

Use Node 22.12 or later for local execution. Docker with Compose is optional for the durable companion. You do not need Rust or a Genetic Assembly checkout in the consuming project. The CLI tarball includes the backend build recipe and source. Service setup builds a local container and needs network access to download build dependencies. Local runs use the packaged WASM binary immediately.

From the Genetic Assembly development checkout, run `npm run setup` and `npm run pack`. The versioned packages and integrity manifest appear in `artifacts/`.

In your application directory:

```sh
npm init -y
npm install /path/to/artifacts/genetic-assembly-sdk-0.5.0.tgz /path/to/artifacts/genetic-assembly-cli-0.5.0.tgz
npx ga init
npm run ga:check
```

Install coordinated tarballs together so npm resolves their internal dependencies locally. Keep `package-lock.json`. Use tarballs rather than directory links: runtime preparation vendors the archives and installs their locked dependencies inside Linux.

The [grabm example](./grabm.md) lives in `examples/neighborhood/` and installs its simulation dependencies separately. It is not part of the library tarballs.

Add `.genetic-assembly/` to your application's ignore file. Commit the study, runtime configuration, and lockfile. See [backend setup](./backend.md) for storage ownership and [first baseline](./quickstart.md) for the complete workflow.
