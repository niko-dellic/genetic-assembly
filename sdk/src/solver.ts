/** Ordered transport types at the Rust solver boundary. */
export interface SolverCandidate {
  id: number;
  genes: number[];
}
export interface SolverEvaluation extends SolverCandidate {
  evaluation: { objectives: number[]; constraints: number[] };
}
export interface SolverIndividual extends SolverCandidate {
  objectives: number[];
  constraints: number[];
  constraint_violation: number;
  rank: number;
  crowding_distance: number | null;
}
export interface SolverResult {
  generations: number;
  evaluations: number;
  pareto_front: SolverIndividual[];
  final_population: SolverIndividual[];
}
export interface SolverProgress {
  generation: number;
  evaluations: number;
  pareto_size: number;
  feasible_count: number;
  infeasible_count: number;
}
/** Instantiates a separate solver worker per run; never executes model code. */
export class SolverWorker {
  private worker?: Worker | import("node:worker_threads").Worker;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  private sequence = 0;
  private closed = false;
  async start() {
    if (this.closed) throw Error("Solver disposed");
    if (typeof process !== "undefined" && process.versions?.node) {
      const moduleName = "node:worker_threads";
      const { Worker: NodeWorker } = await import(
        /* @vite-ignore */ moduleName
      );
      if (this.closed) throw Error("Solver disposed");
      this.worker = new NodeWorker(
        new URL(/* @vite-ignore */ "./solver-node-worker.js", import.meta.url),
        { execArgv: [] },
      );
      (this.worker as import("node:worker_threads").Worker).on(
        "message",
        (data) => this.receive(data),
      );
      (this.worker as import("node:worker_threads").Worker).on(
        "error",
        (error) => this.fail(error),
      );
      (this.worker as import("node:worker_threads").Worker).on(
        "exit",
        (code) => {
          if (!this.closed) this.fail(Error(`Solver worker exited (${code})`));
        },
      );
    } else {
      const worker = new Worker(
        new URL("./solver-browser-worker.js", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event) => this.receive(event.data);
      worker.onerror = (event) => this.fail(Error(event.message));
      this.worker = worker;
    }
  }
  private receive(data: { id: number; value?: unknown; error?: string }) {
    const promise = this.pending.get(data.id);
    this.pending.delete(data.id);
    if (data.error) promise?.reject(Error(data.error));
    else promise?.resolve(data.value);
  }
  private fail(error: Error) {
    for (const promise of this.pending.values()) promise.reject(error);
    this.pending.clear();
  }
  call<T>(command: unknown): Promise<T> {
    if (this.closed || !this.worker)
      return Promise.reject(Error("Solver is not running"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, command });
    });
  }
  dispose() {
    this.closed = true;
    this.fail(new DOMException("Solver disposed", "AbortError"));
    void this.worker?.terminate();
    this.worker = undefined;
  }
}
