# Install into another project

Use Node 22.12 or later and Docker with Compose. You do not need Rust or a Genetic Assembly checkout in the consuming project. The CLI tarball includes the backend build recipe and source. Its first setup builds a local container and needs network access to download build dependencies.

From the Genetic Assembly development checkout, run `npm run setup` and `npm run pack`. The versioned packages and integrity manifest appear in `artifacts/`.

In your application directory:

```sh
npm init -y
npm install /path/to/artifacts/genetic-assembly-sdk-0.3.0.tgz /path/to/artifacts/genetic-assembly-cli-0.3.0.tgz
npx ga init
npx ga check
```

Install coordinated tarballs together so npm resolves their internal dependencies locally. Keep `package-lock.json`. Use tarballs rather than directory links: runtime preparation vendors the archives and installs their locked dependencies inside Linux.

For grabm, also install its public package tarball and `genetic-assembly-grabm-0.3.0.tgz`, then use `ga init --template grabm` in a fresh directory. The optional integration uses grabm's public APIs and includes no solver-specific changes to grabm.

Add `.genetic-assembly/` to your application's ignore file. Commit the study, runtime configuration, and lockfile. See [backend setup](./backend.md) for storage ownership and [first baseline](./quickstart.md) for the complete workflow.
