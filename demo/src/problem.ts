import type { EvaluatorManifest, SceneManifest } from "../../client/src/index.js";

export type ProblemId = "two-target" | "three-anchor";

export interface OptimizationProblem {
  id: ProblemId;
  name: string;
  shortDescription: string;
  sceneName: string;
  sceneManifest: SceneManifest;
  evaluatorManifest: EvaluatorManifest;
  evaluatorSource: string;
  recommendedPopulation: number;
  recommendedGenerations: number;
}

const twoTarget: OptimizationProblem = {
  id: "two-target",
  name: "Two-target placement",
  shortDescription: "Move one volume between competing targets while maintaining zero overlap with the central obstacle.",
  sceneName: "Two-target study.glb",
  recommendedPopulation: 64,
  recommendedGenerations: 50,
  sceneManifest: {
    schema_version: 1,
    objects: [{ id: "movable" }, { id: "obstacle" }],
    levers: [
      { id: "movable-x", kind: "real", lower: -6, upper: 6, target: { type: "position", object_id: "movable", axis: "x" } },
      { id: "movable-z", kind: "real", lower: -3.5, upper: 3.5, target: { type: "position", object_id: "movable", axis: "z" } },
    ],
  },
  evaluatorManifest: {
    api_version: 1,
    objectives: [
      { name: "Distance to west target", direction: "minimize" },
      { name: "Distance to east target", direction: "minimize" },
    ],
    constraints: [{ name: "Obstacle overlap" }],
  },
  evaluatorSource: `export function evaluate(ctx) {
    return {
      objectives: [
        ctx.targetDistance("movable", [-5, 0, 0]),
        ctx.targetDistance("movable", [5, 0, 0])
      ],
      constraints: [ctx.overlapVolume("movable", "obstacle")]
    };
  }`,
};

const threeAnchor: OptimizationProblem = {
  id: "three-anchor",
  name: "Three-anchor facility",
  shortDescription: "Place one facility between three non-collinear demand anchors. Two obstacles carve infeasible gaps into the three-objective Pareto surface.",
  sceneName: "Three-anchor facility.glb",
  recommendedPopulation: 96,
  recommendedGenerations: 70,
  sceneManifest: {
    schema_version: 1,
    objects: [{ id: "movable" }, { id: "obstacle-west" }, { id: "obstacle-east" }],
    levers: [
      { id: "facility-x", kind: "real", lower: -5, upper: 5, target: { type: "position", object_id: "movable", axis: "x" } },
      { id: "facility-z", kind: "real", lower: -4, upper: 5, target: { type: "position", object_id: "movable", axis: "z" } },
    ],
  },
  evaluatorManifest: {
    api_version: 1,
    objectives: [
      { name: "Distance to anchor A", direction: "minimize" },
      { name: "Distance to anchor B", direction: "minimize" },
      { name: "Distance to anchor C", direction: "minimize" },
    ],
    constraints: [
      { name: "West obstacle overlap" },
      { name: "East obstacle overlap" },
    ],
  },
  evaluatorSource: `export function evaluate(ctx) {
    return {
      objectives: [
        ctx.targetDistance("movable", [-4, 0, -3]),
        ctx.targetDistance("movable", [4, 0, -3]),
        ctx.targetDistance("movable", [0, 0, 4])
      ],
      constraints: [
        ctx.overlapVolume("movable", "obstacle-west"),
        ctx.overlapVolume("movable", "obstacle-east")
      ]
    };
  }`,
};

export const problems: OptimizationProblem[] = [twoTarget, threeAnchor];
export const defaultProblem = twoTarget;

export function getProblem(id: ProblemId): OptimizationProblem {
  const problem = problems.find((candidate) => candidate.id === id);
  if (!problem) throw new Error(`Unknown optimization problem ${id}`);
  return problem;
}
