# @genetic-assembly/three

Three.js integration for the Genetic Assembly local NSGA-II companion.

```bash
npm install @genetic-assembly/three three
```

The package provides:

- `exportScene` for validated binary GLB export.
- `GeneticAssemblyClient` for scene, evaluator, run, SSE, result, and analytics APIs.
- `CandidatePreview` for applying and reverting returned scene patches.
- Typed scene manifests, levers, objectives, constraints, and results.

Every referenced object needs a stable unique `userData.gaId`. V1 supports static transform, visibility, numeric material, and numeric `userData` levers.

See the [Three.js integration section](https://github.com/niko-dellic/genetic-assembly/blob/main/docs/integrating-another-repository.md#12-threejs-projects).
