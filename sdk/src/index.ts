import {
  collectPages,
  aggregateCandidates,
  page,
  type PageOptions,
  type GenerationSnapshot,
  type OperationEvent,
} from "./observation.js";
import { OptimizationError, errorDetail } from "./errors.js";
export * from "./contracts.js";
export * from "./study.js";
import { compileStudy, validateStudy } from "./study.js";
import type {
  StudyInput,
  Runtime,
  PreparedStudy,
  RunConfig,
  RunStatus,
  EvaluationRecord,
  Page,
  Job,
  Decisions,
  DatasetReference,
} from "./contracts.js";
export class ApiError extends OptimizationError {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super({ code: "SERVICE_HTTP", stage: "service", message });
  }
}
/** Browser-safe study client. Models execute in the companion, never in the browser. */
export class StudyClient {
  constructor(
    public baseUrl = "http://127.0.0.1:3001",
    private token?: string,
    private observationSignal?: AbortSignal,
  ) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    if (init.body && typeof init.body === "string")
      headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        ...init,
        headers,
        signal: AbortSignal.any(
          [init.signal, this.observationSignal].filter(
            (signal): signal is AbortSignal => !!signal,
          ),
        ),
      });
    } catch (error) {
      if (init.signal?.aborted || this.observationSignal?.aborted) throw error;
      throw new OptimizationError(
        errorDetail(error, "service-connection", {
          code: "SERVICE_CONNECT",
          asset: this.baseUrl + path,
        }),
      );
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok)
        throw new OptimizationError({
          code: "SERVICE_PROTOCOL",
          stage: "service-protocol",
          message: "Companion returned a non-JSON response",
          asset: this.baseUrl + path,
        });
      body = text;
    }
    if (!response.ok)
      throw new ApiError(
        typeof body === "object" && body && "error" in body
          ? String(body.error)
          : text,
        response.status,
        body,
      );
    return body as T;
  }
  /** Register a self-contained immutable model snapshot and compile its named decisions. */
  prepare(input: StudyInput, runtime: Runtime): Promise<PreparedStudy> {
    const spec = validateStudy(input);
    return this.request("/v3/studies", {
      method: "POST",
      body: JSON.stringify({ spec, runtime, bundle: compileStudy(spec) }),
    });
  }
  studies(offset = 0): Promise<Page<PreparedStudy>> {
    return this.request(`/v3/studies?offset=${offset}`);
  }
  study(id: string): Promise<PreparedStudy> {
    return this.request(`/v3/studies/${encodeURIComponent(id)}`);
  }
  async run(studyId: string, config: RunConfig = {}): Promise<RunHandle> {
    const status = await this.request<RunStatus>(
      `/v3/studies/${studyId}/runs`,
      { method: "POST", body: JSON.stringify(config) },
    );
    return this.runHandle(status.id);
  }
  runHandle(id: string) {
    return new RunHandle(this, id, this.observationSignal);
  }
  runs(studyId: string, offset = 0): Promise<Page<RunStatus>> {
    return this.request(`/v3/studies/${studyId}/runs?offset=${offset}`);
  }
  history(
    ownerId: string,
    options: {
      offset?: number;
      phase?: string;
      status?: string;
      candidateId?: string;
    } = {},
  ): Promise<Page<EvaluationRecord>> {
    return this.request(
      `/v3/history/${ownerId}?` +
        new URLSearchParams(
          Object.entries(options)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ),
    );
  }
  async baseline(studyId: string): Promise<JobHandle> {
    const job = await this.request<Job>(`/v3/studies/${studyId}/jobs`, {
      method: "POST",
      body: JSON.stringify({ kind: "baseline" }),
    });
    return new JobHandle(this, job.id, this.observationSignal);
  }
  async replay(studyId: string, decisions: Decisions): Promise<JobHandle> {
    const job = await this.request<Job>(`/v3/studies/${studyId}/jobs`, {
      method: "POST",
      body: JSON.stringify({ kind: "replay", decisions }),
    });
    return new JobHandle(this, job.id, this.observationSignal);
  }
  jobs(studyId: string, offset = 0): Promise<Page<Job>> {
    return this.request(`/v3/studies/${studyId}/jobs?offset=${offset}`);
  }
  job(id: string): Promise<Job> {
    return this.request(`/v3/jobs/${id}`);
  }
  cancelJob(id: string): Promise<Job> {
    return this.request(`/v3/jobs/${id}/cancel`, { method: "POST" });
  }
  async waitJob(id: string, signal?: AbortSignal): Promise<Job> {
    for (;;) {
      signal?.throwIfAborted();
      const job = await this.job(id);
      if (["completed", "failed", "cancelled"].includes(job.status)) return job;
      await delay(signal);
    }
  }
  datasets(ownerId: string): Promise<DatasetReference[]> {
    return this.request(`/v3/datasets?ownerId=${encodeURIComponent(ownerId)}`);
  }
  async datasetResource(id: string, key: string): Promise<Uint8Array> {
    const response = await fetch(
      this.datasetUrl(id) + key.split("/").map(encodeURIComponent).join("/"),
      { headers: this.token ? { authorization: `Bearer ${this.token}` } : {} },
    );
    if (!response.ok)
      throw new ApiError(await response.text(), response.status, null);
    return new Uint8Array(await response.arrayBuffer());
  }
  datasetUrl(id: string) {
    return `${this.baseUrl}/v3/datasets/${encodeURIComponent(id)}/resources/`;
  }
}
const delay = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 250);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
/** Durable run handle; stopping observation is separate from cancelling computation. */
export class RunHandle {
  constructor(
    protected client: StudyClient,
    public id: string,
    protected observationSignal?: AbortSignal,
  ) {}
  async status(): Promise<RunStatus> {
    const state = await this.client.request<RunStatus>(`/v3/runs/${this.id}`);
    if (state.status === "failed")
      state.errorDetail =
        (await this.history({ status: "failed" })).items.find(
          (record) => record.errorDetail,
        )?.errorDetail ?? errorDetail(state.error, "service");
    return state;
  }
  cancel(): Promise<RunStatus> {
    return this.client.request(`/v3/runs/${this.id}/cancel`, {
      method: "POST",
    });
  }
  async wait(signal?: AbortSignal): Promise<RunStatus> {
    signal = AbortSignal.any(
      [signal, this.observationSignal].filter(
        (value): value is AbortSignal => !!value,
      ),
    );
    for (;;) {
      signal?.throwIfAborted();
      const status = await this.status();
      if (status.status === "failed")
        throw new OptimizationError(
          status.errorDetail ?? errorDetail(status.error, "service"),
        );
      if (["completed", "cancelled"].includes(status.status)) return status;
      await delay(signal);
    }
  }
  history(options: Parameters<StudyClient["history"]>[1] = {}) {
    return this.client.history(this.id, options);
  }
  results(): Promise<import("./local.js").LocalResults> {
    return this.client.request(`/v3/runs/${this.id}/results`);
  }
  generations(options: PageOptions = {}) {
    return this.client.request<
      import("./observation.js").HistoryPage<GenerationSnapshot>
    >(`/v3/operations/${this.id}/generations?offset=${options.offset ?? 0}`);
  }
  async candidates(
    options: PageOptions & { phase?: string; generation?: number } = {},
  ) {
    const records = await collectPages((o) =>
      this.client.history(this.id, {
        offset: o.offset,
        phase: options.phase ?? "search",
      }),
    );
    const snapshots = await collectPages((o) => this.generations(o));
    const ids = new Set(
      snapshots
        .filter(
          (s) =>
            options.generation === undefined ||
            s.generation <= options.generation,
        )
        .flatMap((s) => s.evaluatedCandidateIds),
    );
    return page(
      aggregateCandidates(records).filter(
        (candidate) =>
          (options.phase ?? "search") !== "search" ||
          ids.has(candidate.candidateId),
      ),
      options,
    );
  }
  async eventPage(after = 0) {
    return this.client.request<{ items: OperationEvent[] }>(
      `/v3/operations/${this.id}/events?after=${after}`,
    );
  }
  async *events(
    options: { after?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<OperationEvent> {
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw Error("Invalid event cursor");
    const signal = AbortSignal.any(
      [options.signal, this.observationSignal].filter(
        (s): s is AbortSignal => !!s,
      ),
    );
    for (;;) {
      signal.throwIfAborted();
      const result = await this.eventPage(cursor);
      for (const event of result.items) {
        cursor = event.sequence;
        yield event;
      }
      if (
        result.items.some((e) =>
          ["completed", "failed", "cancelled"].includes(e.type),
        )
      )
        return;
      if (result.items.length < 1000) {
        const state = await this.status();
        if (["completed", "failed", "cancelled"].includes(state.status)) {
          const tail = await this.eventPage(cursor);
          for (const event of tail.items) yield event;
          return;
        }
        await delay(signal);
      }
    }
  }
  async completed() {
    await this.wait();
    return this.results();
  }
  analytics(): Promise<unknown> {
    return this.client.request(`/v3/runs/${this.id}/analytics`);
  }
  /** Download a data-only archive including retained baseline and replay resource bytes. */
  async archive(): Promise<Uint8Array> {
    const { exportServiceArchive } = await import("./archive.js");
    return exportServiceArchive(this.client, this.id);
  }
  export(): Promise<unknown> {
    return this.client.request(`/v3/runs/${this.id}/export`);
  }
  async *progress(signal?: AbortSignal): AsyncGenerator<RunStatus> {
    signal = AbortSignal.any(
      [signal, this.observationSignal].filter(
        (value): value is AbortSignal => !!value,
      ),
    );
    for (;;) {
      signal?.throwIfAborted();
      const status = await this.status();
      yield status;
      if (["completed", "failed", "cancelled"].includes(status.status)) return;
      await delay(signal);
    }
  }
}
export class JobHandle {
  private observation: RunHandle;
  constructor(
    private client: StudyClient,
    readonly id: string,
    private signal?: AbortSignal,
  ) {
    this.observation = new RunHandle(client, id, signal);
  }
  async status() {
    return this.client.job(this.id);
  }
  async cancel() {
    return this.client.cancelJob(this.id);
  }
  async wait(signal?: AbortSignal) {
    const status = await this.client.waitJob(
      this.id,
      AbortSignal.any(
        [signal, this.signal].filter((s): s is AbortSignal => !!s),
      ),
    );
    if (status.status === "failed")
      throw new OptimizationError(errorDetail(status.error, "service"));
    return status;
  }
  async results() {
    if ((await this.status()).status !== "completed")
      throw Error("Results are not available");
    const records = await collectPages((o) => this.client.history(this.id, o));
    const values = aggregateCandidates(records);
    if (!values.length) throw Error("Results are not available");
    return values[0];
  }
  async completed() {
    await this.wait();
    return this.results();
  }
  history(options: PageOptions = {}) {
    return this.client.history(this.id, options);
  }
  generations(options: PageOptions = {}) {
    return this.observation.generations(options);
  }
  async *events(options: { after?: number; signal?: AbortSignal } = {}) {
    options.signal = AbortSignal.any(
      [options.signal, this.signal].filter((s): s is AbortSignal => !!s),
    );
    let cursor = options.after ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw Error("Invalid event cursor");
    for (;;) {
      options.signal?.throwIfAborted();
      const result = await this.observation.eventPage(cursor);
      for (const event of result.items) {
        cursor = event.sequence;
        yield event;
      }
      if (
        result.items.some((e) =>
          ["completed", "failed", "cancelled"].includes(e.type),
        )
      )
        return;
      const status = await this.status();
      if (
        ["completed", "failed", "cancelled"].includes(status.status) &&
        result.items.length < 1000
      ) {
        const tail = await this.observation.eventPage(cursor);
        for (const event of tail.items) yield event;
        return;
      }
      await delay(options.signal);
    }
  }
}
export {
  Optimizer,
  type OptimizerOptions,
  type Execution,
} from "./optimizer.js";
export {
  defineStudy,
  type StudyModel,
  type EvaluationContext,
  type ReplayDataset,
} from "./model.js";
export {
  LocalRunHandle,
  type LocalRunOptions,
  type LocalResults,
  type LocalStatus,
  type CandidateResult,
} from "./local.js";
export { RetainedDataLimitError } from "./memory.js";

export {
  openArchive,
  ArchiveReader,
  archiveSchema,
  type OptimizationArchive,
} from "./archive.js";
export {
  defineWorkerStudy,
  serveEvaluator,
  type EvaluatorWorker,
  type EvaluationWorkerPort,
} from "./evaluator-worker.js";

export * from "./observation.js";
export * from "./errors.js";
export { EvaluatorPool } from "./evaluator-worker.js";
export type { SolverWorkerFactory } from "./solver.js";
