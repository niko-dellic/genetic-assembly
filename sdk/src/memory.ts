import type { EvaluationRecord } from "./contracts.js";
import type { ReplayDataset } from "./model.js";
export class RetainedDataLimitError extends Error {
  constructor(public limit: number) {
    super(
      `Retained data exceeds ${limit} bytes. Export or dispose this optimizer, reduce retained data, or explicitly increase memoryLimitBytes.`,
    );
    this.name = "RetainedDataLimitError";
  }
}
/** Accounts for encoded retained data, independently of simulation working memory. */
export class MemoryStore {
  private records: EvaluationRecord[] = [];
  private datasets = new Map<string, ReplayDataset>();
  private bytes = 0;
  private closed = false;
  constructor(readonly limit = 256 * 1024 * 1024) {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw Error("memoryLimitBytes must be a positive safe integer");
  }
  get usageBytes() {
    return this.bytes;
  }
  private reserve(bytes: number) {
    if (this.bytes + bytes > this.limit)
      throw new RetainedDataLimitError(this.limit);
    this.bytes += bytes;
  }
  retain(value: unknown) {
    if (this.closed) throw Error("Optimizer disposed");
    this.reserve(new TextEncoder().encode(JSON.stringify(value)).length);
  }
  add(record: EvaluationRecord, dataset?: ReplayDataset) {
    if (this.closed) throw new DOMException("Optimizer disposed", "AbortError");
    const copy = structuredClone(record);
    const replay = dataset && structuredClone(dataset);
    let size = new TextEncoder().encode(JSON.stringify(copy)).length;
    if (replay) {
      if (typeof replay.manifestKey !== "string" || typeof replay.runHash !== "string") throw Error("Dataset identity must contain strings");
      size += new TextEncoder().encode(replay.manifestKey + replay.runHash).length;
      for (const [path, bytes] of Object.entries(replay.resources)) {
        if (!(bytes instanceof Uint8Array)) throw Error("Dataset resources must be Uint8Array bytes");
        if (
          !path ||
          path.startsWith("/") ||
          path.split("/").some((part) => part === ".." || !part) ||
          path.includes("\\")
        )
          throw Error("Unsafe dataset resource path");
        size += new TextEncoder().encode(path).length + bytes.byteLength;
      }
      if (!Object.hasOwn(replay.resources, replay.manifestKey))
        throw Error("Dataset manifest resource is missing");
    }
    this.reserve(size);
    this.records.push(copy);
    if (replay && record.datasetId) this.datasets.set(record.datasetId, replay);
  }
  history(ownerId?: string) {
    return structuredClone(
      this.records
        .filter((r) => !ownerId || r.ownerId === ownerId)
        .sort(
          (a, b) =>
            a.ownerId.localeCompare(b.ownerId) ||
            a.phase.localeCompare(b.phase) ||
            a.candidateId.localeCompare(b.candidateId, "en", {
              numeric: true,
            }) ||
            a.seed - b.seed,
        ),
    );
  }
  dataset(id: string) {
    const value = this.datasets.get(id);
    if (!value) throw Error("Replay data is unavailable");
    return structuredClone(value);
  }
  allDatasets() {
    return structuredClone(Object.fromEntries(this.datasets));
  }
  clear() {
    this.closed = true;
    this.records = [];
    this.datasets.clear();
    this.bytes = 0;
  }
}
