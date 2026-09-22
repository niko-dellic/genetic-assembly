import { Scene, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { GeneticAssemblyClient, exportScene, CandidatePreview, type SceneManifest } from '@genetic-assembly/three';
const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
mesh.userData.gaId = 'box';
scene.add(mesh);
const manifest: SceneManifest = {
  objects: [{ id: 'box', visible: true }],
  levers: [{ id: 'x', kind: 'real', lower: -5, upper: 5,
    target: { type: 'position', object_id: 'box', axis: 'x' } }],
};
const client = new GeneticAssemblyClient('http://127.0.0.1:3001');
const exported = await exportScene(scene, manifest);
const revision = await client.uploadScene(exported.glb, exported.manifest);
const evaluator = await client.createEvaluator(
  'export function evaluate(ctx) { return { objectives: [ctx.targetDistance("box", [4,0,0])], constraints: [] }; }',
  { objectives: [{ name: 'Distance', direction: 'minimize' }] },
);
const run = await client.startRun(revision.id, evaluator.id, { population_size: 32, generations: 12, seed: 42 });
await client.subscribe(run.id, console.log);
const results = await client.getResults(run.id);
const preview = new CandidatePreview(scene);
if (results.members.length) preview.apply(results.members[0]);
preview.revert();
