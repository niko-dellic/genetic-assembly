# Study service HTTP API

The supported service contract is `/v2`. The former `/v1` scene and generic adapter routes have been removed. `/health` reports service health. Models are trusted code and must be prepared before service execution.

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
