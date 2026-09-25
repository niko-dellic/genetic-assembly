import {
  StudyClient,
  Optimizer,
  ArchiveReader,
  openArchive,
  validateStudy,
  type StudyModel,
  type PreparedStudy,
  type RunStatus,
  type Job,
  type DatasetReference,
  type Decisions,
  type RunConfig,
} from "@genetic-assembly/sdk";
export type InspectorProvider = Pick<
  StudyClient,
  "studies" | "study" | "runs" | "jobs" | "history" | "datasets" | "datasetUrl"
> & {
  baseUrl: string;
  readOnly?: boolean;
  baseline(id: string): Promise<unknown>;
  replay(id: string, decisions: Decisions): Promise<unknown>;
  run(id: string, config?: RunConfig): Promise<{ id: string }>;
  cancelJob(id: string): Promise<unknown>;
  runHandle(id: string): {
    status(): Promise<import("@genetic-assembly/sdk").OperationStatus>;
    results(): Promise<import("@genetic-assembly/sdk").OptimizationResults>;
    cancel(): Promise<unknown>;
  };
  resourceFetch?: typeof fetch;
};
const unavailable = () => {
  throw Error(
    "This archive is read-only. Replay generation and optimization require the original model.",
  );
};
/** A common read-only provider for portable archives, optionally backed by a live memory session. */
export class ArchiveInspectorProvider implements InspectorProvider {
  readonly baseUrl = "";
  readonly readOnly: boolean = true;
  protected latest?: ArchiveReader;
  constructor(private source: ArchiveReader | (() => Promise<ArchiveReader>)) {}
  protected async reader() {
    return (this.latest =
      typeof this.source === "function" ? await this.source() : this.source);
  }
  async studies(): ReturnType<StudyClient["studies"]> {
    const archive = (await this.reader()).snapshot();
    return {
      items: await Promise.all(
        archive.studies.map(async (spec, index) => ({
          id: archive.studyIds?.[index] ?? (await studyId(spec)),
          spec,
          runtime: { command: "", args: [], identity: "local-session" },
        })),
      ),
      nextOffset: null,
    };
  }
  async study(id: string): Promise<PreparedStudy> {
    const study = (await this.studies()).items.find((s) => s.id === id);
    if (!study) throw Error("Unknown study");
    return study;
  }
  async runs(id: string) {
    const data = (await this.reader()).snapshot();
    const items: RunStatus[] = [];
    for (const run of data.runs)
      if (
        run.kind === "search" &&
        (run.studyId ?? (await studyId(run.study))) === id
      )
        items.push({
          id: run.id,
          status: run.status,
          error: run.error,
          errorDetail: run.errorDetail,
          current_generation: run.generations.at(-1)?.generation ?? 0,
          config: {},
        });
    return { items, nextOffset: null };
  }
  async jobs(id: string) {
    const records = (await this.reader())
      .history()
      .filter(
        (r) =>
          r.studyId === id && (r.phase === "baseline" || r.phase === "replay"),
      );
    const items: Job[] = [
      ...new Map(
        records.map((r) => [
          r.ownerId,
          {
            id: r.ownerId,
            study_id: id,
            kind: r.phase as "baseline" | "replay",
            status:
              r.status === "failed"
                ? ("failed" as const)
                : ("completed" as const),
            error: r.error,
            request: { decisions: r.decisions },
          },
        ]),
      ).values(),
    ];
    return { items, nextOffset: null };
  }
  async history(
    ownerId: string,
    options: Parameters<StudyClient["history"]>[1] = {},
  ) {
    const records = (await this.reader())
      .history(ownerId)
      .filter(
        (r) =>
          (!options.phase || r.phase === options.phase) &&
          (!options.status || r.status === options.status) &&
          (!options.candidateId || r.candidateId === options.candidateId),
      );
    const offset = options.offset ?? 0;
    return {
      items: records.slice(offset, offset + 100),
      nextOffset: offset + 100 < records.length ? offset + 100 : null,
    };
  }
  async datasets(ownerId: string): Promise<DatasetReference[]> {
    const reader = await this.reader();
    return reader
      .history(ownerId)
      .filter((r) => r.datasetId)
      .map((r) => {
        const data = reader.dataset(r.datasetId!);
        return {
          id: r.datasetId!,
          ownerId,
          studyId: r.studyId,
          candidateId: r.candidateId,
          seed: r.seed,
          manifestKey: data.manifestKey,
          runHash: data.runHash,
          resources: Object.fromEntries(
            Object.keys(data.resources).map((key) => [key, key]),
          ),
        };
      });
  }
  datasetUrl(id: string) {
    return `https://genetic-assembly.invalid/datasets/${encodeURIComponent(id)}/`;
  }
  resourceFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/^\/datasets\/([^/]+)\/(.+)$/);
    if (!match) return new Response("Unknown resource", { status: 404 });
    const reader = this.latest ?? (await this.reader());
    const bytes = reader.dataset(decodeURIComponent(match[1])).resources[
      decodeURIComponent(match[2])
    ];
    return bytes
      ? new Response(bytes.slice().buffer as ArrayBuffer)
      : new Response("Missing resource", { status: 404 });
  };
  async baseline(_id: string): Promise<unknown> {
    return unavailable();
  }
  async replay(_id: string, _decisions: Decisions): Promise<unknown> {
    return unavailable();
  }
  async run(_id: string, _config?: RunConfig): Promise<{ id: string }> {
    return unavailable();
  }
  async cancelJob(_id: string): Promise<unknown> {
    return unavailable();
  }
  runHandle(id: string): ReturnType<InspectorProvider["runHandle"]> {
    return {
      status: async () => {
        const run = (await this.reader())
          .snapshot()
          .runs.find((r) => r.id === id);
        if (!run) throw Error("Unknown run");
        return {
          id,
          status: run.status,
          error: run.error,
          errorDetail: run.errorDetail,
          progress: run.generations.at(-1)?.summary,
        };
      },
      results: async () => {
        const run = (await this.reader())
          .snapshot()
          .runs.find((r) => r.id === id);
        const result = run?.results as any;
        if (!result?.search) throw Error("Results are not available");
        return result;
      },
      cancel: async () => unavailable(),
    };
  }
}
async function studyId(spec: unknown) {
  // Use the SDK's normalized canonical representation, matching retained record IDs.
  const { canonical } = await import("@genetic-assembly/sdk");
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(spec)),
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
/** Local provider keeps the same inspector UI and explicit application callbacks. */
export class LocalInspectorProvider extends ArchiveInspectorProvider {
  override readonly readOnly = false;
  constructor(
    private optimizer: Optimizer,
    private models: StudyModel[],
  ) {
    super(async () => openArchive(await optimizer.export()));
  }
  private async model(id: string) {
    for (const model of this.models)
      if ((await studyId(validateStudy(model))) === id) return model;
    throw Error("Original model is unavailable");
  }
  override async baseline(id: string) {
    return this.optimizer.baseline(await this.model(id));
  }
  override async replay(id: string, decisions: Decisions) {
    return this.optimizer.replay(await this.model(id), decisions);
  }
  override async run(id: string, config: RunConfig = {}) {
    return await this.optimizer.run(await this.model(id), {
      populationSize: config.population_size,
      generations: config.generations,
      seed: config.seed,
    });
  }
  override runHandle(id: string) {
    const reader = super.runHandle(id);
    return {
      ...reader,
      status: async () => this.optimizer.runHandle(id).status(),
      cancel: async () => this.optimizer.runHandle(id).cancel(),
    };
  }
}
