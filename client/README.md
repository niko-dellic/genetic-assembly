# @genetic-assembly/three

Optional scene export and explicit candidate previews for study-based optimization.

```sh
npm install /path/to/artifacts/genetic-assembly-three-0.5.0.tgz three
```

Use `@genetic-assembly/sdk` to define and run a study. `previewDecisions(scene, decisions, bindings)` maps its named decisions to scene properties and returns a `CandidatePreview` with `revert()`. Nothing applies a design to your application automatically.

`exportScene` produces a GLB artifact. Referenced objects need stable, unique `userData.gaId` values. Bindings support transforms, visibility, numeric material properties and numeric user data.

The former scene-upload HTTP client has been removed. [Three.js guide](https://genetic-assembly.vercel.app/docs/three.html). npm publication remains deferred.
