# Replay and storage

All seed measurements are retained. Full simulation traces are generated for baselines and selected replays only. Request a replay with `client.replay(studyId, decisions)`, wait with `waitJob`, and retrieve its datasets with `client.datasets(job.id)`.

The model's dataset hook returns a directory, manifest key and run hash. The SDK uploads each resource into the companion's artifact store, then registers a dataset linking those resource keys to artifacts. Retrieve bytes below `client.datasetUrl(dataset.id)`.

Replay rendering belongs to the consuming application. Supply `onReplay` when mounting the inspector; without a viewer, it still exposes dataset manifests and measurements.

The grabm neighborhood example includes a local helper in `examples/neighborhood/src/browser.ts`:

```js
import { openGrabmReplay } from "./dist/browser.js";
const source = await openGrabmReplay(client.datasetUrl(dataset.id), dataset);
console.log(source.summary);
// Use source with grabm's playback APIs; dispose when finished.
source.dispose();
```

The original manifest and resource paths remain intact so grabm's public dataset reader can reopen the simulation after restart. Search-only candidates show replay unavailable until requested. Final candidates remain eligible for later replay generation.

Storage grows with every retained measurement and with selected trace size. Back up database metadata together with artifact bytes and runtime snapshots. A metadata export is not a copy of dataset bytes. The companion's existing artifact storage supports local files and S3 deployments; use the configured store consistently across restarts.
