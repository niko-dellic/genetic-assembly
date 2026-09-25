import { exportMemory } from "./archive.js";
import { StudyClient, type RunHandle, type JobHandle } from "./index.js";
import type { Decisions, Job, PreparedStudy } from "./contracts.js";
import type { StudyModel } from "./model.js";
import {
  LocalRuntime,
  type CandidateResult,
  type LocalRunHandle,
  type LocalRunOptions,
} from "./local.js";
export type Execution = "local" | "service";
export type OptimizerOptions<M extends Execution> = M extends "service"
  ? { execution: "service"; url: string; token?: string }
  : {
      execution?: "local";
      storage?: "memory";
      evaluationConcurrency?: number;
      memoryLimitBytes?: number;
      solverWorkerFactory?: import("./solver.js").SolverWorkerFactory;
    };
type Model<M extends Execution> = M extends "service"
  ? PreparedStudy
  : StudyModel;
/** One entry point for in-memory optimization and prepared companion studies. */
export class Optimizer<M extends Execution = "local"> {
  private local?: LocalRuntime;
  private client?: StudyClient;
  private disposed = false;
  private observation = new AbortController();
  constructor(
    options: OptimizerOptions<M> & {
      execution?: M;
    } = {} as OptimizerOptions<M> & { execution?: M },
  ) {
    const settings: OptimizerOptions<Execution> = options;
    if (
      settings.execution &&
      !["local", "service"].includes(settings.execution)
    )
      throw Error("Unsupported execution mode");
    if (
      "storage" in settings &&
      settings.storage !== undefined &&
      settings.storage !== "memory"
    )
      throw Error("Local storage must be memory");
    if (settings.execution === "service")
      this.client = new StudyClient(
        settings.url,
        settings.token,
        this.observation.signal,
      );
    else
      this.local = new LocalRuntime(
        settings.evaluationConcurrency,
        settings.memoryLimitBytes,
        settings.solverWorkerFactory,
      );
  }
  private assertOpen() {
    if (this.disposed) throw Error("Optimizer disposed");
  }
  async baseline(
    study: Model<M>,
  ): Promise<
    M extends "service" ? JobHandle : LocalRunHandle<CandidateResult>
  > {
    this.assertOpen();
    return (
      this.client
        ? this.client.baseline(this.prepared(study))
        : this.local!.baseline(study as StudyModel)
    ) as any;
  }
  async run(
    study: Model<M>,
    options: LocalRunOptions = {},
  ): Promise<M extends "service" ? RunHandle : LocalRunHandle> {
    this.assertOpen();
    return (
      this.client
        ? this.client.run(this.prepared(study), {
            population_size: options.populationSize,
            generations: options.generations,
            seed: options.seed,
            threads: options.evaluationConcurrency,
          })
        : this.local!.run(study as StudyModel, options)
    ) as any;
  }
  async replay(
    study: Model<M>,
    decisions: Decisions,
  ): Promise<
    M extends "service" ? JobHandle : LocalRunHandle<CandidateResult>
  > {
    this.assertOpen();
    return (
      this.client
        ? this.client.replay(this.prepared(study), decisions)
        : this.local!.baseline(study as StudyModel, decisions)
    ) as any;
  }
  /** Local retained history; service history is paginated on the durable run handle. */
  history(ownerId?: string) {
    this.assertOpen();
    if (!this.local)
      throw Error("Use the service run handle for paginated history");
    return this.local.store.history(ownerId);
  }
  runHandle(id: string) {
    this.assertOpen();
    const run = this.local?.runs.get(id);
    if (!run) throw Error("Unknown local run");
    return run;
  }
  dataset(id: string) {
    this.assertOpen();
    if (!this.local) throw Error("Use service dataset resources");
    return this.local.store.dataset(id);
  }
  export() {
    this.assertOpen();
    if (!this.local)
      throw Error("Export service runs through their run handles");
    return exportMemory(
      this.local.store,
      this.local.runs.values(),
      this.local.studies.values(),
      this.local.materializations,
    );
  }
  get retainedBytes() {
    return this.local?.store.usageBytes ?? 0;
  }
  private prepared(study: Model<M>) {
    if (!("id" in study) || "evaluate" in study)
      throw Error("Service execution requires a prepared study reference");
    return study.id;
  }
  /** Cancels owned local work. Durable service jobs continue until explicitly cancelled. */
  dispose() {
    this.disposed = true;
    this.observation.abort();
    this.local?.dispose();
  }
}
