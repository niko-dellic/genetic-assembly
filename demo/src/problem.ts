import type { EvaluatorManifest, SceneManifest } from "../../client/src/index.js";

export const sceneManifest: SceneManifest = {
  schema_version: 1,
  objects: [{ id: "movable" }, { id: "obstacle" }],
  levers: [
    { id: "movable-x", kind: "real", lower: -6, upper: 6, target: { type: "position", object_id: "movable", axis: "x" } },
    { id: "movable-z", kind: "real", lower: -3.5, upper: 3.5, target: { type: "position", object_id: "movable", axis: "z" } },
  ],
};

export const evaluatorManifest: EvaluatorManifest = {
  api_version: 1,
  objectives: [
    { name: "Distance to west target", direction: "minimize" },
    { name: "Distance to east target", direction: "minimize" },
  ],
  constraints: [{ name: "Obstacle overlap" }],
};

export const evaluatorSource = `export function evaluate(ctx) {
  return {
    objectives: [
      ctx.targetDistance("movable", [-5, 0, 0]),
      ctx.targetDistance("movable", [5, 0, 0])
    ],
    constraints: [ctx.overlapVolume("movable", "obstacle")]
  };
}`;
