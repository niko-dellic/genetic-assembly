import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { Material, Object3D, Scene } from "three";
import type {
  SceneManifest, ScenePatch, SceneDecisionBinding,
} from "./types.js";
export * from "./types.js";

/** Exports the supported scene as binary GLB with a versioned manifest. Stable userData.gaId values identify referenced objects. */
export async function exportScene(scene: Scene, manifest: SceneManifest): Promise<{ glb: Blob; manifest: SceneManifest }> {
  const ids = new Map<string, Object3D>();
  scene.traverse((object) => {
    const id = object.userData.gaId;
    if (id === undefined) return;
    if (typeof id !== "string" || id.length === 0) throw new Error("userData.gaId must be a non-empty string");
    if (ids.has(id)) throw new Error(`Duplicate userData.gaId: ${id}`);
    ids.set(id, object);
  });
  for (const lever of manifest.levers) {
    const object = ids.get(lever.target.object_id);
    if (!object) throw new Error(`Lever ${lever.id} references missing userData.gaId ${lever.target.object_id}`);
    if (lever.target.type === "material") {
      const material = (object as Object3D & { material?: Material | Material[] }).material;
      if (!material || Array.isArray(material)) throw new Error(`Material lever ${lever.id} requires one material`);
    }
  }
  // Export the immutable scene model, not viewer-only cameras and lights. The
  // clone shares heavy geometry/material buffers while giving us a removable
  // object hierarchy without mutating the live Three.js scene.
  const exportRoot = scene.clone(true);
  const viewerObjects: Object3D[] = [];
  exportRoot.traverse((object) => {
    const flags = object as Object3D & { isCamera?: boolean; isLight?: boolean };
    if (flags.isCamera || flags.isLight || object.userData.gaViewerOnly === true) viewerObjects.push(object);
  });
  for (const object of viewerObjects) object.removeFromParent();
  const output = await new GLTFExporter().parseAsync(exportRoot, { binary: true, onlyVisible: false });
  if (!(output instanceof ArrayBuffer)) throw new Error("GLTFExporter did not produce a binary GLB");
  return { glb: new Blob([output], { type: "model/gltf-binary" }), manifest: { ...manifest, schema_version: 1 } };
}

/** Applies candidate patches to a Three.js scene and retains original values for revert(). */
export class CandidatePreview {
  private readonly original = new Map<string, unknown>();
  constructor(private readonly scene: Scene) {}
  /** Applies a retained candidate to the scene. The first original value of each changed property is preserved. */
  apply(patches: ScenePatch[]): void { for (const patch of patches) this.applyPatch(patch); }
  /** Restores properties changed by previews and clears the saved originals. */
  revert(): void {
    for (const [key, value] of this.original) this.write(key, value);
    this.original.clear();
  }
  private applyPatch(patch: ScenePatch): void {
    const key = patchKey(patch);
    if (!this.original.has(key)) this.original.set(key, this.read(key));
    this.write(key, patch.value);
  }
  private read(key: string): unknown {
    const [id, type, property] = JSON.parse(key) as [string, string, string]; const object = findObject(this.scene, id);
    if (type === "visibility") return object.visible;
    if (type === "position" || type === "rotation" || type === "scale") return object[type][property as AxisName];
    if (type === "material") return (object as Object3D & { material: Material }).material[property as keyof Material];
    return readPath(object.userData, property);
  }
  private write(key: string, value: unknown): void {
    const [id, type, property] = JSON.parse(key) as [string, string, string]; const object = findObject(this.scene, id);
    if (type === "visibility") object.visible = Boolean(value);
    else if (type === "position" || type === "rotation" || type === "scale") object[type][property as AxisName] = Number(value);
    else if (type === "material") ((object as Object3D & { material: Material }).material as unknown as Record<string, unknown>)[property] = value;
    else writePath(object.userData, property, value);
  }
}

type AxisName = "x" | "y" | "z";
function findObject(scene: Scene, id: string): Object3D {
  let found: Object3D | undefined; scene.traverse((object) => { if (object.userData.gaId === id) found = object; });
  if (!found) throw new Error(`Scene no longer contains ${id}`); return found;
}
function patchKey(patch: ScenePatch): string {
  const target = patch.target;
  if (target.type === "position" || target.type === "rotation" || target.type === "scale") return JSON.stringify([target.object_id, target.type, target.axis]);
  if (target.type === "visibility") return JSON.stringify([target.object_id,"visibility","value"]);
  if (target.type === "material") return JSON.stringify([target.object_id,"material",target.property]);
  return JSON.stringify([target.object_id,"user_data",target.path]);
}
function readPath(root: Record<string, unknown>, path: string): unknown { return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], root); }
function writePath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split("."); let cursor = root;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  cursor[parts[parts.length - 1]] = value;
}

/** Explicitly preview named study decisions in an application's scene. */
export function previewDecisions(scene: Scene, decisions: Record<string, number | boolean | string>, bindings: SceneDecisionBinding[]): CandidatePreview {
  const patches = bindings.map(({decision, target}) => {
    const value = decisions[decision];
    if (value === undefined) throw Error(`Missing decision ${decision}`);
    if (target.type !== 'visibility' && (typeof value !== 'number' || !Number.isFinite(value))) throw Error(`Decision ${decision} must be numeric for this scene property`);
    if (target.type === 'visibility' && typeof value !== 'boolean') throw Error(`Decision ${decision} must be boolean`);
    return {lever_id: decision, target, value: Number(value)};
  });
  const preview = new CandidatePreview(scene);
  try { preview.apply(patches); } catch (error) { preview.revert(); throw error; }
  return preview;
}
