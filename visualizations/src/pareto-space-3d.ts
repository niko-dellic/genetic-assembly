import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { chartColor, emptyMessage } from "./svg.js";
import type { VisualizationCallbacks, VisualizationController, VisualizationFrame } from "./types.js";

export function createParetoSpace3d(
  container: HTMLElement,
  callbacks: VisualizationCallbacks = {},
): VisualizationController {
  let frame: VisualizationFrame | undefined;
  let animation = 0;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b0e);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
  camera.position.set(1.7, 1.3, 1.9);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points!.threshold = 0.08;
  const pointer = new THREE.Vector2();
  let points: THREE.Points | undefined;
  let pointIds: number[] = [];
  const bounds = new THREE.Box3(new THREE.Vector3(-0.52, -0.52, -0.52), new THREE.Vector3(0.52, 0.52, 0.52));
  const boundsHelper = new THREE.Box3Helper(bounds, 0x303742);
  scene.add(boundsHelper);
  const axesGeometry = new THREE.BufferGeometry();
  axesGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5,
  ], 3));
  axesGeometry.setAttribute("color", new THREE.Float32BufferAttribute([
    0.18, 0.83, 0.75, 0.18, 0.83, 0.75,
    0.96, 0.62, 0.04, 0.96, 0.62, 0.04,
    0.66, 0.55, 0.98, 0.66, 0.55, 0.98,
  ], 3));
  const axesMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  scene.add(new THREE.LineSegments(axesGeometry, axesMaterial));
  const labels = document.createElement("div");
  labels.className = "viz-3d-labels";
  container.style.position = "relative";
  mountCanvas();

  function renderLoop(): void {
    controls.update();
    renderer.render(scene, camera);
    animation = requestAnimationFrame(renderLoop);
  }
  renderLoop();

  function rebuild(): void {
    if (!frame || frame.dataset.objectives.length !== 3 || frame.dataset.candidates.length === 0) {
      if (points) {
        scene.remove(points);
        points.geometry.dispose();
        (points.material as THREE.Material).dispose();
        points = undefined;
      }
      emptyMessage(container, frame?.dataset.objectives.length === 3
        ? "Run the solver to populate the 3D objective-space view."
        : "The 3D objective-space view requires exactly three objectives.");
      return;
    }
    mountCanvas();
    if (points) {
      scene.remove(points);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    }
    const candidates = frame.dataset.candidates;
    const scales = [0, 1, 2].map((index) => {
      const values = candidates.map((candidate) => candidate.individual.objectives[index]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      return (value: number) => max === min ? 0 : (value - min) / (max - min) - 0.5;
    });
    const positions = new Float32Array(candidates.length * 3);
    const colors = new Float32Array(candidates.length * 3);
    pointIds = [];
    candidates.forEach((candidate, index) => {
      positions[index * 3] = scales[0](candidate.individual.objectives[0]);
      positions[index * 3 + 1] = scales[1](candidate.individual.objectives[1]);
      positions[index * 3 + 2] = scales[2](candidate.individual.objectives[2]);
      const isHighlighted = candidate.individual.id === frame!.selection.activeId
        || frame!.selection.pinnedIds.includes(candidate.individual.id);
      const color = new THREE.Color(chartColor(candidate.individual.id, frame!.selection));
      if (!isHighlighted) {
        color.setRGB(
          0.34 + (positions[index * 3] + 0.5) * 0.42,
          0.34 + (positions[index * 3 + 1] + 0.5) * 0.42,
          0.42 + (positions[index * 3 + 2] + 0.5) * 0.42,
        );
      }
      color.toArray(colors, index * 3);
      pointIds.push(candidate.individual.id);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 0.078, vertexColors: true });
    points = new THREE.Points(geometry, material);
    scene.add(points);
  }

  function mountCanvas(): void {
    if (!container.contains(renderer.domElement)) container.replaceChildren(renderer.domElement);
    if (!container.contains(labels)) container.append(labels);
    labels.replaceChildren(...(frame?.dataset.objectives.slice(0, 3) ?? []).map((objective, index) => {
      const label = document.createElement("span");
      label.dataset.axis = String(index);
      label.textContent = objective.name;
      return label;
    }));
  }

  function hit(event: PointerEvent): number | undefined {
    if (!points) return undefined;
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersection = raycaster.intersectObject(points)[0];
    return intersection?.index === undefined ? undefined : pointIds[intersection.index];
  }
  const move = (event: PointerEvent) => callbacks.onHover?.(hit(event));
  const leave = () => callbacks.onHover?.();
  const click = (event: PointerEvent) => {
    const id = hit(event);
    if (id !== undefined) callbacks.onSelect?.(id);
  };
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("click", click);

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return {
    update(next) { frame = next; resize(); rebuild(); },
    resize,
    destroy() {
      cancelAnimationFrame(animation);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerleave", leave);
      renderer.domElement.removeEventListener("click", click);
      controls.dispose();
      points?.geometry.dispose();
      if (points) (points.material as THREE.Material).dispose();
      axesGeometry.dispose();
      axesMaterial.dispose();
      (boundsHelper.material as THREE.Material).dispose();
      renderer.dispose();
      container.replaceChildren();
      frame = undefined;
    },
  };
}
