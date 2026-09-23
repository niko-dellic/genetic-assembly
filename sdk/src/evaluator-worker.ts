import type { StudyInput, Decisions, Measurement } from "./contracts.js";
import type { StudyModel, EvaluationContext, ReplayDataset } from "./model.js";
import { defineStudy } from "./model.js";
/** Structural worker port supported by browser Workers and Node worker_threads. */
export interface EvaluatorWorker {
  postMessage(value: unknown): void;
  terminate(): unknown;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (value: any) => void): void;
}
/** Use an explicit worker factory. No function is stringified or sent across the boundary. */
export function defineWorkerStudy(
  spec: StudyInput,
  createWorker: () => EvaluatorWorker,
  hooks: Pick<StudyModel, "repair" | "validate" | "materialize"> = {},
): StudyModel {
  return defineStudy({
    ...spec,
    ...hooks,
    evaluate(decisions, inputs, context) {
      return new Promise<Measurement>((resolve, reject) => {
        context.signal.throwIfAborted();
        const worker = createWorker();
        let settled = false;
        const finish = (
          error?: unknown,
          value?: Measurement,
          datasets: ReplayDataset[] = [],
        ) => {
          if (settled) return;
          settled = true;
          context.signal.removeEventListener("abort", abort);
          void worker.terminate();
          if (error) {
            reject(error);
            return;
          }
          try {
            for (const dataset of datasets) context.retainDataset(dataset);
            resolve(value!);
          } catch (error) {
            reject(error);
          }
        };
        const abort = () =>
          finish(
            context.signal.reason ??
              new DOMException("Cancelled", "AbortError"),
          );
        const message = (data: any) =>
          data.error
            ? finish(Error(data.error))
            : finish(undefined, data.measurement, data.datasets);
        if (worker.addEventListener) {
          worker.addEventListener("message", (event) => message(event.data));
          worker.addEventListener("error", (event) =>
            finish(Error(event.message)),
          );
        } else if (worker.on) {
          worker.on("message", message);
          worker.on("error", finish);
          worker.on("exit", (code) => {
            if (!settled) finish(Error(`Evaluator worker exited (${code})`));
          });
        } else {
          finish(Error("Unsupported evaluator worker port"));
          return;
        }
        context.signal.addEventListener("abort", abort, { once: true });
        worker.postMessage({
          decisions,
          inputs,
          seed: context.seed,
          phase: context.phase,
          retainReplay: context.retainReplay,
        });
      });
    },
  });
}
export interface EvaluationWorkerPort {
  postMessage(value: unknown): void;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (value: any) => void): void;
}
/** Install in your own module worker, importing the evaluator normally in that module. */
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
        signal: new AbortController().signal,
        retainReplay: data.retainReplay,
        retainDataset(dataset) {
          datasets.push(dataset);
        },
      });
      port.postMessage({ measurement, datasets });
    } catch (error) {
      port.postMessage({ error: String(error) });
    }
  };
  if (port.addEventListener)
    port.addEventListener("message", (event) => {
      void receive(event.data);
    });
  else if (port.on)
    port.on("message", (data) => {
      void receive(data);
    });
  else throw Error("Unsupported evaluator worker port");
}
