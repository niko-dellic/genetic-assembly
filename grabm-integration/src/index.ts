import {
  simulationInputSchema,
  type SimulationInputData,
  type GraphNode,
  type GraphEdge,
  type FacilityData,
  type RunResult,
} from "@grabm/abm";
import {
  runBatch,
  createFileDatasetStore,
  type FileDatasetReference,
} from "@grabm/abm/node";
import { writeRunDataset } from "@grabm/abm/datasets";
import { analyzeRun, type AnalysisResult } from "@grabm/abm/analytics";
import {
  defineStudy,
  type StudyModel,
  type EvaluationContext,
} from "@genetic-assembly/sdk/node";
import {
  canonical,
  type Decisions,
  type Decision,
  type StudyInput,
} from "@genetic-assembly/sdk";
import { join } from "node:path";
export interface ProgramPreset {
  activities: Record<string, number>;
  capacity: number;
  anchorCapacity?: number;
  classification: NonNullable<FacilityData["classification"]>;
  tags?: string[];
}
export interface GraphSpace {
  nodes?: Record<
    string,
    {
      template?: GraphNode;
      optional?: boolean;
      x?: [number, number];
      y?: [number, number];
      z?: [number, number];
    }
  >;
  edges?: Record<
    string,
    {
      template?: GraphEdge;
      optional?: boolean;
      endpoints?: [string, string][];
      capacity?: [number, number];
    }
  >;
  facilities?: Record<
    string,
    {
      template?: FacilityData;
      optional?: boolean;
      sites?: string[];
      programs?: Record<string, ProgramPreset>;
      baselineProgram?: string;
      capacity?: [number, number];
    }
  >;
  settings?: Record<string, { path: string[]; lower: number; upper: number }>;
  requiredNodes?: string[];
  requiredFacilities?: string[];
  requiredConnections?: { from: string; to: string; mode: string }[];
  requiredActivities?: string[];
  limits?: {
    maxFacilities?: number;
    maxEdgeLength?: number;
    maxCapacity?: number;
  };
}
export interface GrabmStudyOptions {
  name: string;
  version: string;
  baseline: SimulationInputData;
  space: GraphSpace;
  objectives?: StudyInput["objectives"];
  constraints?: StudyInput["constraints"];
  searchSeeds?: number[];
  validationSeeds?: number[];
  measurements?: (
    analysis: AnalysisResult,
    input: SimulationInputData,
  ) => Record<string, number>;
  repair?: (decisions: Decisions) => {
    decisions: Decisions;
    repairs: string[];
  };
  updateRoute?: (edge: GraphEdge, input: SimulationInputData) => GraphEdge;
}
const key = (type: string, id: string, field: string) =>
  `${type}.${id}.${field}`;
/** Compile a bounded graph design space into named decisions with stable identifiers. */
export function graphDecisions(
  baseline: SimulationInputData,
  space: GraphSpace,
): Record<string, Decision> {
  const decisions: Record<string, Decision> = {};
  for (const [id, n] of Object.entries(space.nodes ?? {})) {
    const node = baseline.graph.nodes.find((n) => n.id === id) ?? n.template;
    if (!node) throw Error(`Unknown node ${id}`);
    if (n.optional)
      decisions[key("node", id, "enabled")] = {
        kind: "boolean",
        baseline: baseline.graph.nodes.some((n) => n.id === id),
      };
    for (const axis of ["x", "y", "z"] as const)
      if (n[axis])
        decisions[key("node", id, axis)] = {
          kind: "real",
          lower: n[axis]![0],
          upper: n[axis]![1],
          baseline: node.position[`${axis}M`],
        };
  }
  for (const [id, e] of Object.entries(space.edges ?? {})) {
    const edge = baseline.graph.edges.find((e) => e.id === id) ?? e.template;
    if (!edge) throw Error(`Unknown edge ${id}`);
    if (e.optional)
      decisions[key("edge", id, "enabled")] = {
        kind: "boolean",
        baseline: baseline.graph.edges.some(
          (e) => e.id === id && e.enabled !== false,
        ),
      };
    if (e.endpoints) {
      const choices = e.endpoints.map((pair) => JSON.stringify(pair));
      decisions[key("edge", id, "endpoints")] = {
        kind: "categorical",
        choices,
        baseline: JSON.stringify([edge.sourceNodeId, edge.targetNodeId]),
      };
    }
    if (e.capacity)
      decisions[key("edge", id, "capacity")] = {
        kind: "real",
        lower: e.capacity[0],
        upper: e.capacity[1],
        baseline: edge.capacityPersonsPerHour,
      };
  }
  for (const [id, f] of Object.entries(space.facilities ?? {})) {
    const facility = baseline.facilities.find((f) => f.id === id) ?? f.template;
    if (!facility) throw Error(`Unknown facility ${id}`);
    if (f.optional)
      decisions[key("facility", id, "enabled")] = {
        kind: "boolean",
        baseline: baseline.facilities.some((f) => f.id === id),
      };
    if (f.sites)
      decisions[key("facility", id, "site")] = {
        kind: "categorical",
        choices: f.sites,
        baseline: facility.accessNodeId,
      };
    if (f.programs) {
      if (!f.baselineProgram || !f.programs[f.baselineProgram])
        throw Error(`${id}: baselineProgram must select a preset`);
      for (const [name, preset] of Object.entries(f.programs)) {
        if (
          !preset.activities ||
          !preset.classification ||
          !Number.isFinite(preset.capacity)
        )
          throw Error(
            `${id}/${name}: program must define activities, capacity and classification`,
          );
      }
      decisions[key("facility", id, "program")] = {
        kind: "categorical",
        choices: Object.keys(f.programs),
        baseline: f.baselineProgram,
      };
    }
    if (f.capacity)
      decisions[key("facility", id, "capacity")] = {
        kind: "integer",
        lower: f.capacity[0],
        upper: f.capacity[1],
        baseline: facility.capacity,
        step: 1,
      };
  }
  for (const [id, setting] of Object.entries(space.settings ?? {})) {
    if (
      setting.path[0] !== "scenario" ||
      !["mobility", "behavior"].includes(setting.path[1]) ||
      setting.path.some((k) =>
        ["__proto__", "constructor", "prototype"].includes(k),
      )
    )
      throw Error(
        `${id}: setting path must select a numeric mobility or behavior parameter`,
      );
    let value: any = baseline;
    for (const field of setting.path) value = value?.[field];
    if (typeof value !== "number" || !Number.isFinite(value))
      throw Error(`${id}: setting path is not numeric`);
    decisions[key("setting", id, "value")] = {
      kind: "real",
      lower: setting.lower,
      upper: setting.upper,
      baseline: value,
    };
  }
  return decisions;
}
/** Reconstruct a detached candidate; spatial edits update route lengths rather than only the picture. */
export function buildGraph(
  baseline: SimulationInputData,
  space: GraphSpace,
  decisions: Decisions,
  updateRoute?: GrabmStudyOptions["updateRoute"],
): SimulationInputData {
  const input = structuredClone(baseline);
  for (const [id, n] of Object.entries(space.nodes ?? {})) {
    let node = input.graph.nodes.find((n) => n.id === id);
    if (!node && n.template) {
      node = structuredClone(n.template);
      input.graph.nodes.push(node);
    }
    if (!node) throw Error(`Missing node ${id}`);
    for (const axis of ["x", "y", "z"] as const) {
      const value = decisions[key("node", id, axis)];
      if (value !== undefined) node.position[`${axis}M`] = Number(value);
    }
    if (n.optional && decisions[key("node", id, "enabled")] === false)
      input.graph.nodes = input.graph.nodes.filter((n) => n.id !== id);
  }
  for (const [id, e] of Object.entries(space.edges ?? {})) {
    let edge = input.graph.edges.find((e) => e.id === id);
    if (!edge && e.template) {
      edge = structuredClone(e.template);
      input.graph.edges.push(edge);
    }
    if (!edge) throw Error(`Missing edge ${id}`);
    if (e.optional)
      edge.enabled = decisions[key("edge", id, "enabled")] === true;
    if (e.endpoints) {
      const pair = JSON.parse(
        String(decisions[key("edge", id, "endpoints")]),
      ) as [string, string];
      edge.sourceNodeId = pair[0];
      edge.targetNodeId = pair[1];
    }
    if (e.capacity)
      edge.capacityPersonsPerHour = Number(
        decisions[key("edge", id, "capacity")],
      );
  }
  input.graph.edges = input.graph.edges.filter((e) => e.enabled !== false);
  for (let index = 0; index < input.graph.edges.length; index++) {
    const edge = input.graph.edges[index];
    const a = input.graph.nodes.find((n) => n.id === edge.sourceNodeId),
      b = input.graph.nodes.find((n) => n.id === edge.targetNodeId);
    if (!a || !b) continue;
    const original = baseline.graph.edges.find((e) => e.id === edge.id);
    const oldA = baseline.graph.nodes.find(
        (n) => n.id === original?.sourceNodeId,
      ),
      oldB = baseline.graph.nodes.find((n) => n.id === original?.targetNodeId);
    const moved =
      !original ||
      JSON.stringify([a.position, b.position]) !==
        JSON.stringify([oldA?.position, oldB?.position]) ||
      edge.sourceNodeId !== original.sourceNodeId ||
      edge.targetNodeId !== original.targetNodeId;
    if (moved && (edge.shape || edge.travelTimeOverridesMinutes)) {
      if (!updateRoute)
        throw Error(
          `${edge.id}: route shape or travel-time override requires updateRoute`,
        );
      input.graph.edges[index] = simulationInputSchema.parse({
        ...input,
        graph: {
          ...input.graph,
          edges: [
            updateRoute(
              simulationInputSchema.parse({
                ...input,
                graph: { ...input.graph, edges: [edge] },
              }).graph.edges[0],
              input,
            ),
          ],
        },
      }).graph.edges[0];
    } else if (moved) {
      edge.lengthM = Math.hypot(
        a.position.xM - b.position.xM,
        a.position.yM - b.position.yM,
        a.position.zM - b.position.zM,
      );
    }
  }
  for (const [id, f] of Object.entries(space.facilities ?? {})) {
    let facility = input.facilities.find((f) => f.id === id);
    if (!facility && f.template) {
      facility = structuredClone(f.template);
      input.facilities.push(facility);
    }
    if (!facility) throw Error(`Missing facility ${id}`);
    if (f.programs) {
      const program =
        f.programs[String(decisions[key("facility", id, "program")])];
      if (!program) throw Error(`Unknown program for ${id}`);
      Object.assign(facility, structuredClone(program));
    }
    if (f.sites)
      facility.accessNodeId = String(decisions[key("facility", id, "site")]);
    if (f.capacity)
      facility.capacity = Number(decisions[key("facility", id, "capacity")]);
    if (f.optional && decisions[key("facility", id, "enabled")] === false)
      input.facilities = input.facilities.filter((f) => f.id !== id);
  }
  for (const [id, setting] of Object.entries(space.settings ?? {})) {
    let target: any = input;
    for (const field of setting.path.slice(0, -1)) target = target[field];
    target[setting.path.at(-1)!] = Number(
      decisions[key("setting", id, "value")],
    );
  }
  return input;
}
/** Domain invalidity is explicit; no disconnected design is rewarded for generating fewer trips. */
export function validateGraph(
  input: SimulationInputData,
  space: GraphSpace,
): string[] {
  const issues: string[] = [];
  const nodes = new Set(input.graph.nodes.map((n) => n.id));
  for (const id of space.requiredNodes ?? [])
    if (!nodes.has(id)) issues.push(`Required node ${id} is missing`);
  for (const id of space.requiredFacilities ?? [])
    if (!input.facilities.some((f) => f.id === id))
      issues.push(`Required facility ${id} is missing`);
  for (const edge of input.graph.edges) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId))
      issues.push(`Edge ${edge.id} has an inactive endpoint`);
    for (const mode of edge.modes)
      if (!input.scenario.mobility.modes[mode]?.enabled)
        issues.push(`Edge ${edge.id} uses disabled mode ${mode}`);
  }
  for (const facility of input.facilities)
    if (!nodes.has(facility.accessNodeId))
      issues.push(`Facility ${facility.id} has no active access node`);
  for (const activity of space.requiredActivities ?? [])
    if (
      !input.facilities.some(
        (f) => (f.activities[activity] ?? 0) > 0 && f.availability.length > 0,
      )
    )
      issues.push(`Required activity ${activity} is unavailable`);
  for (const connection of space.requiredConnections ?? []) {
    const seen = new Set([connection.from]);
    for (let i = 0; i < input.graph.nodes.length; i++)
      for (const edge of input.graph.edges) {
        if (!edge.modes.includes(connection.mode)) continue;
        if (edge.direction !== "reverse" && seen.has(edge.sourceNodeId))
          seen.add(edge.targetNodeId);
        if (edge.direction !== "forward" && seen.has(edge.targetNodeId))
          seen.add(edge.sourceNodeId);
      }
    if (
      !nodes.has(connection.from) ||
      !nodes.has(connection.to) ||
      !seen.has(connection.to)
    )
      issues.push(
        `Required ${connection.mode} connection ${connection.from} → ${connection.to} is missing`,
      );
  }
  if (
    space.limits?.maxFacilities !== undefined &&
    input.facilities.length > space.limits.maxFacilities
  )
    issues.push("Facility budget exceeded");
  if (
    space.limits?.maxEdgeLength !== undefined &&
    input.graph.edges.reduce((n, e) => n + e.lengthM, 0) >
      space.limits.maxEdgeLength
  )
    issues.push("Link length budget exceeded");
  if (
    space.limits?.maxCapacity !== undefined &&
    input.facilities.reduce((n, f) => n + f.capacity, 0) >
      space.limits.maxCapacity
  )
    issues.push("Capacity budget exceeded");
  const parsed = simulationInputSchema.safeParse(input);
  if (!parsed.success)
    issues.push(
      ...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return issues;
}
function metrics(
  analysis: AnalysisResult,
  input: SimulationInputData,
  run: RunResult,
): Record<string, number> {
  if (!run.needOutcomes.length)
    throw Error(
      "Demand fulfillment requires authored activityNeeds; supply measurements for models without authored demand",
    );
  const service =
    run.needOutcomes.filter((n) => n.fulfillment !== "unmet").length /
    run.needOutcomes.length;
  return {
    service,
    access: analysis.accessibility.coverage15,
    cost:
      input.facilities.reduce((sum, f) => sum + f.capacity + 10, 0) +
      input.graph.edges.reduce((sum, e) => sum + e.lengthM * 0.01, 0),
    completedTrips: analysis.trips.completed,
    meanTravelMinutes: analysis.trips.meanTravelMinutes,
  };
}
/** Build a reusable study using grabm's public Node, analytics and dataset APIs. */
export function defineGrabmStudy(options: GrabmStudyOptions): StudyModel {
  const baseline = simulationInputSchema.parse(options.baseline);
  const space = structuredClone(options.space);
  for (const [id, slot] of Object.entries(space.facilities ?? {}))
    if (slot.programs && slot.baselineProgram) {
      const preset = slot.programs[slot.baselineProgram];
      const facility =
        baseline.facilities.find((f) => f.id === id) ?? slot.template;
      if (preset && facility) {
        const stable = (value: unknown) => canonical(value ?? null);
        if (
          preset.capacity !== facility.capacity ||
          stable(preset.activities) !== stable(facility.activities) ||
          stable(preset.classification) !== stable(facility.classification)
        )
          throw Error(
            `${id}: baseline program must match baseline activities, capacity and classification`,
          );
      }
    }

  const decisions = graphDecisions(baseline, space);
  const references = new Map<string, FileDatasetReference>();
  const reconstruct = (values: Decisions) =>
    buildGraph(baseline, space, values, options.updateRoute);
  // Reject unsupported route edits before a long optimization can begin.
  if (!options.updateRoute)
    for (const edge of baseline.graph.edges)
      if (
        (edge.shape || edge.travelTimeOverridesMinutes) &&
        [edge.sourceNodeId, edge.targetNodeId].some((id) => {
          const n = space.nodes?.[id];
          return !!(n?.x || n?.y || n?.z);
        })
      )
        throw Error(
          `${edge.id}: movable curved/overridden route requires updateRoute`,
        );
  return defineStudy({
    name: options.name,
    version: options.version,
    inputs: { baseline, space } as any,
    decisions,
    objectives: options.objectives ?? {
      service: { metric: "service", direction: "maximize", unit: "fraction" },
      access: { metric: "access", direction: "maximize", unit: "fraction" },
      cost: { metric: "cost", direction: "minimize", unit: "proxy units" },
    },
    constraints: options.constraints ?? {},
    searchSeeds: options.searchSeeds ?? [42, 43, 44],
    validationSeeds: options.validationSeeds ?? [142, 143, 144],
    repair: options.repair ? (values) => options.repair!(values) : undefined,
    validate: (values) => validateGraph(reconstruct(values), space),
    async evaluate(values, _inputs, context) {
      const input = reconstruct(values);
      input.run = { ...input.run, seed: context.seed };
      let run: RunResult | undefined;
      for await (const outcome of runBatch([{ id: "candidate", input }], {
        workers: 1,
        signal: context.signal,
      })) {
        if (outcome.status === "failed") throw outcome.error;
        run = outcome.result as RunResult;
      }
      if (!run) throw Error("Simulation returned no result");
      const analysis = analyzeRun(run);
      const valuesMeasured = options.measurements
        ? options.measurements(analysis, input)
        : metrics(analysis, input, run);
      if (context.retainReplay) {
        const directory = join(context.directory, "dataset");
        const store = await createFileDatasetStore(directory);
        const reference = await writeRunDataset(run, store);
        references.set(context.directory, { ...reference, directory });
      }
      return { metrics: valuesMeasured, warnings: analysis.warnings };
    },
    async dataset(context: EvaluationContext) {
      const reference = references.get(context.directory);
      references.delete(context.directory);
      return reference;
    },
    materialize: (values) => ({
      decisions: values,
      input: reconstruct(values),
    }),
  });
}
