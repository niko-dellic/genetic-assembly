# First optimization

Find the trade-off between two target positions. We minimize both `x²` and `(1−x)²` for `0 ≤ x ≤ 1`; moving toward one target moves away from the other.

## 1. Install and start

Follow [installation](./installation.md) to install the client, adapter SDK, and CLI tarballs, build the local companion image, and run `ga init` and `ga up` in your project.

## 2. Implement the model

Save this as `adapter-source.mjs` in the consuming repository:

<<< ../tools/docs/snippets/adapter.mjs{js}

Bundle it so the container can execute the model without installing your project's dependencies:

```sh
npm install --save-dev esbuild typescript tsx
npx esbuild adapter-source.mjs --bundle --platform=node --format=esm --outfile=adapter.mjs
```

The resulting file is visible inside the companion as `/workspace/adapter.mjs`. Standard output is reserved for the protocol; write diagnostics to standard error.

## 3. Run the search

Save the following as `run.ts`:

<<< ../tools/docs/snippets/quickstart.ts

```sh
npx tsx run.ts
```

This registers the problem and adapter, searches with a fixed seed, streams progress, and retrieves results. The starter files from `ga init` remain available, but this example registers its own two-objective problem and adapter.

## 4. Interpret the front

Each member contains genes, objective values, constraint values, and the adapter's materialization `{ x }`. Multiple retained candidates represent different trade-offs. A seed of 42 reproduces the same search given the same model, problem, configuration, and runtime semantics.

[View a recorded run](./examples.md), then [implement your own model](./integrating-another-repository.md).

## 5. Stop the companion

```sh
npx ga down
```

Stored runs remain in Docker volumes. Stopping the service does not delete them.
