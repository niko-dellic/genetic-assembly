# Three.js integration

Use the SDK to describe decisions and evaluate their consequences. `@genetic-assembly/three` maps selected named decisions to scene properties for explicit preview. The scene viewer does not need to be the optimization backend.

<<< @/../tools/docs/snippets/three.ts

`previewDecisions` returns a `CandidatePreview`; call `revert()` to restore the original properties. Stable `userData.gaId` identifiers connect bindings to objects. Preview and application of a selected design are explicit application actions. The old scene-upload client has been removed; both local and service optimization use studies.

`exportScene` remains available for producing a GLB artifact with a scene manifest. Store assets through your model's dataset/materialization workflow when needed; no legacy scene HTTP endpoint is required.
