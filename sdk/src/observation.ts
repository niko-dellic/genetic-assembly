import { z } from "zod";
export const errorDetailSchema = z
  .object({
    code: z.string(),
    stage: z.string(),
    message: z.string(),
    candidateId: z.string().optional(),
    seed: z.number().optional(),
    asset: z.string().optional(),
    cause: z.string().optional(),
  })
  .strict();
export const operationEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    operationId: z.string(),
    type: z.enum([
      "phase",
      "evaluation-started",
      "evaluation-completed",
      "evaluation-failed",
      "generation-completed",
      "completed",
      "failed",
      "cancelled",
    ]),
    phase: z.enum(["baseline", "search", "validation", "replay"]).optional(),
    candidateId: z.string().optional(),
    seed: z.number().optional(),
    recordId: z.string().optional(),
    generation: z.number().int().nonnegative().optional(),
    active: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    error: errorDetailSchema.optional(),
  })
  .strict();
export const generationSnapshotSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    summary: z
      .object({
        generation: z.number(),
        evaluations: z.number(),
        pareto_size: z.number(),
        feasible_count: z.number(),
        infeasible_count: z.number(),
      })
      .passthrough(),
    evaluatedCandidateIds: z.array(z.string()),
    population: z.array(
      z
        .object({
          candidateId: z.string(),
          rank: z.number(),
          crowdingDistance: z.number().nullable(),
        })
        .strict(),
    ),
    paretoCandidateIds: z.array(z.string()),
    discoveredParetoCandidateIds: z.array(z.string()),
  })
  .strict();
export const candidateResultSchema = z
  .object({
    candidateId: z.string(),
    decisions: z.record(
      z.string(),
      z.union([z.number(), z.boolean(), z.string()]),
    ),
    metrics: z.record(z.string(), z.number()),
    constraints: z.record(z.string(), z.number()),
    seedCount: z.number().int().nonnegative(),
    feasible: z.boolean(),
  })
  .strict();
import type { ErrorDetail } from "./errors.js";
import type { SolverProgress } from "./solver.js";
export interface OperationEvent {
  sequence: number;
  operationId: string;
  type:
    | "phase"
    | "evaluation-started"
    | "evaluation-completed"
    | "evaluation-failed"
    | "generation-completed"
    | "completed"
    | "failed"
    | "cancelled";
  phase?: "baseline" | "search" | "validation" | "replay";
  candidateId?: string;
  seed?: number;
  recordId?: string;
  generation?: number;
  active: number;
  queued: number;
  error?: ErrorDetail;
}
export interface GenerationSnapshot {
  generation: number;
  summary: SolverProgress;
  evaluatedCandidateIds: string[];
  population: {
    candidateId: string;
    rank: number;
    crowdingDistance: number | null;
  }[];
  paretoCandidateIds: string[];
  discoveredParetoCandidateIds: string[];
}
export interface HistoryPage<T> {
  items: T[];
  nextOffset: number | null;
}
export interface PageOptions {
  offset?: number;
  limit?: number;
}
/** @internal */
export function pageOptions(options: PageOptions = {}): Required<PageOptions> {
  if (
    !Number.isFinite(options.offset ?? 0) ||
    !Number.isFinite(options.limit ?? 50)
  )
    throw Error("Pagination values must be finite");
  return {
    offset: Math.max(0, Math.floor(options.offset ?? 0)),
    limit: Math.max(1, Math.min(1000, Math.floor(options.limit ?? 50))),
  };
}
export function page<T>(
  items: readonly T[],
  options: PageOptions = {},
): HistoryPage<T> {
  const { offset, limit } = pageOptions(options);
  return structuredClone({
    items: items.slice(offset, offset + limit),
    nextOffset: offset + limit < items.length ? offset + limit : null,
  });
}
export async function collectPages<T>(
  read: (options: PageOptions) => Promise<HistoryPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const result = await read({ offset });
    items.push(...result.items);
    if (result.nextOffset === null) return items;
    offset = result.nextOffset;
  }
}

/** Aggregate complete seed records without requiring applications to reconstruct candidates. */
export function aggregateCandidates(
  records: import("./contracts.js").EvaluationRecord[],
): import("./operation.js").CandidateResult[] {
  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const group = groups.get(record.candidateId) ?? [];
    group.push(record);
    groups.set(record.candidateId, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([candidateId, rows]) => {
      const average = (field: "metrics" | "constraints") =>
        Object.fromEntries(
          Object.keys(rows[0][field]).map((key) => [
            key,
            rows.reduce((n, r) => n + (r[field][key] ?? 0), 0) / rows.length,
          ]),
        );
      const constraints = average("constraints");
      return {
        candidateId,
        decisions: rows[0].decisions,
        metrics: average("metrics"),
        constraints,
        seedCount: rows.length,
        feasible:
          rows.every((r) => r.status === "completed") &&
          Object.values(constraints).every((v) => v <= 0),
      };
    });
}
