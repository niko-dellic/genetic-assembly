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
  ValidatedCandidate,
  Page,
  Job,
  Decisions,
  DatasetReference,
} from "./contracts.js";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
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
    const response = await fetch(this.baseUrl + path, { ...init, headers });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
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
    return this.request("/v2/studies", {
      method: "POST",
      body: JSON.stringify({ spec, runtime, bundle: compileStudy(spec) }),
    });
  }
  studies(offset = 0): Promise<Page<PreparedStudy>> {
    return this.request(`/v2/studies?offset=${offset}`);
  }
  study(id: string): Promise<PreparedStudy> {
    return this.request(`/v2/studies/${encodeURIComponent(id)}`);
  }
  async run(studyId: string, config: RunConfig = {}): Promise<RunHandle> {
    const status = await this.request<RunStatus>(
      `/v2/studies/${studyId}/runs`,
      { method: "POST", body: JSON.stringify(config) },
    );
    return this.runHandle(status.id);
  }
  runHandle(id: string) {
    return new RunHandle(this, id, this.observationSignal);
  }
  runs(studyId: string, offset = 0): Promise<Page<RunStatus>> {
    return this.request(`/v2/studies/${studyId}/runs?offset=${offset}`);
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
      `/v2/history/${ownerId}?` +
        new URLSearchParams(
          Object.entries(options)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ),
    );
  }
  baseline(studyId: string): Promise<Job> {
    return this.request(`/v2/studies/${studyId}/jobs`, {
      method: "POST",
      body: JSON.stringify({ kind: "baseline" }),
    });
  }
  replay(studyId: string, decisions: Decisions): Promise<Job> {
    return this.request(`/v2/studies/${studyId}/jobs`, {
      method: "POST",
      body: JSON.stringify({ kind: "replay", decisions }),
    });
  }
  jobs(studyId: string, offset = 0): Promise<Page<Job>> {
    return this.request(`/v2/studies/${studyId}/jobs?offset=${offset}`);
  }
  job(id: string): Promise<Job> {
    return this.request(`/v2/jobs/${id}`);
  }
  cancelJob(id: string): Promise<Job> {
    return this.request(`/v2/jobs/${id}/cancel`, { method: "POST" });
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
    return this.request(`/v2/datasets?ownerId=${encodeURIComponent(ownerId)}`);
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
    return `${this.baseUrl}/v2/datasets/${encodeURIComponent(id)}/resources/`;
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
    private client: StudyClient,
    public id: string,
    private observationSignal?: AbortSignal,
  ) {}
  status(): Promise<RunStatus> {
    return this.client.request(`/v2/runs/${this.id}`);
  }
  cancel(): Promise<RunStatus> {
    return this.client.request(`/v2/runs/${this.id}/cancel`, {
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
      if (["completed", "failed", "cancelled"].includes(status.status))
        return status;
      await delay(signal);
    }
  }
  history(options: Parameters<StudyClient["history"]>[1] = {}) {
    return this.client.history(this.id, options);
  }
  results(): Promise<{ search: unknown; validated: ValidatedCandidate[] }> {
    return this.client.request(`/v2/runs/${this.id}/results`);
  }
  analytics(): Promise<unknown> {
    return this.client.request(`/v2/runs/${this.id}/analytics`);
  }
  /** Download a data-only archive including retained baseline and replay resource bytes. */
  async archive(): Promise<Uint8Array> {
    const { exportServiceArchive } = await import("./archive.js");
    return exportServiceArchive(this.client, this.id);
  }
  export(): Promise<unknown> {
    return this.client.request(`/v2/runs/${this.id}/export`);
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
