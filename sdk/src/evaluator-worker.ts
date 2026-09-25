import type { StudyInput, Decisions, Measurement } from "./contracts.js";
import type { StudyModel, EvaluationContext, ReplayDataset } from "./model.js";
import { defineStudy } from "./model.js";
import { OptimizationError, errorDetail } from "./errors.js";
export interface EvaluatorWorker {
  postMessage(value: unknown): void;
  terminate(): unknown;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (value: any) => void): void;
}
type Factory = () => EvaluatorWorker;
type Job = {
  id: number;
  decisions: Decisions;
  inputs: unknown;
  context: EvaluationContext;
  resolve: (value: Measurement) => void;
  reject: (error: unknown) => void;
  abort: () => void;
};
type Slot = { worker: EvaluatorWorker; job?: Job };
const definitions = new WeakMap<
  StudyModel,
  { factory: Factory; mode: "pooled" | "isolated" }
>();
/** Owned by one optimizer and one study. Never shares module state between studies. */
export class EvaluatorPool {
  private slots = new Set<Slot>();
  private queue: Job[] = [];
  private sequence = 0;
  private closed = false;
  constructor(
    private factory: Factory,
    readonly concurrency: number,
    private isolated = false,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 64
    )
      throw Error("Invalid evaluator concurrency");
  }
  evaluate(
    decisions: Decisions,
    inputs: unknown,
    context: EvaluationContext,
  ): Promise<Measurement> {
    if (this.closed)
      return Promise.reject(
        new DOMException("Evaluator pool disposed", "AbortError"),
      );
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.sequence,
        decisions,
        inputs,
        context,
        resolve,
        reject,
        abort: () => {
          const slot = [...this.slots].find((s) => s.job === job);
          this.queue = this.queue.filter((j) => j !== job);
          context.signal.removeEventListener("abort", job.abort);
          if (slot) this.retire(slot);
          reject(
            context.signal.reason ??
              new DOMException("Cancelled", "AbortError"),
          );
          this.pump();
        },
      };
      if (context.signal.aborted) {
        job.abort();
        return;
      }
      context.signal.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  private retire(slot: Slot) {
    this.slots.delete(slot);
    void slot.worker.terminate();
  }
  private finish(
    slot: Slot,
    error?: unknown,
    measurement?: Measurement,
    datasets: ReplayDataset[] = [],
  ) {
    const job = slot.job;
    if (!job) return;
    slot.job = undefined;
    job.context.signal.removeEventListener("abort", job.abort);
    if (error || this.isolated) this.retire(slot);
    if (error) job.reject(error);
    else
      try {
        for (const dataset of datasets) job.context.retainDataset(dataset);
        job.resolve(measurement!);
      } catch (error) {
        job.reject(error);
      }
    this.pump();
  }
  private create(): Slot {
    const slot: Slot = { worker: this.factory() };
    this.slots.add(slot);
    const message = (data: any) => {
      if (!slot.job || data.id !== slot.job.id) return;
      if (data.error) this.finish(slot, new OptimizationError(data.error));
      else if (!data.measurement)
        this.finish(
          slot,
          new OptimizationError({
            code: "WORKER_PROTOCOL",
            stage: "evaluation",
            message: "Evaluator returned no measurement",
          }),
        );
      else this.finish(slot, undefined, data.measurement, data.datasets);
    };
    const fail = (error: unknown) => {
      const detail = errorDetail(error, "evaluator-worker", {
        code: "WORKER_FAILED",
        seed: slot.job?.context.seed,
      });
      if (slot.job) this.finish(slot, new OptimizationError(detail));
      else this.retire(slot);
    };
    if (slot.worker.addEventListener) {
      slot.worker.addEventListener("message", (e) => message(e.data));
      slot.worker.addEventListener("error", (e) =>
        fail(
          new Error(e.message || "Evaluator worker could not load or crashed"),
        ),
      );
      slot.worker.addEventListener("messageerror", () =>
        fail(new Error("Evaluator response could not be decoded")),
      );
    } else if (slot.worker.on) {
      slot.worker.on("message", message);
      slot.worker.on("error", fail);
      slot.worker.on("exit", (code) => {
        if (this.slots.has(slot)) fail(new Error(`Evaluator exited (${code})`));
      });
    } else {
      this.retire(slot);
      throw Error("Unsupported evaluator worker port");
    }
    return slot;
  }
  private pump() {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = [...this.slots].find((s) => !s.job);
      if (!slot && this.slots.size >= this.concurrency) return;
      const job = this.queue.shift()!;
      try {
        slot ??= this.create();
        slot.job = job;
        slot.worker.postMessage({
          id: job.id,
          decisions: job.decisions,
          inputs: job.inputs,
          seed: job.context.seed,
          phase: job.context.phase,
          directory: job.context.directory,
          retainReplay: job.context.retainReplay,
        });
      } catch (error) {
        if (slot?.job === job) this.finish(slot, error);
        else {
          job.context.signal.removeEventListener("abort", job.abort);
          job.reject(
            new OptimizationError(
              errorDetail(error, "evaluator-startup", {
                code: "WORKER_STARTUP",
              }),
            ),
          );
        }
      }
    }
  }
  dispose() {
    this.closed = true;
    for (const job of [
      ...this.queue,
      ...[...this.slots].flatMap((s) => (s.job ? [s.job] : [])),
    ])
      job.abort();
    for (const slot of this.slots) this.retire(slot);
  }
}
export function defineWorkerStudy(
  spec: StudyInput,
  createWorker: Factory,
  hooks: Pick<StudyModel, "repair" | "validate" | "materialize"> = {},
  options: { mode?: "pooled" | "isolated" } = {},
): StudyModel {
  const model = defineStudy({
    ...spec,
    ...hooks,
    async evaluate(decisions, inputs, context) {
      const pool = new EvaluatorPool(createWorker, 1, true);
      try {
        return await pool.evaluate(decisions, inputs, context);
      } finally {
        pool.dispose();
      }
    },
  });
  definitions.set(model, {
    factory: createWorker,
    mode: options.mode ?? "pooled",
  });
  return model;
}
/** @internal Bind worker definitions to an owning runtime, rather than the model singleton. */
export function bindWorkerStudy(
  model: StudyModel,
  concurrency: number,
): { model: StudyModel; dispose: () => void } {
  const definition = definitions.get(model);
  if (!definition) return { model, dispose: () => {} };
  const pool = new EvaluatorPool(
    definition.factory,
    concurrency,
    definition.mode === "isolated",
  );
  return {
    model: { ...model, evaluate: (d, i, c) => pool.evaluate(d, i, c) },
    dispose: () => pool.dispose(),
  };
}
export interface EvaluationWorkerPort {
  postMessage(value: unknown): void;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (value: any) => void): void;
}
export function serveEvaluator(
  evaluate: (
    decisions: Decisions,
    inputs: unknown,
    context: EvaluationContext,
  ) => Measurement | Promise<Measurement>,
  port: EvaluationWorkerPort = globalThis as unknown as EvaluationWorkerPort,
) {
  const receive = async (data: any) => {
    try {
      const datasets: ReplayDataset[] = [];
      const measurement = await evaluate(data.decisions, data.inputs, {
        seed: data.seed,
        phase: data.phase,
        directory: data.directory,
        signal: new AbortController().signal,
        retainReplay: data.retainReplay,
        retainDataset(dataset) {
          datasets.push(dataset);
        },
      });
      port.postMessage({ id: data.id, measurement, datasets });
    } catch (error) {
      port.postMessage({
        id: data.id,
        error: errorDetail(error, "evaluation", { seed: data.seed }),
      });
    }
  };
  if (port.addEventListener)
    port.addEventListener("message", (e) => {
      void receive(e.data);
    });
  else if (port.on)
    port.on("message", (data) => {
      void receive(data);
    });
  else throw Error("Unsupported evaluator worker port");
}
