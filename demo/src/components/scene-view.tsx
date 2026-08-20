import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CandidatePreview, type ResultMember } from "../../../client/src/index.js";
import type { OptimizationProblem } from "../problem.js";

export interface SceneHandle { scene: THREE.Scene; preview: CandidatePreview }

export function SceneView({ active, problem, onReady }: { active?: ResultMember; problem: OptimizationProblem; onReady(handle: SceneHandle): void }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | undefined>(undefined);

  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080b11);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    camera.position.set(8, 7, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.append(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x172033, 2.1));
    const directional = new THREE.DirectionalLight(0xffffff, 2.5);
    directional.position.set(4, 8, 5); scene.add(directional);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x161d2a, roughness: 1 }));
    floor.userData.gaViewerOnly = true;
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.51; scene.add(floor);
    buildProblemScene(scene, problem.id);
    const preview = new CandidatePreview(scene);
    handle.current = { scene, preview };
    onReady(handle.current);
    const resize = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    });
    resize.observe(element);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => {
      resize.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); preview.revert();
      scene.traverse((object) => {
        const resource = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        resource.geometry?.dispose();
        const materials = resource.material ? (Array.isArray(resource.material) ? resource.material : [resource.material]) : [];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose(); renderer.domElement.remove(); handle.current = undefined;
    };
  }, [onReady, problem.id]);

  useEffect(() => {
    const preview = handle.current?.preview;
    if (!preview) return;
    preview.revert();
    if (active) preview.apply(active);
  }, [active]);

  return <div className="scene-viewport" ref={host} aria-label="Three.js candidate preview" />;
}

function buildProblemScene(scene: THREE.Scene, id: OptimizationProblem["id"]): void {
  const movable = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1, 1.25), new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.5 }));
  movable.userData.gaId = "movable";
  if (id === "two-target") {
    movable.scale.set(1.12, 1, 1.12);
    movable.position.set(-3, 0, 0);
    scene.add(movable);
    addObstacle(scene, "obstacle", [0, 0.4, 0], [2.2, 1.8, 2.2]);
    addAnchor(scene, [-5, -0.45, 0], 0x60a5fa);
    addAnchor(scene, [5, -0.45, 0], 0x60a5fa);
    return;
  }

  movable.position.set(0, 0, -2);
  scene.add(movable);
  addObstacle(scene, "obstacle-west", [-1.65, 0.25, 0], [1.35, 1.5, 1.8]);
  addObstacle(scene, "obstacle-east", [1.65, 0.25, 0], [1.35, 1.5, 1.8]);
  const anchors: Array<{ position: [number, number, number]; color: number }> = [
    { position: [-4, -0.45, -3], color: 0x2dd4bf },
    { position: [4, -0.45, -3], color: 0xf59e0b },
    { position: [0, -0.45, 4], color: 0xa78bfa },
  ];
  anchors.forEach((anchor) => addAnchor(scene, anchor.position, anchor.color));
  const outline = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-4, -0.4, -3), new THREE.Vector3(4, -0.4, -3),
    new THREE.Vector3(0, -0.4, 4), new THREE.Vector3(-4, -0.4, -3),
  ]);
  const guide = new THREE.Line(outline, new THREE.LineBasicMaterial({ color: 0x3f4655, transparent: true, opacity: 0.7 }));
  guide.userData.gaViewerOnly = true;
  scene.add(guide);
}

function addObstacle(scene: THREE.Scene, id: string, position: [number, number, number], size: [number, number, number]): void {
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.62 }));
  obstacle.userData.gaId = id;
  obstacle.position.set(...position);
  scene.add(obstacle);
}

function addAnchor(scene: THREE.Scene, position: [number, number, number], color: number): void {
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.06, 36), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.7 }));
  marker.userData.gaViewerOnly = true;
  marker.position.set(...position);
  scene.add(marker);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.035, 8, 36), new THREE.MeshBasicMaterial({ color }));
  ring.userData.gaViewerOnly = true;
  ring.rotation.x = Math.PI / 2;
  ring.position.set(position[0], position[1] + 0.04, position[2]);
  scene.add(ring);
}
