import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { Material, Object3D, Scene } from "three";
import type {
  EvaluatorManifest, Nsga2Config, ResultMember, Revision, RunEvent, RunResults, ScriptLimits,
  RunStatus, SceneManifest, ScenePatch,
} from "./types.js";
export * from "./types.js";

export class GeneticAssemblyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "GeneticAssemblyApiError";
  }
}

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
    if (flags.isCamera || flags.isLight) viewerObjects.push(object);
  });
  for (const object of viewerObjects) object.removeFromParent();
  const output = await new GLTFExporter().parseAsync(exportRoot, { binary: true, onlyVisible: false });
  if (!(output instanceof ArrayBuffer)) throw new Error("GLTFExporter did not produce a binary GLB");
  return { glb: new Blob([output], { type: "model/gltf-binary" }), manifest: { ...manifest, schema_version: 1 } };
}

export class GeneticAssemblyClient {
  constructor(public readonly baseUrl = "http://127.0.0.1:3001", private readonly token?: string) {}

  async uploadScene(glb: Blob, manifest: SceneManifest): Promise<Revision> {
    const body = new FormData();
    body.append("glb", glb, "scene.glb");
    body.append("manifest", new Blob([JSON.stringify(manifest)], { type: "application/json" }), "manifest.json");
    return this.request("/v1/scenes", { method: "POST", body });
  }

  createEvaluator(source: string, manifest: EvaluatorManifest, limits?: ScriptLimits): Promise<Revision> {
    return this.request("/v1/evaluators", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, manifest, limits }) });
  }

  startRun(sceneRevisionId: string, evaluatorRevisionId: string, config: Nsga2Config = {}): Promise<RunStatus> {
    return this.request("/v1/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene_revision_id: sceneRevisionId, evaluator_revision_id: evaluatorRevisionId, config }) });
  }

  getRun(id: string): Promise<RunStatus> { return this.request(`/v1/runs/${id}`); }
  getResults(id: string): Promise<RunResults> { return this.request(`/v1/runs/${id}/results`); }
  cancel(id: string): Promise<RunStatus> { return this.request(`/v1/runs/${id}/cancel`, { method: "POST" }); }

  async subscribe(id: string, onEvent: (event: RunEvent) => void, signal?: AbortSignal): Promise<void> {
    let lastEventId: string | undefined;
    const seenEventIds = new Set<string>();
    while (!signal?.aborted) {
      const headers = new Headers(this.headers());
      if (lastEventId) headers.set("last-event-id", lastEventId);
      const response = await fetch(`${this.baseUrl}/v1/runs/${id}/events`, { headers, signal });
      if (!response.ok || !response.body) throw new Error(await response.text() || `SSE failed: ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (!signal?.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const lines = frame.split("\n");
          const eventId = lines.find((line) => line.startsWith("id:"))?.slice(3).trimStart();
          const data = lines.filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart()).join("\n");
          if (data && (!eventId || !seenEventIds.has(eventId))) {
            const event = JSON.parse(data) as RunEvent;
            onEvent(event);
            if (event.type === "completed" || event.type === "failed"
              || (event.type === "status" && ["completed", "failed", "cancelled"].includes(event.status))) return;
          }
          if (eventId) seenEventIds.add(eventId);
          if (eventId) lastEventId = eventId;
        }
      }
      await abortableDelay(750, signal);
    }
  }

  private headers(): HeadersInit { return this.token ? { authorization: `Bearer ${this.token}` } : {}; }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers); for (const [key, value] of Object.entries(this.headers())) headers.set(key, value);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const text = await response.text();
      let body: unknown = text;
      let message = text || `${response.status} ${response.statusText}`;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
          if (typeof body === "object" && body !== null && "error" in body
            && typeof (body as { error: unknown }).error === "string") {
            message = (body as { error: string }).error;
          }
        } catch {
          // Preserve a non-JSON response as the error message.
        }
      }
      throw new GeneticAssemblyApiError(message, response.status, body);
    }
    return response.json() as Promise<T>;
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const aborted = () => { window.clearTimeout(timeout); reject(new DOMException("Aborted", "AbortError")); };
    const timeout = window.setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export class CandidatePreview {
  private readonly original = new Map<string, unknown>();
  constructor(private readonly scene: Scene) {}
  apply(member: ResultMember): void { for (const patch of member.patches) this.applyPatch(patch); }
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
    const [id, type, property] = key.split("|"); const object = findObject(this.scene, id);
    if (type === "visibility") return object.visible;
    if (type === "position" || type === "rotation" || type === "scale") return object[type][property as AxisName];
    if (type === "material") return (object as Object3D & { material: Material }).material[property as keyof Material];
    return readPath(object.userData, property);
  }
  private write(key: string, value: unknown): void {
    const [id, type, property] = key.split("|"); const object = findObject(this.scene, id);
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
  if (target.type === "position" || target.type === "rotation" || target.type === "scale") return `${target.object_id}|${target.type}|${target.axis}`;
  if (target.type === "visibility") return `${target.object_id}|visibility|value`;
  if (target.type === "material") return `${target.object_id}|material|${target.property}`;
  return `${target.object_id}|user_data|${target.path}`;
}
function readPath(root: Record<string, unknown>, path: string): unknown { return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], root); }
function writePath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split("."); let cursor = root;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  cursor[parts[parts.length - 1]] = value;
}
