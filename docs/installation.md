# Installation

## Build local tarballs

Use Node.js 20 or newer for packages; use Node.js 22.12 or newer for the documentation toolchain. Docker is needed to run the companion. A local Rust build requires Rust 1.89 or newer.

From the Genetic Assembly checkout:

```sh
npm --prefix headless-client ci
npm --prefix adapter-sdk ci
npm --prefix cli ci
npm --prefix client ci
npm --prefix visualizations ci
npm run pack
npm run pack:check
```

`artifacts/` contains five versioned tarballs and a manifest with integrity hashes. No npm publication is required.

In your own repository, replace `/path/to/genetic-assembly` with the checkout path:

```sh
npm init -y
npm pkg set type=module
npm install /path/to/genetic-assembly/artifacts/genetic-assembly-client-0.2.1.tgz
npm install /path/to/genetic-assembly/artifacts/genetic-assembly-adapter-sdk-0.2.1.tgz
npm install --save-dev /path/to/genetic-assembly/artifacts/genetic-assembly-cli-0.2.1.tgz
```

Only install the optional packages you use:

```sh
npm install /path/to/genetic-assembly/artifacts/genetic-assembly-three-0.2.1.tgz three
npm install /path/to/genetic-assembly/artifacts/genetic-assembly-visualizations-0.2.1.tgz three
```

The headless client has no rendering dependencies. The adapter SDK and CLI target Node. Three.js integration and chart rendering target browsers. Packages use ECMAScript modules and include declarations. Consumer dependencies still need to be installed; the tarballs are not an offline copy of the npm registry.

## Build the companion locally

Until a container release is published, build the image from the checkout:

```sh
docker build -t genetic-assembly:0.2.1 /path/to/genetic-assembly
```

In the consuming repository:

```sh
npx ga init
npx ga test-adapter
GA_IMAGE=genetic-assembly:0.2.1 npx ga up
npx ga doctor
```

For a persistent image selection, add `GA_IMAGE=genetic-assembly:0.2.1` to `.genetic-assembly/.env`. The default registry image is intended for coordinated releases; local development should explicitly select the locally built image.

The CLI mounts the consumer repository read-only at `/workspace`. Its sample adapter needs only Node. Adapters with npm dependencies should be bundled or use container-compatible dependencies. See [the first optimization](./quickstart.md).

## Future npm releases

Registry publication is deferred. Once a release is available, the equivalent packages can be installed by name at a matching version. Do not depend on an unpublished registry version.

## Develop this documentation

```sh
npm run docs:install
npm run docs:dev
```

The site runs at `http://127.0.0.1:4176`. Use `npm run docs:build` for static output.
