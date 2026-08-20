# Three.js server demo

This React workspace exports a live Three.js scene to GLB, versions its evaluator, starts a native Rust NSGA-II run, streams full-population generation analytics, and links candidate selection across the scene and optimization charts.

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

The current-problem card expands into a problem tray before a run begins. It includes the original two-target placement study and a three-anchor facility-location benchmark whose non-collinear distance objectives produce an orbitable three-dimensional Pareto surface. Choosing a problem replaces the Three.js scene, evaluator contract, recommended solver settings, and analytics schema together.

The right pane offers Pareto and parallel-coordinate exploration, pinned diamond/lever/constraint comparison, convergence history, and an on-demand virtualized candidate table. Below 900px it becomes a bottom sheet so the Three.js scene remains bounded and visible.
