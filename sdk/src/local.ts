import { OptimizationError, errorDetail, type ErrorDetail } from "./errors.js";
import {
  page,
  type PageOptions,
  type OperationEvent,
  type GenerationSnapshot,
} from "./observation.js";
import { bindWorkerStudy } from "./evaluator-worker.js";
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
export interface LocalResults {
  search: SolverResult;
  validated: CandidateResult[];
  validatedFront: CandidateResult[];
}
export interface LocalStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  errorDetail?: ErrorDetail;
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
export class LocalRunHandle<T = LocalResults> {
  readonly id = crypto.randomUUID();
  engineVersion?: string;
  readonly controller = new AbortController();
  private state: LocalStatus = { id: this.id, status: "queued" };
  private listeners = new Set<(status: LocalStatus) => void>();
  private output?: T;
  private journal: OperationEvent[] = [];
  private snapshots: GenerationSnapshot[] = [];
  private candidateResults = new Map<string, CandidateResult>();
  private released = false;
  private active = 0;
  private queued = 0;
  private completion?: Promise<void>;
  constructor(
    readonly study: StudySpec,
    private store: MemoryStore,
    readonly kind: "search" | "baseline" | "replay" = "search",
  ) {
    this.store.retain(" ".repeat(8192));
  }
  /** @internal */ schedule(task: () => Promise<T>, queue: Promise<unknown>) {
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
            error: String(error).slice(0, 1024),
            errorDetail: Object.fromEntries(
              Object.entries(errorDetail(error, "operation")).map(
                ([key, value]) => [
                  key,
                  typeof value === "string" ? value.slice(0, 512) : value,
                ],
              ),
            ) as unknown as ErrorDetail,
          });
        }
      });
    return this.completion;
  }
  /** @internal */ update(update: Partial<LocalStatus>) {
    this.state = { ...this.state, ...update };
    if (
      update.status &&
      ["completed", "failed", "cancelled"].includes(update.status)
    ) {
      if (
        this.journal.some((event) =>
          ["completed", "failed", "cancelled"].includes(event.type),
        )
      )
        return;
      this.active = 0;
      this.queued = 0;
      this.emit(
        {
          type: update.status as "completed" | "failed" | "cancelled",
          ...(this.state.errorDetail ? { error: this.state.errorDetail } : {}),
        },
        true,
      );
    }
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(this.state));
      } catch {
        /* Observers cannot change execution. */
      }
    }
  }
  async status() {
    return structuredClone(this.state);
  }
  subscribe(listener: (status: LocalStatus) => void) {
    this.listeners.add(listener);
    try {
      listener(structuredClone(this.state));
    } catch {
      /* Observer errors are isolated. */
    }
    return () => {
      this.listeners.delete(listener);
    };
  }
  async cancel() {
    if (["completed", "failed", "cancelled"].includes(this.state.status))
      return;
    this.controller.abort();
    if (this.state.status === "queued") this.update({ status: "cancelled" });
  }
  /** @internal */
  release() {
    void this.cancel();
    this.released = true;
    this.journal = [];
    this.snapshots = [];
    this.candidateResults.clear();
    this.listeners.clear();
    this.output = undefined;
  }
  async wait() {
    await this.completion;
    const status = await this.status();
    if (status.status === "failed")
      throw new OptimizationError(
        status.errorDetail ?? errorDetail(status.error, "operation"),
      );
    return status;
  }
  async completed() {
    await this.wait();
    return this.results();
  }
  async results() {
    if (!this.output) throw Error("Results are not available");
    return structuredClone(this.output);
  }
  /** @internal */ snapshotObservation() {
    return structuredClone({
      events: this.journal,
      generations: this.snapshots,
      candidates: [...this.candidateResults].map(([key, value]) => ({
        phase: key.split(":")[0],
        ...value,
      })),
    });
  }
  async history(options: PageOptions = {}) {
    return page(this.store.history(this.id), options);
  }
  async generations(options: PageOptions = {}) {
    return page(this.snapshots, options);
  }
  async candidates(
    options: PageOptions & { phase?: string; generation?: number } = {},
  ) {
    const ids =
      options.generation === undefined
        ? undefined
        : new Set(
            this.snapshots
              .filter((s) => s.generation <= options.generation!)
              .flatMap((s) => s.evaluatedCandidateIds),
          );
    return page(
      [...this.candidateResults]
        .filter(([key]) => key.startsWith((options.phase ?? "search") + ":"))
        .map(([, value]) => value)
        .filter((value) => !ids || ids.has(value.candidateId))
        .sort((a, b) =>
          a.candidateId.localeCompare(b.candidateId, "en", { numeric: true }),
        ),
      options,
    );
  }
  /** @internal */ candidate(phase: string, value: CandidateResult) {
    this.store.retain(value);
    this.candidateResults.set(
      `${phase}:${value.candidateId}`,
      structuredClone(value),
    );
  }
  /** @internal */ queue(count: number) {
    this.queued = count;
  }
  /** @internal */ emit(
    event: Omit<
      OperationEvent,
      "sequence" | "operationId" | "active" | "queued"
    >,
    terminal = false,
  ) {
    if (this.released) return;
    if (event.type === "evaluation-started") {
      this.active++;
      this.queued = Math.max(0, this.queued - 1);
    }
    if (
      event.type === "evaluation-completed" ||
      event.type === "evaluation-failed"
    )
      this.active = Math.max(0, this.active - 1);
    const entry = {
      ...event,
      sequence: this.journal.length + 1,
      operationId: this.id,
      active: this.active,
      queued: this.queued,
    };
    if (!terminal) this.store.retain(entry);
    this.journal.push(structuredClone(entry));
  }
  /** @internal */ snapshot(
    progress: SolverProgress,
    batch: string[],
    population: SolverIndividual[],
  ) {
    const candidates = [...this.candidateResults]
      .filter(([key]) => key.startsWith("search:"))
      .map(([, value]) => value)
      .filter((c) => c.feasible)
      .sort((a, b) =>
        a.candidateId.localeCompare(b.candidateId, "en", { numeric: true }),
      );
    const snapshot: GenerationSnapshot = {
      generation: progress.generation,
      summary: progress,
      evaluatedCandidateIds: batch,
      population: population.map((c) => ({
        candidateId: String(c.id),
        rank: c.rank,
        crowdingDistance: c.crowding_distance,
      })),
      paretoCandidateIds: population
        .filter((c) => c.rank === 0 && c.constraint_violation <= 0)
        .map((c) => String(c.id)),
      discoveredParetoCandidateIds: candidates
        .filter(
          (c) => !candidates.some((other) => dominates(this.study, other, c)),
        )
        .map((c) => c.candidateId),
    };
    const event = {
      type: "generation-completed" as const,
      phase: "search" as const,
      generation: progress.generation,
    };
    this.store.retain({
      snapshot,
      event: {
        ...event,
        sequence: this.journal.length + 1,
        operationId: this.id,
        active: this.active,
        queued: this.queued,
      },
    });
    this.snapshots.push(structuredClone(snapshot));
    this.emit(event, true);
  }
  async *events(
    options: { after?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<OperationEvent> {
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw Error("Invalid event cursor");
    for (;;) {
      options.signal?.throwIfAborted();
      for (const event of this.journal.filter((e) => e.sequence > cursor)) {
        cursor = event.sequence;
        yield structuredClone(event);
      }
      if (
        this.released ||
        ["completed", "failed", "cancelled"].includes(this.state.status)
      )
        return;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", abort);
          resolve();
        }, 25);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
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
  readonly runs = new Map<string, LocalRunHandle<any>>();
  private queue: Promise<unknown> = Promise.resolve();
  private modelIds = new WeakMap<StudyModel, string>();
  private cache = new Map<string, EvaluationRecord>();
  private controllers = new Set<AbortController>();
  private closed = false;
  private bindings = new Map<StudyModel, ReturnType<typeof bindWorkerStudy>>();
  private defaultConcurrency: number;
  private evaluator(model: StudyModel) {
    let binding = this.bindings.get(model);
    if (!binding) {
      binding = bindWorkerStudy(model, this.concurrency);
      this.bindings.set(model, binding);
    }
    return binding.model;
  }
  constructor(
    private concurrency = 1,
    memoryLimitBytes?: number,
    private solverWorkerFactory?: import("./solver.js").SolverWorkerFactory,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 64
    )
      throw Error("evaluationConcurrency must be between 1 and 64");
    this.defaultConcurrency = concurrency;
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
    const operation = this.runs.get(ownerId);
    for (const seed of seeds) {
      signal.throwIfAborted();
      const cacheKey = await digest({
        model: this.modelIdentity(model),
        spec,
        decisions,
        seed,
        phase,
      });
      operation?.emit({ type: "evaluation-started", phase, candidateId, seed });
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
                this.evaluator(model).evaluate(
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
        record.errorDetail = errorDetail(error, "evaluation", {
          candidateId,
          seed,
        });
      }
      record.runtimeMs = performance.now() - started;
      if (dataset && record.status === "completed")
        record.datasetId = record.id;
      this.store.add(record, record.datasetId ? dataset : undefined);
      if (record.status === "completed" && phase === "search")
        this.cache.set(cacheKey, record);
      records.push(record);
      operation?.emit({
        type:
          record.status === "failed"
            ? "evaluation-failed"
            : "evaluation-completed",
        phase,
        candidateId,
        seed,
        recordId: record.id,
        ...(record.error ? { error: record.errorDetail } : {}),
      });
      if (record.status === "failed")
        throw new OptimizationError(record.errorDetail!);
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
    const result = {
      candidateId,
      decisions,
      metrics,
      constraints,
      seedCount: records.length,
      feasible: Object.values(constraints).every((v) => v <= 0),
    } satisfies CandidateResult;
    operation?.candidate(phase, result);
    return result;
  }
  baseline(model: StudyModel, selected?: Decisions) {
    this.assertOpen();
    const spec = validateStudy(model);
    if (!this.studies.has(canonical(spec))) {
      this.store.retain(spec);
      this.studies.set(canonical(spec), spec);
    }
    const handle = new LocalRunHandle<CandidateResult>(
      spec,
      this.store,
      selected ? "replay" : "baseline",
    );
    this.runs.set(handle.id, handle);
    const ownerId = handle.id,
      controller = handle.controller;
    const operation = handle.schedule(async () => {
      handle.queue(spec.searchSeeds.length);
      handle.emit({ type: "phase", phase: selected ? "replay" : "baseline" });
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
    }, this.queue);
    this.queue = operation;
    return handle;
  }
  run(model: StudyModel, options: LocalRunOptions = {}) {
    this.assertOpen();
    const concurrency =
      options.evaluationConcurrency ?? this.defaultConcurrency;
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 64
    )
      throw Error("evaluationConcurrency must be between 1 and 64");
    const spec = validateStudy(model);
    if (!this.studies.has(canonical(spec))) {
      this.store.retain(spec);
      this.studies.set(canonical(spec), spec);
    }
    const handle = new LocalRunHandle(spec, this.store);
    this.store.retain({ id: handle.id, options });
    this.runs.set(handle.id, handle);
    this.queue = handle.schedule(async () => {
      if (this.concurrency !== concurrency) {
        for (const binding of this.bindings.values()) binding.dispose();
        this.bindings.clear();
        this.concurrency = concurrency;
      }
      const solver = new SolverWorker(this.solverWorkerFactory),
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
        handle.emit({ type: "phase", phase: "search" });
        while (true) {
          signal.throwIfAborted();
          const batch = await solver.call<SolverCandidate[] | null>({
            op: "ask",
          });
          if (!batch) break;
          handle.queue(batch.length * spec.searchSeeds.length);
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
          const snapshot = await solver.call<SolverResult>({ op: "snapshot" });
          handle.snapshot(
            progress,
            batch.map((c) => String(c.id)),
            snapshot.final_population,
          );
          handle.update({ progress });
        }
        const search = await solver.call<SolverResult>({ op: "result" });
        // Checkpoints are service-only; local sessions export evidence, never resumable execution.
        delete (search as SolverResult & { checkpoint?: unknown }).checkpoint;
        const validated: CandidateResult[] = [];
        if (options.validate !== false) {
          handle.queue(
            search.pareto_front.length * spec.validationSeeds.length,
          );
          handle.emit({ type: "phase", phase: "validation" });
        }
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
    for (const binding of this.bindings.values()) binding.dispose();
    this.bindings.clear();
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
