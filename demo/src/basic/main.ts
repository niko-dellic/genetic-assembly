import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "../styles.css";
import {
  CandidatePreview, GeneticAssemblyClient, exportScene,
  type ResultMember, type RunEvent, type SceneManifest,
} from "../../../client/src/index.js";

const api = new GeneticAssemblyClient(import.meta.env.VITE_GA_SERVER_URL || "http://127.0.0.1:3001");
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const revertButton = document.querySelector<HTMLButtonElement>("#revert")!;
const status = document.querySelector<HTMLElement>("#status")!;
const serverStatus = document.querySelector<HTMLElement>("#server")!;
const serverDot = document.querySelector<HTMLElement>("#server-dot")!;
const front = document.querySelector<HTMLElement>("#front")!;
const frontCount = document.querySelector<HTMLElement>("#front-count")!;
const progressBar = document.querySelector<HTMLElement>("#progress-bar")!;
const progressLabel = document.querySelector<HTMLElement>("#progress-label")!;
const populationInput = document.querySelector<HTMLInputElement>("#population")!;
const generationsInput = document.querySelector<HTMLInputElement>("#generations")!;
const threadsInput = document.querySelector<HTMLInputElement>("#threads")!;
let completedStatus = "Ready to start a server-side optimization.";

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x090d14);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100); camera.position.set(8, 8, 10);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0, 0); controls.update();
scene.add(new THREE.HemisphereLight(0xffffff, 0x223355, 2.2));
const directional = new THREE.DirectionalLight(0xffffff, 2.5); directional.position.set(4, 8, 5); scene.add(directional);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshStandardMaterial({ color: 0x172131, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.51; scene.add(floor);

const movable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0x63dfbe }));
movable.userData.gaId = "movable"; movable.position.set(-3, 0, 0); scene.add(movable);
const obstacle = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.2), new THREE.MeshStandardMaterial({ color: 0xe56565 }));
obstacle.userData.gaId = "obstacle"; obstacle.position.set(0, 0.4, 0); scene.add(obstacle);
for (const x of [-5, 5]) {
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x4a8ee8, transparent: true, opacity: 0.45 }));
  marker.position.set(x, -0.45, 0); scene.add(marker);
}
const preview = new CandidatePreview(scene);

let renderedWidth = 0;
let renderedHeight = 0;
function resize(width = viewport.clientWidth, height = viewport.clientHeight): void {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (nextWidth === renderedWidth && nextHeight === renderedHeight) return;

  renderedWidth = nextWidth;
  renderedHeight = nextHeight;
  renderer.setSize(nextWidth, nextHeight, false);
  camera.aspect = nextWidth / nextHeight;
  camera.updateProjectionMatrix();
}
new ResizeObserver(([entry]) => resize(entry.contentRect.width, entry.contentRect.height)).observe(viewport);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

const manifest: SceneManifest = {
  schema_version: 1,
  objects: [{ id: "movable" }, { id: "obstacle" }],
  levers: [
    { id: "movable-x", kind: "real", lower: -6, upper: 6, target: { type: "position", object_id: "movable", axis: "x" } },
    { id: "movable-z", kind: "real", lower: -3.5, upper: 3.5, target: { type: "position", object_id: "movable", axis: "z" } },
  ],
};
const evaluator = `export function evaluate(ctx) {
  return {
    objectives: [
      ctx.targetDistance("movable", [-5, 0, 0]),
      ctx.targetDistance("movable", [5, 0, 0])
    ],
    constraints: [ctx.overlapVolume("movable", "obstacle")]
  };
}`;

async function checkServer(): Promise<void> {
  try {
    const response = await fetch(`${api.baseUrl}/health`);
    if (!response.ok) throw new Error(response.statusText);
    serverStatus.textContent = "Solver connected";
    serverDot.className = "status-dot connected";
  } catch {
    serverStatus.textContent = "Solver unavailable";
    serverDot.className = "status-dot unavailable";
  }
}
void checkServer();

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  runButton.textContent = "Running…";
  preview.revert();
  front.innerHTML = '<div class="empty-state">Waiting for the first generation…</div>';
  frontCount.textContent = "0 candidates";
  setProgress(0, 1, "Preparing");
  try {
    const populationSize = positiveInteger(populationInput, "Population");
    const generations = positiveInteger(generationsInput, "Generations");
    const threads = threadsInput.value.trim() === "" ? undefined : positiveInteger(threadsInput, "Worker threads");

    setStatus("Exporting immutable scene geometry…");
    const exported = await exportScene(scene, manifest);
    const sceneRevision = await api.uploadScene(exported.glb, exported.manifest);
    setStatus("Validating evaluator contract…");
    const evaluatorRevision = await api.createEvaluator(evaluator, {
      api_version: 1,
      objectives: [
        { name: "distance-left", direction: "minimize" },
        { name: "distance-right", direction: "minimize" },
      ],
    });
    const run = await api.startRun(sceneRevision.id, evaluatorRevision.id, {
      population_size: populationSize,
      generations,
      threads,
      seed: 42,
    });
    setStatus(`Queued run ${run.id}`);
    let eventFailure: string | undefined;
    await api.subscribe(run.id, (event: RunEvent) => {
      if (event.type === "status") {
        progressLabel.textContent = titleCase(event.status);
      }
      if (event.type === "generation") {
        setProgress(event.summary.generation, generations, `Generation ${event.summary.generation}/${generations}`);
        setStatus(`${event.summary.pareto_size} Pareto candidates\n${event.summary.evaluations} evaluations`);
      }
      if (event.type === "failed") {
        eventFailure = event.error;
        setStatus(event.error, "danger");
        progressLabel.textContent = "Failed";
      }
      if (event.type === "completed") {
        completedStatus = `Completed with ${event.pareto_size} Pareto candidates.`;
        setProgress(generations, generations, "Completed");
        setStatus(completedStatus, "success");
      }
    });
    const finalRun = await api.getRun(run.id);
    if (finalRun.status === "failed") {
      throw new Error(finalRun.error || eventFailure || "The solver failed without recording a reason.");
    }
    if (finalRun.status !== "completed" && finalRun.status !== "cancelled") {
      throw new Error(`Run stopped in unexpected state: ${finalRun.status}`);
    }
    const results = await api.getResults(run.id);
    showCandidates(results.members);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
    progressLabel.textContent = "Failed";
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Start optimization";
  }
});

revertButton.addEventListener("click", () => {
  preview.revert();
  for (const button of front.querySelectorAll("button")) button.setAttribute("aria-pressed", "false");
  setStatus(`${completedStatus}\nPreview reverted.`, "success");
});

function showCandidates(members: ResultMember[]): void {
  front.innerHTML = "";
  frontCount.textContent = `${members.length} ${members.length === 1 ? "candidate" : "candidates"}`;
  if (members.length === 0) {
    front.innerHTML = '<div class="empty-state">The run completed without Pareto candidates.</div>';
    return;
  }
  members.forEach((member, index) => {
    const button = document.createElement("button"); button.className = "candidate";
    button.setAttribute("aria-pressed", "false");
    button.textContent = `Candidate ${index + 1}\nLeft ${member.individual.objectives[0].toFixed(3)}  ·  Right ${member.individual.objectives[1].toFixed(3)}`;
    button.addEventListener("click", () => {
      preview.revert();
      for (const candidate of front.querySelectorAll("button")) candidate.setAttribute("aria-pressed", "false");
      preview.apply(member); button.setAttribute("aria-pressed", "true");
      setStatus(`${completedStatus}\nPreviewing candidate ${index + 1}.`, "success");
    });
    front.append(button);
  });
}

function positiveInteger(input: HTMLInputElement, label: string): number {
  const value = input.valueAsNumber;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function setProgress(current: number, total: number, label: string): void {
  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  progressBar.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function setStatus(message: string, tone: "neutral" | "success" | "danger" = "neutral"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
