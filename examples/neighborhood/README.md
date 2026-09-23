# grabm neighborhood example

This private example shows how an application can use `@genetic-assembly/sdk`. It is not a published integration package. Its `src/` folder owns graph decisions, constraints, measurement mapping, simulation execution and replay; the optimizer has no grabm dependency.

From the repository root after `npm run setup`:

```sh
npm run examples:install
npm run examples:build
npm --prefix examples/neighborhood run check
npm --prefix examples/neighborhood run baseline
npm --prefix examples/neighborhood run run -- --population 8 --generations 2 --export neighborhood.ga.json
```

The browser dashboard at `/docs/examples` uses the same `study.mjs` and adds a grabm-specific replay callback to the generic inspector. `ga inspect neighborhood.ga.json` displays generic history and dataset manifests; use the example's browser viewer for grabm playback.

To adapt this outside the repository, copy `study.mjs`, `src/`, and `tsconfig.json` into your project. Install the SDK and CLI tarballs and grabm's public package, compile the example with TypeScript, and run `ga init` to add runtime configuration and npm scripts (the existing study is preserved). For service execution, include `study.mjs` and `dist` in the configured snapshot files. Keep grabm's full installed package, including `dist/node/child.js`.

The model keeps eight residents and authored shopping demand fixed. Search seeds are 42/43, validation seeds 142/143. Goals are fulfillment, accessibility coverage and an explicit design-cost proxy. The 15-minute accessibility coverage is constant in this small geometry. Graph repair, valid endpoints, connectivity and geometry rules are example code to adapt to your own application.
