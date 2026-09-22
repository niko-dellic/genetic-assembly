# Three.js integration

Install the `@genetic-assembly/three` tarball and its `three` peer dependency. Run this integration in the browser with an accessible companion URL.

Assign a stable unique `userData.gaId` to each referenced object, define numeric levers, export the scene, and register a trusted evaluator:

<<< ../tools/docs/snippets/three.ts

`exportScene` returns `{ glb, manifest }`; pass both to `uploadScene`. `GeneticAssemblyClient` accepts a base URL string and optional bearer token. `CandidatePreview` retains original values so `revert()` can undo preview changes.

## Supported scenes

Static scenes, groups, meshes, and triangle buffer geometry support transform, visibility, numeric material, and numeric user-data levers. Skinned meshes, morph targets, vertex deformation, dynamic physics, and topology changes are outside this contract. Viewer-only objects are omitted from export.

## Evaluators

Export exactly one `evaluate(ctx)` function returning finite objective and constraint arrays. The context provides metrics, not a mutable scene. See [every evaluator-context function](./evaluator-context.md) and [the generated Three.js API](./api-reference/three/index.md).
