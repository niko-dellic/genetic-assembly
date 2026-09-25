# Study service HTTP API

The supported service contract is `/v3`. The former `/v1` scene and generic adapter routes have been removed. `/health` reports service health. Models are trusted code and must be prepared before service execution.

## Study workflow API (v3)

The SDK wraps these routes. Study preparation registers a serializable specification and immutable runtime; history pages contain up to 50 records and a `nextOffset`.

- `/v3/studies`
- `/v3/studies/{id}`
- `/v3/studies/{id}/runs`
- `/v3/studies/{id}/jobs`
- `/v3/runs/{id}`
- `/v3/runs/{id}/cancel`
- `/v3/runs/{id}/analytics`
- `/v3/runs/{id}/results`
- `/v3/runs/{id}/export`
- `/v3/history/{id}`
- `/v3/operations/{id}/events?after={cursor}`
- `/v3/operations/{id}/generations?offset={offset}`
- `/v3/evaluations`
- `/v3/cache/{key}`
- `/v3/datasets`
- `/v3/datasets/{id}/resources/{*key}`
- `/v3/jobs/{id}`
- `/v3/jobs/{id}/cancel`
- `/v3/artifacts`
- `/v3/artifacts/{id}`
- `/`
- `/inspector.js`

### Study operations

| Method and path                         | Request / response                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /v3/studies`                      | `{spec, runtime, bundle}`; SDK preparation compiles the bundle and returns the immutable revision |
| `GET /v3/studies`                       | Paginated revisions; `offset` defaults to zero                                                    |
| `GET /v3/studies/{id}`                  | Specification, runtime identity and creation time                                                 |
| `POST /v3/studies/{id}/runs`            | Solver configuration; returns run status with ID                                                  |
| `GET /v3/studies/{id}/runs`             | Paginated experiment statuses                                                                     |
| `GET /v3/runs/{id}`                     | Current status, configuration, generation and error                                               |
| `POST /v3/runs/{id}/cancel`             | Request cancellation; returns updated status                                                      |
| `GET /v3/runs/{id}/results`             | `search`, all `validated` finalists, and `validatedFront`                                                         |
| `GET /v3/runs/{id}/analytics`           | Generation summaries and original search analytics                                                |
| `GET /v3/runs/{id}/export`              | Study provenance, results, seed evaluations and dataset references                                |
| `GET /v3/history/{id}`                  | Owner history; filters `phase`, `status`, `candidateId`, and `offset`                             |
| `POST /v3/evaluations`                  | Shared evaluation schema; rejects changed identities or successful measurements on retry          |
| `GET /v3/cache/{key}`                   | Matching successful record, or `null`                                                             |
| `POST /v3/studies/{id}/jobs`            | `{kind:'baseline'}` or `{kind:'replay',decisions}`; returns durable job                           |
| `GET /v3/studies/{id}/jobs`             | Paginated baseline and replay jobs                                                                |
| `GET /v3/jobs/{id}`                     | Job status, request, result and error                                                             |
| `POST /v3/jobs/{id}/cancel`             | Cancel queued/running job                                                                         |
| `POST /v3/artifacts`                    | Raw bytes; returns content-addressed artifact reference                                           |
| `GET /v3/artifacts/{id}`                | Artifact bytes                                                                                    |
| `POST /v3/datasets`                     | Dataset reference mapping safe resource paths to artifact IDs                                     |
| `GET /v3/datasets?ownerId=...`          | Retained datasets for a run or job                                                                |
| `GET /v3/datasets/{id}/resources/{key}` | Original dataset resource bytes                                                                   |

Paginated responses contain `items` and `nextOffset`; stop at `null`. Results for a running experiment return a conflict response until available. Error responses carry a message and non-success HTTP status. The SDK raises `ApiError` with status and response body.

## Ordered observation

`GET /v3/operations/{id}/events?after={cursor}` returns `{items}` with up to 1,000 persisted events after the supplied sequence. Advance the cursor to the last consumed sequence. These responses use event cursors, not `nextOffset`. The SDK exposes them as `events({after, signal})`, polling while execution continues.

`GET /v3/operations/{id}/generations?offset={offset}` returns `{items, nextOffset}` with up to 50 committed generation snapshots. Each snapshot references actual surviving candidate IDs, their ranks and crowding distances, the population front, and a separate cumulative discovered front. Baseline/replay operations have an empty generation history.

Terminal events commit with terminal status. Each generation's snapshot, completion event, and recovery checkpoint commit together. Disconnecting observation leaves durable work running; cancellation is a separate explicit request.
