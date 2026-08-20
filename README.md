# Genetic Assembly

Genetic Assembly is a native Rust NSGA-II local companion for project-authored optimization models. Rust owns deterministic population evolution, constraint domination, durable jobs, checkpoints, and analytics. A project may use built-in Three.js/QuickJS evaluation or attach any trusted local runtime through the versioned NDJSON adapter protocol.

NSGA-III and browser-hosted solving are intentionally not part of v1. The implementation concentrates on making one canonical NSGA-II path deterministic, resumable, and suitable for local or server deployment.

## Architecture

```mermaid
flowchart LR
    UI["Project client"] -->|"problem + artifacts"| API["Rust companion API"]
    UI -->|"adapter revision + run config"| API
    API --> PG["Postgres metadata and leases"]
    API --> OBJ["Local or S3 artifacts"]
    API --> RUN["Single-active-run executor"]
    RUN --> BUILTIN["Built-in Rust/Rayon evaluator"]
    RUN --> ADAPTER["Project NDJSON adapter"]
    BUILTIN --> GEO["Arc<SceneGeometry> + QuickJS"]
    ADAPTER --> MODEL["Node/Python/native project model"]
    RUN -->|"summaries + checkpoints"| PG
    RUN -->|"compressed artifacts"| OBJ
    API -->|"SSE + Pareto patches"| UI
```

External adapters own their internal concurrency, so Rust sends one deterministic indexed batch rather than wrapping an already-parallel model in another Rayon pool. Native models can still share immutable state through `Arc`; cross-process JavaScript state is not implicitly shared.

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
- A typed TypeScript client with GLB export, event subscription, analytics/result retrieval, candidate preview, and revert.
- A React analytics workspace with linked Pareto, parallel-coordinate, diamond-fitness, lever, constraint, and convergence views.
- Selectable scene/evaluator examples, including a three-anchor facility-location benchmark with a genuine three-objective Pareto surface.
- Framework-neutral D3/Three.js renderers in `@genetic-assembly/visualizations`, each with `update`, `resize`, and `destroy` lifecycle methods.
- Generic problem, artifact, and adapter revisions alongside the Three.js compatibility API.
- Versioned `genetic-assembly-adapter-v1` subprocess supervision with timeouts, bounded retries, process-tree cancellation, domain operators, validation, and materialization.
- `@genetic-assembly/client`, `@genetic-assembly/adapter-sdk`, and a `ga` CLI for new-project integration.

## Documentation

- [General usage guide](docs/usage-guide.md) — start and stop the stack, run problems, inspect results, and troubleshoot the local environment.
- [Integrating another repository](docs/integrating-another-repository.md) — define a problem, implement an adapter, register revisions, stream a run, and consume results.
- [Adapter protocol reference](docs/adapter-protocol.md) — NDJSON lifecycle, determinism, recovery, and payload boundaries.
- [Problem bundle schema](adapter-sdk/schemas/problem-bundle.schema.json), [adapter launch schema](adapter-sdk/schemas/adapter-launch.schema.json), and [protocol schema](adapter-sdk/schemas/adapter-protocol.schema.json).

## Quick start

Prerequisites: Docker, Node.js 20+, and optionally Rust 1.89+ for native development.

```bash
npm run up
```

`npm run up` installs missing or stale workspace dependencies, builds the executable reference adapter, starts Postgres plus the Rust companion, waits for both services, and then starts the frontend. Open the URL it prints. The demo prefers `http://127.0.0.1:3333`; if port 3333 is busy, startup selects the next available port. The API is bound to `http://127.0.0.1:3001` on the host. Postgres migrations run automatically when the server starts; artifacts are written to a named Docker volume.

Pressing Ctrl+C stops the frontend but leaves the durable backend running. The root lifecycle commands are:

```bash
npm run up:backend # backend only
npm run status     # inspect services
npm run logs       # follow backend logs
npm run down       # stop Postgres and the companion
```

## Use as a local companion

A project does not need a Rust toolchain. Scaffold its trusted local adapter with the CLI:

```bash
npx @genetic-assembly/cli init
npx @genetic-assembly/cli test-adapter
npx @genetic-assembly/cli up
```

The scaffold creates `.genetic-assembly/problem.json`, `adapter.json`, an NDJSON adapter, and a Compose definition. The project registers immutable problem and adapter revisions, starts a run through `@genetic-assembly/client`, subscribes to SSE progress, and interprets the adapter's final materializations. The declared `adapter_version` must exactly match the version reported during initialization, preventing a checkpoint from resuming against changed project code.

Two operator modes are supported. In `builtin` mode Rust performs standard real/integer/binary variation and the adapter evaluates batches. In `adapter` mode Rust retains NSGA-II selection while the project implements seeded population construction, crossover/mutation, and repair. Exact 64-bit operation seeds cross the JavaScript protocol as decimal strings.

See [the adapter protocol](docs/adapter-protocol.md) and the [non-spatial delivery-network reference](examples/reference-adapter/problem.json).

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
} from "@genetic-assembly/three";

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
| `POST` | `/v1/artifacts` | Upload a content-addressed project artifact. |
| `GET` | `/v1/artifacts/{id}` | Download a registered artifact. |
| `POST` | `/v1/problems` | Validate and version a generic problem bundle. |
| `POST` | `/v1/adapters` | Version a trusted local adapter launch definition. |
| `POST` | `/v1/runs` | Queue a run against an exact scene/evaluator or problem/adapter revision pair. |
| `GET` | `/v1/runs/{id}` | Read status, generation, timing, and errors. |
| `GET` | `/v1/runs/{id}/events` | Stream bounded status, generation, and checkpoint events over SSE. |
| `GET` | `/v1/runs/{id}/results` | Read the final ordered Pareto front and project materializations or Three.js patches. |
| `GET` | `/v1/runs/{id}/analytics` | Read objective/lever/constraint schemas, final candidates, and ordered full-population generation summaries. |
| `POST` | `/v1/runs/{id}/cancel` | Request cooperative cancellation between evaluation batches. |

## Development

```bash
npm run test
npm run build
cargo clippy --workspace --all-targets -- -D warnings
```

The Rust workspace is split into `genetic-assembly-core`, `genetic-assembly-adapter`, `genetic-assembly-scene`, `genetic-assembly-script`, and `genetic-assembly-server`. `headless-client` is the framework-free client, `adapter-sdk` contains protocol helpers and schemas, `client` is the optional `@genetic-assembly/three` integration, `visualizations` contains framework-neutral renderers, and `demo` is the React server-backed integration workspace.

Current trust boundary: evaluator scripts are trusted project-authored code. QuickJS removes ambient filesystem, network, imports, wall-clock time, and randomness and enforces runtime limits, but it is not a hostile multi-tenant sandbox. Run the service on localhost or behind authentication for trusted teams.

## Deferred

NSGA-III, distributed evaluation of one run, browser/WASM solving, mesh deformation, exact triangle-level collision, hostile multi-tenant adapter isolation, and shared-memory JavaScript model compilation remain later milestones. WASM is not required for local companion use.

## License

MIT
