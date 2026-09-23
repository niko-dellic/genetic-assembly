# HTTP API

Use the companion's base URL, normally `http://127.0.0.1:3001`. JSON requests use `Content-Type: application/json`. If configured, send `Authorization: Bearer <token>`. Health checks are available at `GET /health`.

| Method and route | Request / response |
| --- | --- |
| `POST /v1/scenes` | Multipart `glb` and JSON `manifest`; returns scene revision |
| `POST /v1/evaluators` | `{ source, manifest, limits? }`; returns evaluator revision |
| `POST /v1/artifacts` | Raw bytes and content type; returns ID, hash, key, media type, byte length |
| `GET /v1/artifacts/{id}` | Artifact bytes |
| `POST /v1/problems` | `{ bundle }`; returns problem revision |
| `POST /v1/adapters` | `{ launch }`; returns adapter revision |
| `POST /v1/runs` | `{ problem_revision_id, adapter_revision_id, config }` or `{ scene_revision_id, evaluator_revision_id, config }`; returns run status |
| `GET /v1/runs/{id}` | Run status, configuration, progress, timestamps, and possible error |
| `GET /v1/runs/{id}/events` | Server-sent events; reconnect with `Last-Event-ID` |
| `GET /v1/runs/{id}/results` | Final ordered Pareto members and materializations or patches |
| `GET /v1/runs/{id}/analytics` | Objective/lever/constraint metadata, candidates, and generation history |
| `POST /v1/runs/{id}/cancel` | Requests cooperative cancellation and returns status |

Revision responses contain `id` and `content_hash`. The [client types](./api-reference/client/index.md) describe generic request and response shapes; [Three.js types](./api-reference/three/index.md) describe scene-specific shapes. Supply one revision pair, not both.

The service validates dimensions, finite values, and immutable revision compatibility. Non-success responses must be handled before reading expected result shapes. The TypeScript clients raise `GeneticAssemblyApiError` with status and response body for ordinary request failures; stream failures can raise a regular error.

See [run lifecycle](./runs.md) for terminal states and recovery, and [adapter protocol](./adapter-protocol.md) for subprocess messages. HTTP submission and adapter NDJSON are separate interfaces.

## Study workflow API (v2)

The SDK wraps these routes. Study preparation registers a serializable specification and immutable runtime; history pages contain up to 50 records and a `nextOffset`.

- `/v2/studies`
- `/v2/studies/{id}`
- `/v2/studies/{id}/runs`
- `/v2/studies/{id}/jobs`
- `/v2/runs/{id}`
- `/v2/runs/{id}/cancel`
- `/v2/runs/{id}/analytics`
- `/v2/runs/{id}/results`
- `/v2/runs/{id}/export`
- `/v2/history/{id}`
- `/v2/evaluations`
- `/v2/cache/{key}`
- `/v2/datasets`
- `/v2/datasets/{id}/resources/{*key}`
- `/v2/jobs/{id}`
- `/v2/jobs/{id}/cancel`
- `/v2/artifacts`
- `/v2/artifacts/{id}`
- `/`
- `/inspector.js`

- `/grabm.js`: optional recorded graph/timeline viewer served with the inspector.

### Study operations

| Method and path | Request / response |
|---|---|
| `POST /v2/studies` | `{spec, runtime, bundle}`; SDK preparation compiles the bundle and returns the immutable revision |
| `GET /v2/studies` | Paginated revisions; `offset` defaults to zero |
| `GET /v2/studies/{id}` | Specification, runtime identity and creation time |
| `POST /v2/studies/{id}/runs` | Solver configuration; returns run status with ID |
| `GET /v2/studies/{id}/runs` | Paginated experiment statuses |
| `GET /v2/runs/{id}` | Current status, configuration, generation and error |
| `POST /v2/runs/{id}/cancel` | Request cancellation; returns updated status |
| `GET /v2/runs/{id}/results` | Separate `search` and `validated` results |
| `GET /v2/runs/{id}/analytics` | Generation summaries and original search analytics |
| `GET /v2/runs/{id}/export` | Study provenance, results, seed evaluations and dataset references |
| `GET /v2/history/{id}` | Owner history; filters `phase`, `status`, `candidateId`, and `offset` |
| `POST /v2/evaluations` | Shared evaluation schema; rejects changed identities or successful measurements on retry |
| `GET /v2/cache/{key}` | Matching successful record, or `null` |
| `POST /v2/studies/{id}/jobs` | `{kind:'baseline'}` or `{kind:'replay',decisions}`; returns durable job |
| `GET /v2/studies/{id}/jobs` | Paginated baseline and replay jobs |
| `GET /v2/jobs/{id}` | Job status, request, result and error |
| `POST /v2/jobs/{id}/cancel` | Cancel queued/running job |
| `POST /v2/artifacts` | Raw bytes; returns content-addressed artifact reference |
| `GET /v2/artifacts/{id}` | Artifact bytes |
| `POST /v2/datasets` | Dataset reference mapping safe resource paths to artifact IDs |
| `GET /v2/datasets?ownerId=...` | Retained datasets for a run or job |
| `GET /v2/datasets/{id}/resources/{key}` | Original dataset resource bytes |

Paginated responses contain `items` and `nextOffset`; stop at `null`. Results for a running experiment return a conflict response until available. Error responses carry a message and non-success HTTP status. The SDK raises `ApiError` with status and response body.
