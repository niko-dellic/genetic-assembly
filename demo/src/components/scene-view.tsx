import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CandidatePreview, type ResultMember } from "../../../client/src/index.js";

export interface SceneHandle { scene: THREE.Scene; preview: CandidatePreview }

export function SceneView({ active, onReady }: { active?: ResultMember; onReady(handle: SceneHandle): void }) {
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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshStandardMaterial({ color: 0x161d2a, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.51; scene.add(floor);
    const movable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0x5eead4, roughness: 0.55 }));
    movable.userData.gaId = "movable"; movable.position.set(-3, 0, 0); scene.add(movable);
    const obstacle = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.2), new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.6 }));
    obstacle.userData.gaId = "obstacle"; obstacle.position.set(0, 0.4, 0); scene.add(obstacle);
    for (const x of [-5, 5]) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.45 }));
      marker.position.set(x, -0.45, 0); scene.add(marker);
    }
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
      scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); } });
      renderer.dispose(); renderer.domElement.remove(); handle.current = undefined;
    };
  }, [onReady]);

  useEffect(() => {
    const preview = handle.current?.preview;
    if (!preview) return;
    preview.revert();
    if (active) preview.apply(active);
  }, [active]);

  return <div className="scene-viewport" ref={host} aria-label="Three.js candidate preview" />;
}
