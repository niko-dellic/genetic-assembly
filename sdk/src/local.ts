import {
  canonical,
  type Decisions,
  type EvaluationRecord,
  type StudySpec,
} from "./contracts.js";
import {
  baselineDecisions,
  compileStudy,
  decodeDecisions,
  encodeDecisions,
  validateStudy,
} from "./study.js";
import {
  mapMeasurements,
  repairDesign,
  type ReplayDataset,
  type StudyModel,
} from "./model.js";
import { MemoryStore } from "./memory.js";
import {
  SolverWorker,
  type SolverCandidate,
  type SolverEvaluation,
  type SolverIndividual,
  type SolverProgress,
  type SolverResult,
} from "./solver.js";
export interface LocalRunOptions {
  populationSize?: number;
  generations?: number;
  seed?: number;
  validate?: boolean;
}
export interface CandidateResult {
  candidateId: string;
  decisions: Decisions;
  metrics: Record<string, number>;
  constraints: Record<string, number>;
  seedCount: number;
  feasible: boolean;
}
export interface LocalResults {
  search: SolverResult;
  validated: CandidateResult[];
  validatedFront: CandidateResult[];
}
export interface LocalStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  progress?: SolverProgress;
}
export async function digest(value: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export class LocalRunHandle {
  readonly id = crypto.randomUUID();
  engineVersion?: string;
  readonly controller = new AbortController();
  private state: LocalStatus = { id: this.id, status: "queued" };
  private listeners = new Set<(status: LocalStatus) => void>();
  private output?: LocalResults;
  private completion?: Promise<void>;
  constructor(
    readonly study: StudySpec,
    private store: MemoryStore,
  ) {}
  /** @internal */ schedule(
    task: () => Promise<LocalResults>,
    queue: Promise<unknown>,
  ) {
    this.completion = queue
      .catch(() => {})
      .then(async () => {
        if (this.controller.signal.aborted) {
          this.update({ status: "cancelled" });
          return;
        }
        this.update({ status: "running" });
        try {
          this.output = await task();
          this.update({
            status: this.controller.signal.aborted ? "cancelled" : "completed",
          });
        } catch (error) {
          this.update({
            status: this.controller.signal.aborted ? "cancelled" : "failed",
            error: String(error),
          });
        }
      });
    return this.completion;
  }
  /** @internal */ update(update: Partial<LocalStatus>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) {
      try {
        listener(this.status());
      } catch {
        /* Observers cannot change execution. */
      }
    }
  }
  status() {
    return structuredClone(this.state);
  }
  subscribe(listener: (status: LocalStatus) => void) {
    this.listeners.add(listener);
    listener(this.status());
    return () => {
      this.listeners.delete(listener);
    };
  }
  cancel() {
    this.controller.abort();
    if (this.state.status === "queued") this.update({ status: "cancelled" });
  }
  /** @internal */
  release() {
    this.cancel();
    this.listeners.clear();
    this.output = undefined;
  }
  async wait() {
    await this.completion;
    const status = this.status();
    if (status.status === "failed") throw Error(status.error);
    return status;
  }
  results() {
    if (!this.output) throw Error("Results are not available");
    return structuredClone(this.output);
  }
  history() {
    return this.store.history(this.id);
  }
}
export class LocalRuntime {
  readonly store: MemoryStore;
  readonly materializations: {
    ownerId: string;
    candidateId: string;
    decisions: Decisions;
    value: unknown;
  }[] = [];
  readonly studies = new Map<string, StudySpec>();
  readonly runs = new Map<string, LocalRunHandle>();
  private queue: Promise<unknown> = Promise.resolve();
  private modelIds = new WeakMap<StudyModel, string>();
  private cache = new Map<string, EvaluationRecord>();
  private controllers = new Set<AbortController>();
  private closed = false;
  constructor(
    private concurrency = 1,
    memoryLimitBytes?: number,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 64
    )
      throw Error("evaluationConcurrency must be between 1 and 64");
    this.store = new MemoryStore(memoryLimitBytes);
  }
  private assertOpen() {
    if (this.closed) throw Error("Optimizer disposed");
  }
  private modelIdentity(model: StudyModel) {
    let id = this.modelIds.get(model);
    if (!id) {
      id = crypto.randomUUID();
      this.modelIds.set(model, id);
    }
    return id;
  }
  private async evaluate(
    model: StudyModel,
    spec: StudySpec,
    ownerId: string,
    candidateId: string,
    proposed: Decisions,
    phase: EvaluationRecord["phase"],
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const { decisions, repairs, invalid } = repairDesign(model, spec, proposed);
    const studyId = await digest(spec),
      designHash = await digest(decisions);
    const seeds =
      phase === "validation" ? spec.validationSeeds : spec.searchSeeds;
    const records: EvaluationRecord[] = [];
    for (const seed of seeds) {
      signal.throwIfAborted();
      const cacheKey = await digest({
        model: this.modelIdentity(model),
        spec,
        decisions,
        seed,
        phase,
      });
      const started = performance.now();
      let dataset: ReplayDataset | undefined;
      const record: EvaluationRecord = {
        id: await digest({ ownerId, candidateId, phase, seed }),
        ownerId,
        studyId,
        candidateId,
        designHash,
        phase,
        seed,
        decisions,
        status: "completed",
        metrics: {},
        constraints: {},
        warnings: [],
        repairs,
        cacheKey,
        cached: false,
        runtimeMs: 0,
      };
      try {
        if (invalid.length) {
          record.status = "invalid";
          record.warnings = invalid;
          record.constraints = { domain_validity: 1 };
        } else {
          const cached =
            phase === "search" ? this.cache.get(cacheKey) : undefined;
          if (cached) {
            record.metrics = cached.metrics;
            record.constraints = cached.constraints;
            record.warnings = cached.warnings;
            record.cached = true;
          } else {
            const mapped = mapMeasurements(
              spec,
              await abortable(
                model.evaluate(
                  structuredClone(decisions),
                  structuredClone(spec.inputs),
                  {
                    seed,
                    phase,
                    signal,
                    retainReplay: phase === "baseline" || phase === "replay",
                    retainDataset(value) {
                      signal.throwIfAborted();
                      if (phase !== "baseline" && phase !== "replay")
                        throw Error("Replay retention was not requested");
                      if (dataset)
                        throw Error(
                          "Only one dataset per evaluation is supported",
                        );
                      dataset = structuredClone(value);
                    },
                  },
                ),
                signal,
              ),
            );
            signal.throwIfAborted();
            record.metrics = mapped.metrics;
            record.constraints = mapped.constraints;
            record.warnings = mapped.warnings;
          }
        }
      } catch (error) {
        record.status = "failed";
        record.error = String(error);
      }
      record.runtimeMs = performance.now() - started;
      if (dataset && record.status === "completed")
        record.datasetId = record.id;
      this.store.add(record, record.datasetId ? dataset : undefined);
      if (record.status === "completed" && phase === "search")
        this.cache.set(cacheKey, record);
      records.push(record);
      if (record.status === "failed") throw Error(record.error);
    }
    const average = (field: "metrics" | "constraints") =>
      Object.fromEntries(
        Object.keys(records[0][field]).map((key) => [
          key,
          records.reduce((sum, r) => sum + r[field][key], 0) / records.length,
        ]),
      );
    const metrics = average("metrics"),
      constraints = average("constraints");
    return {
      candidateId,
      decisions,
      metrics,
      constraints,
      seedCount: records.length,
      feasible: Object.values(constraints).every((v) => v <= 0),
    } satisfies CandidateResult;
  }
  baseline(model: StudyModel, selected?: Decisions) {
    this.assertOpen();
    const spec = validateStudy(model);
    if (!this.studies.has(canonical(spec))) {
      this.store.retain(spec);
      this.studies.set(canonical(spec), spec);
    }
    const controller = new AbortController(),
      ownerId = crypto.randomUUID();
    this.controllers.add(controller);
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        try {
          const result = await this.evaluate(
            model,
            spec,
            ownerId,
            selected ? "selected" : "baseline",
            selected ?? baselineDecisions(spec),
            selected ? "replay" : "baseline",
            controller.signal,
          );
          if (model.materialize && result.feasible) {
            const value = await model.materialize(
              { ...result.decisions },
              structuredClone(spec.inputs),
            );
            const record = {
              ownerId,
              candidateId: result.candidateId,
              decisions: result.decisions,
              value: JSON.parse(canonical(value)),
            };
            this.store.retain(record);
            this.materializations.push(record);
          }
          return result;
        } finally {
          this.controllers.delete(controller);
        }
      });
    this.queue = operation;
    return operation;
  }
  run(model: StudyModel, options: LocalRunOptions = {}) {
    this.assertOpen();
    const spec = validateStudy(model);
    if (!this.studies.has(canonical(spec))) {
      this.store.retain(spec);
      this.studies.set(canonical(spec), spec);
    }
    const handle = new LocalRunHandle(spec, this.store);
    this.store.retain({ id: handle.id, options });
    this.runs.set(handle.id, handle);
    this.queue = handle.schedule(async () => {
      const solver = new SolverWorker(),
        signal = handle.controller.signal;
      const cancel = () => solver.dispose();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await solver.start();
        signal.throwIfAborted();
        const engine = await solver.call<{ engineVersion: string }>({
          op: "init",
          problem: compileStudy(spec).problem,
          config: {
            population_size: options.populationSize ?? 32,
            generations: options.generations ?? 20,
            seed: options.seed ?? 42,
          },
        });
        handle.engineVersion = engine.engineVersion;
        while (true) {
          signal.throwIfAborted();
          const batch = await solver.call<SolverCandidate[] | null>({
            op: "ask",
          });
          if (!batch) break;
          const evaluated = new Array<SolverEvaluation>(batch.length);
          const batchController = new AbortController();
          const batchSignal = AbortSignal.any([signal, batchController.signal]);
          let index = 0;
          const outcomes = await Promise.allSettled(
            Array.from(
              { length: Math.min(this.concurrency, batch.length) },
              async () => {
                while (index < batch.length) {
                  const position = index++,
                    candidate = batch[position];
                  const value = await this.evaluate(
                    model,
                    spec,
                    handle.id,
                    String(candidate.id),
                    decodeDecisions(spec, candidate.genes),
                    "search",
                    batchSignal,
                  ).catch((error) => {
                    batchController.abort(error);
                    throw error;
                  });
                  evaluated[position] = {
                    id: candidate.id,
                    genes: encodeDecisions(spec, value.decisions),
                    evaluation: {
                      objectives: Object.values(spec.objectives).map(
                        (goal) => value.metrics[goal.metric] ?? 0,
                      ),
                      constraints: [
                        ...Object.keys(spec.constraints).map(
                          (key) => value.constraints[key] ?? 0,
                        ),
                        value.constraints.domain_validity,
                      ],
                    },
                  };
                }
              },
            ),
          );
          const failed = outcomes.find(
            (outcome) => outcome.status === "rejected",
          );
          if (failed?.status === "rejected") throw failed.reason;
          const progress = await solver.call<SolverProgress>({
            op: "tell",
            candidates: evaluated,
          });
          handle.update({ progress });
        }
        const search = await solver.call<SolverResult>({ op: "result" });
        // Checkpoints are service-only; local sessions export evidence, never resumable execution.
        delete (search as SolverResult & { checkpoint?: unknown }).checkpoint;
        const validated: CandidateResult[] = [];
        if (options.validate !== false)
          for (const candidate of search.pareto_front) {
            validated.push(
              await this.evaluate(
                model,
                spec,
                handle.id,
                String(candidate.id),
                decodeDecisions(spec, candidate.genes),
                "validation",
                signal,
              ),
            );
          }
        const result = {
          search,
          validated,
          validatedFront: validated.filter(
            (candidate) =>
              candidate.constraints.domain_validity <= 0 &&
              !validated.some(
                (other) =>
                  other.constraints.domain_validity <= 0 &&
                  dominates(spec, other, candidate),
              ),
          ),
        };
        this.store.retain(result);
        return result;
      } finally {
        signal.removeEventListener("abort", cancel);
        solver.dispose();
      }
    }, this.queue);
    return handle;
  }
  dispose() {
    this.closed = true;
    for (const run of this.runs.values()) run.release();
    this.runs.clear();
    for (const controller of this.controllers) controller.abort();
    this.cache.clear();
    this.store.clear();
    this.materializations.length = 0;
    this.studies.clear();
  }
}
function dominates(spec: StudySpec, a: CandidateResult, b: CandidateResult) {
  const violation = (candidate: CandidateResult) =>
    Object.values(candidate.constraints).reduce(
      (sum, v) => sum + Math.max(0, v),
      0,
    );
  const av = violation(a),
    bv = violation(b);
  const epsilon = 1e-12;
  if (av > 0 || bv > 0) return av + epsilon < bv;
  const differences = Object.values(spec.objectives).map(
    (goal) =>
      (a.metrics[goal.metric] - b.metrics[goal.metric]) *
      (goal.direction === "minimize" ? 1 : -1),
  );
  return (
    differences.every((value) => value <= epsilon) &&
    differences.some((value) => value < -epsilon)
  );
}

function abortable<T>(value: T | Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) {
      signal.removeEventListener("abort", abort);
      abort();
    }
  });
}
