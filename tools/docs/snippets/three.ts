import { Scene, Mesh, BoxGeometry, MeshStandardMaterial } from "three";
import { previewDecisions } from "@genetic-assembly/three";
import { Optimizer, defineStudy } from "@genetic-assembly/sdk";
const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
mesh.userData.gaId = "box";
scene.add(mesh);
const study = defineStudy({
  name: "Place a box",
  version: "1",
  inputs: { target: 4 },
  decisions: { x: { kind: "real", lower: -5, upper: 5, baseline: 0 } },
  objectives: { distance: { metric: "distance", direction: "minimize" } },
  evaluate: ({ x }) => ({ metrics: { distance: Math.abs(Number(x) - 4) } }),
});
const optimizer = new Optimizer();
try {
  const run = await optimizer.run(study, {
    populationSize: 12,
    generations: 4,
    seed: 42,
  });
  await run.wait();
  const chosen = (await run.results()).validatedFront[0];
  if (chosen) {
    const preview = previewDecisions(scene, chosen.decisions, [
      {
        decision: "x",
        target: { type: "position", object_id: "box", axis: "x" },
      },
    ]);
    preview.revert();
  }
} finally {
  optimizer.dispose();
}
