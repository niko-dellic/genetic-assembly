# Genetic Assembly

Genetic Assembly is a native Rust NSGA-II service for optimizing parameterized Three.js scenes. The browser exports an immutable GLB and a lever manifest; a Rust process evaluates compact candidate vectors in parallel against one shared geometry store, checkpoints the run, and streams progress and Pareto results back to the page.

NSGA-III and browser-hosted solving are intentionally not part of v1. The implementation concentrates on making one canonical NSGA-II path deterministic, resumable, and suitable for local or server deployment.

## Architecture

```mermaid
flowchart LR
    UI["Three.js client"] -->|"GLB + manifest"| API["Rust HTTP API"]
    UI -->|"evaluator + run config"| API
    API --> PG["Postgres metadata and leases"]
    API --> OBJ["Local or S3 artifacts"]
    API --> RUN["One native run process"]
    RUN --> GEO["Arc<SceneGeometry>"]
    RUN --> POOL["Private Rayon pool"]
    POOL --> QJS["QuickJS runtime per thread"]
    QJS --> GEO
    RUN -->|"summaries + checkpoints"| PG
    RUN -->|"compressed artifacts"| OBJ
    API -->|"SSE + Pareto patches"| UI
```

The baseline scene and its indexed mesh buffers are loaded once per run. Each candidate is a compact lever vector plus a read-only overlay; evaluation threads share the scene through `Arc` and never mutate it.

## What is implemented

- Canonical generational NSGA-II with `N` parents + `N` offspring environmental selection.
- Deb constraint domination, non-dominated sorting, crowding distance, and stable tie-breaking.
- Real SBX/polynomial mutation, bounded stepped-integer variation, and binary crossover/mutation.
- Seeded deterministic runs, including identical one-thread/multi-thread results and checkpoint resume.
- GLB scene ingestion with stable `userData.gaId` references and immutable geometry.
- Position, rotation, scale, visibility, numeric material, and numeric `userData` levers.
- Bounds, distance, AABB intersection/overlap, surface area, volume, visibility, and metadata metrics.
- Restricted trusted-project JavaScript evaluators in QuickJS with memory, stack, and execution limits.
- Axum APIs, SSE progress, cooperative cancellation, Postgres job leasing, restart recovery, and versioned MessagePack+zstd checkpoints.
- Content-addressed local or S3-compatible artifact storage.
- A typed TypeScript client with GLB export, event subscription, result retrieval, candidate preview, and revert.

## Quick start

Prerequisites: Docker, Node.js 20+, and optionally Rust 1.89+ for native development.

```bash
docker compose up --build
npm run client:install
npm run demo:install
npm run demo:dev
```

Open the URL printed by `npm run demo:dev`. The demo prefers `http://127.0.0.1:3333`; if port 3333 is busy, startup selects the next available port. The API is bound to `http://127.0.0.1:3001` on the host. Postgres migrations run automatically when the server starts; artifacts are written to a named Docker volume.

For native server development, start only Postgres and run the service with Cargo. Compose exposes it on host port 55433 to avoid colliding with a conventional local Postgres installation:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://genetic_assembly:genetic_assembly@127.0.0.1:55433/genetic_assembly \
  cargo run -p genetic-assembly-server
```

The defaults in `.env.example` match this setup. `GA_API_TOKEN` enables one static bearer token. Setting `GA_S3_BUCKET` switches artifact storage from the local path to the S3-compatible backend configured by the standard `AWS_*` environment variables.

## Three.js contract

Every referenced object needs a unique stable ID:

```ts
mesh.userData.gaId = "movable-box";
```

Export and upload through the client:

```ts
import {
  CandidatePreview,
  GeneticAssemblyClient,
  exportScene,
} from "@genetic-assembly/three-client";

const manifest = {
  objects: [{ id: "movable-box", visible: true, numeric_properties: {} }],
  levers: [{
    id: "box-x",
    kind: "real", lower: -5, upper: 5,
    target: { type: "position", object_id: "movable-box", axis: "x" },
  }],
};

const api = new GeneticAssemblyClient({ baseUrl: "http://127.0.0.1:3001" });
const glb = await exportScene(scene, manifest);
const sceneRevision = await api.uploadScene(glb, manifest);
```

Uploaded evaluator modules expose exactly one `evaluate` function:

```js
export function evaluate(ctx) {
  return {
    objectives: [ctx.targetDistance("movable-box", [4, 0, 0])],
    constraints: [ctx.overlapVolume("movable-box", "obstacle")]
  };
}
```

Constraint values `<= 0` are feasible. Objective direction is declared in the evaluator manifest, and maximization is normalized internally. The context exposes read-only levers, object properties/metadata, and the metric catalog—never the mutable Three.js scene.

Supported v1 input is static `Scene`, `Group`, `Mesh`, and triangle `BufferGeometry`. Skinned meshes, morph targets, topology or vertex deformation, dynamic physics, and executable scene objects are rejected or outside the manifest contract.

## HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/v1/scenes` | Upload multipart `glb` and JSON `manifest`; returns an immutable revision. |
| `POST` | `/v1/evaluators` | Validate and version source, objectives, and limits. |
| `POST` | `/v1/runs` | Queue a run against exact scene/evaluator revisions. |
| `GET` | `/v1/runs/{id}` | Read status, generation, timing, and errors. |
| `GET` | `/v1/runs/{id}/events` | Stream bounded status, generation, and checkpoint events over SSE. |
| `GET` | `/v1/runs/{id}/results` | Read the final ordered Pareto front and Three.js patches. |
| `POST` | `/v1/runs/{id}/cancel` | Request cooperative cancellation between evaluation batches. |

## Development

```bash
npm run test
npm run build
cargo clippy --workspace --all-targets -- -D warnings
```

The Rust workspace is split into `genetic-assembly-core`, `genetic-assembly-scene`, `genetic-assembly-script`, and `genetic-assembly-server`. The `client` directory is the publishable TypeScript package; `demo` is a server-backed integration example.

Current trust boundary: evaluator scripts are trusted project-authored code. QuickJS removes ambient filesystem, network, imports, wall-clock time, and randomness and enforces runtime limits, but it is not a hostile multi-tenant sandbox. Run the service on localhost or behind authentication for trusted teams.

## Deferred

NSGA-III, distributed evaluation of one run, browser/WASM solving, mesh deformation, exact triangle-level collision, multi-tenancy, billing, and arbitrary Python/Rust evaluator uploads remain later milestones.

## License

MIT
