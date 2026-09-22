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
