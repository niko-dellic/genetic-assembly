import {
  measurementSchema,
  type Decisions,
  type EvaluationRecord,
  type Measurement,
  type StudyInput,
  type StudySpec,
} from "./contracts.js";
import { encodeDecisions, validateStudy } from "./study.js";
/** Portable replay bytes, with paths relative to the dataset manifest. */
export interface ReplayDataset {
  manifestKey: string;
  runHash: string;
  resources: Record<string, Uint8Array>;
}
export interface EvaluationContext {
  /** Service worker scratch directory; absent in portable browser evaluations. */
  directory?: string;
  seed: number;
  phase: EvaluationRecord["phase"];
  signal: AbortSignal;
  retainReplay: boolean;
  /** Retain a replay only when requested. Resources are copied into the session. */
  retainDataset(dataset: ReplayDataset): void;
}
export interface StudyModel extends StudyInput {
  evaluate(
    decisions: Decisions,
    inputs: unknown,
    context: EvaluationContext,
  ): Measurement | Promise<Measurement>;
  repair?(
    decisions: Decisions,
    inputs: unknown,
  ): { decisions: Decisions; repairs: string[] };
  validate?(decisions: Decisions, inputs: unknown): string[];
  materialize?(
    decisions: Decisions,
    inputs: unknown,
  ): unknown | Promise<unknown>;
}
/** Author one portable model for local evaluation; prepare a module for service execution. */
export function defineStudy(model: StudyModel): StudyModel {
  validateStudy(model);
  return model;
}
export function mapMeasurements(spec: StudySpec, measurement: Measurement) {
  const parsed = measurementSchema.parse(measurement);
  const metric = (name: string) => {
    const value = parsed.metrics[name];
    if (!Number.isFinite(value))
      throw Error(`Required metric ${name} is missing or non-finite`);
    return value;
  };
  const objectives = Object.values(spec.objectives).map((goal) =>
    metric(goal.metric),
  );
  const constraints = Object.fromEntries(
    Object.entries(spec.constraints).map(([id, constraint]) => [
      id,
      constraint.operator === "<="
        ? metric(constraint.metric) - constraint.bound
        : constraint.bound - metric(constraint.metric),
    ]),
  );
  return {
    ...parsed,
    objectives,
    constraints: { ...constraints, domain_validity: 0 },
  };
}
export function repairDesign(
  model: Pick<StudyModel, "repair" | "validate">,
  spec: StudySpec,
  proposed: Decisions,
) {
  const repaired = model.repair?.(
    { ...proposed },
    structuredClone(spec.inputs),
  ) ?? { decisions: { ...proposed }, repairs: [] };
  encodeDecisions(spec, repaired.decisions);
  if (
    !Array.isArray(repaired.repairs) ||
    repaired.repairs.some((message) => typeof message !== "string")
  )
    throw Error("Repair must report an array of messages");
  const invalid =
    model.validate?.(
      structuredClone(repaired.decisions),
      structuredClone(spec.inputs),
    ) ?? [];
  if (
    !Array.isArray(invalid) ||
    invalid.some((message) => typeof message !== "string")
  )
    throw Error("Validation must report an array of messages");
  return { ...repaired, invalid };
}
