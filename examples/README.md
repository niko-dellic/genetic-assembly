# Optimization examples

Application-specific code belongs here, outside the distributable library packages.

- `numerical/study.mjs`: minimal named decisions and competing objectives.
- `neighborhood/`: grabm simulation, bounded graph choices, measurements and replay. This is a private example project, not a supported `@genetic-assembly/grabm` package.
- `recorded/`: Pareto and convergence visualization of a reproducible recording.
- `ExamplesDashboard.vue`: browser dashboard, served at `/docs/examples`.

From the repository root:

```sh
npm run setup
npm run examples:install
npm run examples:dev
```

Open `/docs/examples`. Run `npm run examples:test` for graph and model tests. For Node/CLI instructions see `neighborhood/README.md`. The Python protocol recipe remains in `examples/python/`.
