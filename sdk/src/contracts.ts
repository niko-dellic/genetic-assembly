import { errorDetailSchema } from "./observation.js";
import { z } from "zod";
export const API_VERSION = 3 as const;
export const ADAPTER_PROTOCOL_VERSION = "genetic-assembly-adapter-v3" as const;
const finite = z.number().finite();
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/);
export const decisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("real"),
    lower: finite,
    upper: finite,
    baseline: finite,
  }),
  z.object({
    kind: z.literal("integer"),
    lower: finite.int(),
    upper: finite.int(),
    step: finite.int().positive().default(1),
    baseline: finite.int(),
  }),
  z.object({ kind: z.literal("boolean"), baseline: z.boolean() }),
  z.object({
    kind: z.literal("categorical"),
    choices: z.array(z.string().min(1)).min(2),
    baseline: z.string(),
  }),
]);
export type Decision = z.input<typeof decisionSchema>;
export type Decisions = Record<string, number | boolean | string>;
export const goalSchema = z.object({
  metric: id,
  direction: z.enum(["minimize", "maximize"]),
  label: z.string().optional(),
  unit: z.string().default("value"),
});
export const constraintSchema = z.object({
  metric: id,
  operator: z.enum(["<=", ">="]),
  bound: finite,
  label: z.string().optional(),
});
export const studySpecSchema = z.object({
  schemaVersion: z.literal(3).default(3),
  name: z.string().min(1),
  version: z.string().min(1),
  inputs: z.json(),
  decisions: z
    .record(id, decisionSchema)
    .refine(
      (v) => Object.keys(v).length > 0,
      "At least one decision is required",
    ),
  objectives: z
    .record(id, goalSchema)
    .refine(
      (v) => Object.keys(v).length > 0,
      "At least one objective is required",
    ),
  constraints: z.record(id, constraintSchema).default({}),
  searchSeeds: z
    .array(z.number().int().nonnegative().max(4294967295))
    .min(1)
    .default([42, 43, 44]),
  validationSeeds: z
    .array(z.number().int().nonnegative().max(4294967295))
    .min(1)
    .default([142, 143, 144]),
});
export type StudySpec = z.output<typeof studySpecSchema>;
export type StudyInput = z.input<typeof studySpecSchema>;
export const measurementSchema = z.object({
  metrics: z.record(id, finite),
  warnings: z.array(z.string()).default([]),
});
export type Measurement = z.input<typeof measurementSchema>;
export const evaluationSchema = z.object({
  id: z.string(),
  ownerId: z.string().uuid(),
  studyId: z.string(),
  candidateId: z.string(),
  designHash: z.string(),
  phase: z.enum(["search", "validation", "baseline", "replay"]),
  seed: z.number().int().nonnegative(),
  decisions: z.record(
    z.string(),
    z.union([z.number(), z.boolean(), z.string()]),
  ),
  status: z.enum(["completed", "invalid", "failed"]),
  metrics: z.record(z.string(), finite),
  constraints: z.record(z.string(), finite),
  warnings: z.array(z.string()),
  repairs: z.array(z.string()),
  error: z.string().optional(),
  errorDetail: errorDetailSchema.optional(),
  cacheKey: z.string(),
  cached: z.boolean().default(false),
  runtimeMs: z.number().nonnegative(),
  datasetId: z.string().optional(),
});
export type EvaluationRecord = z.infer<typeof evaluationSchema>;
export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
export interface Runtime {
  command: string;
  args: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  identity: string;
  timeoutMs?: number;
}
export interface PreparedStudy {
  id: string;
  spec: StudySpec;
  runtime: Runtime;
  created_at?: string;
}
export interface RunConfig {
  validate?: boolean;
  population_size?: number;
  generations?: number;
  seed?: number;
  threads?: number;
  crossover_probability?: number;
  mutation_probability?: number;
}
export interface RunStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  current_generation: number;
  error?: string | null;
  errorDetail?: import("./errors.js").ErrorDetail;
  config: RunConfig;
}
export interface DatasetReference {
  id: string;
  ownerId: string;
  studyId: string;
  candidateId: string;
  seed: number;
  manifestKey: string;
  runHash: string;
  resources: Record<string, string>;
  metadata?: unknown;
}
export interface Job {
  id: string;
  study_id: string;
  kind: "baseline" | "replay";
  status: RunStatus["status"];
  error?: string;
  errorDetail?: import("./errors.js").ErrorDetail;
  request: { decisions: Decisions };
  result?: unknown;
}
/** Sorted JSON is stable across object insertion orders; rejects unsupported/non-finite values. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object" && value !== null)
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  throw new Error("Study inputs must contain only finite JSON values");
}
