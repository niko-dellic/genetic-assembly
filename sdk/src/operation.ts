import type { Decisions, EvaluationRecord } from "./contracts.js";
import type { ErrorDetail } from "./errors.js";
import type { SolverProgress, SolverResult } from "./solver.js";
import type {
  PageOptions,
  HistoryPage,
  OperationEvent,
  GenerationSnapshot,
} from "./observation.js";
export interface RunOptions {
  populationSize?: number;
  generations?: number;
  seed?: number;
  validate?: boolean;
  evaluationConcurrency?: number;
}
export interface CandidateResult {
  candidateId: string;
  decisions: Decisions;
  metrics: Record<string, number>;
  constraints: Record<string, number>;
  seedCount: number;
  feasible: boolean;
}
export interface OptimizationResults {
  search: SolverResult;
  validated: CandidateResult[];
  validatedFront: CandidateResult[];
}
export interface OperationStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  errorDetail?: ErrorDetail;
  progress?: SolverProgress;
}

export interface HistoryOptions extends PageOptions {
  phase?: string;
  status?: string;
  candidateId?: string;
}
/** Shared lifecycle for local and durable service operations. Aborting observation never cancels work. */
export interface OperationHandle<T> {
  readonly id: string;
  status(): Promise<OperationStatus>;
  cancel(): Promise<OperationStatus>;
  wait(signal?: AbortSignal): Promise<OperationStatus>;
  completed(signal?: AbortSignal): Promise<T>;
  results(): Promise<T>;
  history(options?: HistoryOptions): Promise<HistoryPage<EvaluationRecord>>;
  generations(options?: PageOptions): Promise<HistoryPage<GenerationSnapshot>>;
  events(options?: {
    after?: number;
    signal?: AbortSignal;
  }): AsyncIterable<OperationEvent>;
}
/** Search operations add candidate aggregates to the shared lifecycle. */
export interface OptimizationHandle extends OperationHandle<OptimizationResults> {
  candidates(
    options?: PageOptions & { phase?: string; generation?: number },
  ): Promise<HistoryPage<CandidateResult>>;
}
export function concurrencyOption(value = 1): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64)
    throw Error("evaluationConcurrency must be between 1 and 64");
  return value;
}
export function runOptions(
  options: RunOptions = {},
  defaultConcurrency = 1,
): Required<RunOptions> {
  const result = {
    populationSize: 32,
    generations: 20,
    seed: 42,
    validate: true,
    ...options,
    evaluationConcurrency: concurrencyOption(
      options.evaluationConcurrency ?? defaultConcurrency,
    ),
  };
  // Explicit undefined has the same meaning as omission.
  result.populationSize ??= 32;
  result.generations ??= 20;
  result.seed ??= 42;
  result.validate ??= true;
  if (!Number.isSafeInteger(result.populationSize) || result.populationSize < 2)
    throw Error("populationSize must be an integer of at least 2");
  if (!Number.isSafeInteger(result.generations) || result.generations < 0)
    throw Error("generations must be a nonnegative integer");
  if (!Number.isSafeInteger(result.seed) || result.seed < 0)
    throw Error("seed must be a nonnegative safe integer");
  if (typeof result.validate !== "boolean")
    throw Error("validate must be a boolean");
  return result;
}
/** Interrupt observation, cleaning up its listener without cancelling the operation. */
export async function observe<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let abort!: () => void;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
