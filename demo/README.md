# Three.js server demo

This demo exports a live Three.js scene to GLB, versions its evaluator, starts a native Rust NSGA-II run, streams generation progress, and previews or reverts returned Pareto candidates.

Start the backend from the repository root:

```bash
docker compose up --build
```

Then start Vite:

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. The demo prefers `http://127.0.0.1:3333`; when that port is occupied it selects the next available port. The page expects the API at `http://127.0.0.1:3001`.

The example optimizes the X/Z position of one box against two competing target distances while requiring zero AABB overlap with an obstacle. The solver runs on the server; the browser only exports, subscribes, displays results, and applies patches.
