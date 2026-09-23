import { z } from "zod";
import { evaluationSchema, studySpecSchema, canonical } from "./contracts.js";
import { digest, type LocalRunHandle } from "./local.js";
import type { MemoryStore } from "./memory.js";
import type { ReplayDataset } from "./model.js";
export const archiveSchema = z
  .object({
    format: z.literal("genetic-assembly-archive"),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    provenance: z
      .object({
        execution: z.enum(["local", "service"]),
        engine: z.enum(["rust-wasm", "rust-native"]),
        modelCodeIncluded: z.literal(false),
        runtimeIdentity: z.string().optional(),
        resumable: z.literal(false),
      })
      .strict(),
    studies: z.array(studySpecSchema),
    studyIds: z.array(z.string()).optional(),
    runs: z.array(
      z
        .object({
          id: z.string().uuid(),
          engineVersion: z.string().optional(),
          study: studySpecSchema,
          studyId: z.string().optional(),
          status: z.enum([
            "queued",
            "running",
            "completed",
            "cancelled",
            "failed",
          ]),
          error: z.string().optional(),
          results: z.json().optional(),
        })
        .strict(),
    ),
    evaluations: z.array(evaluationSchema),
    materializations: z.array(
      z
        .object({
          ownerId: z.string().uuid(),
          candidateId: z.string(),
          decisions: z.record(
            z.string(),
            z.union([z.number(), z.boolean(), z.string()]),
          ),
          value: z.json(),
        })
        .strict(),
    ),
    datasets: z.record(
      z.string(),
      z
        .object({
          manifestKey: z.string(),
          runHash: z.string(),
          resources: z.record(z.string(), z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type OptimizationArchive = z.infer<typeof archiveSchema>;
function encode(bytes: Uint8Array) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function decode(text: string) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  )
    throw Error("Invalid replay resource encoding");
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}
/** Data-only snapshot: opening it never imports or evaluates application code. */
export class ArchiveReader {
  readonly readOnly = true;
  constructor(private data: OptimizationArchive) {}
  snapshot() {
    return structuredClone(this.data);
  }
  history(ownerId?: string) {
    return structuredClone(
      this.data.evaluations.filter(
        (record) => !ownerId || record.ownerId === ownerId,
      ),
    );
  }
  dataset(id: string): ReplayDataset {
    const dataset = this.data.datasets[id];
    if (!dataset) throw Error("Replay data is unavailable");
    return {
      ...dataset,
      resources: Object.fromEntries(
        Object.entries(dataset.resources).map(([key, value]) => [
          key,
          decode(value),
        ]),
      ),
    };
  }
}
/** Validate the format, checksum and resource paths before exposing a read-only archive. */
export async function openArchive(
  bytes: Uint8Array,
  options: { maxBytes?: number } = {},
): Promise<ArchiveReader> {
  if (bytes.byteLength > (options.maxBytes ?? 512 * 1024 * 1024))
    throw Error("Archive exceeds maximum size");
  const wrapper = z
    .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.unknown() })
    .strict()
    .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if ((await digest(wrapper.data)) !== wrapper.sha256)
    throw Error("Archive checksum mismatch");
  const data = archiveSchema.parse(wrapper.data);
  for (const dataset of Object.values(data.datasets)) {
    if (!Object.hasOwn(dataset.resources, dataset.manifestKey))
      throw Error("Missing replay manifest");
    for (const [path, bytes] of Object.entries(dataset.resources)) {
      if (
        !path ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part) => !part || part === "..")
      )
        throw Error("Unsafe replay resource path");
      decode(bytes);
    }
  }
  for (const record of data.evaluations)
    if (record.datasetId && !data.datasets[record.datasetId])
      throw Error("Missing referenced dataset");
  return new ArchiveReader(data);
}
/** @internal */
export async function exportMemory(
  store: MemoryStore,
  runs: Iterable<LocalRunHandle>,
  studies: Iterable<import("./contracts.js").StudySpec>,
  materializations: unknown[],
): Promise<Uint8Array> {
  const snapshots = [...runs].map((run) => {
    let results: any;
    try {
      results = run.results();
    } catch {
      /* Running/failed sessions retain evidence without a front. */
    }
    return {
      id: run.id,
      engineVersion: run.engineVersion,
      study: run.study,
      status: run.status().status,
      error: run.status().error,
      results,
    };
  });
  const data = archiveSchema.parse({
    format: "genetic-assembly-archive",
    version: 1,
    createdAt: new Date().toISOString(),
    provenance: {
      execution: "local",
      engine: "rust-wasm",
      modelCodeIncluded: false,
      resumable: false,
    },
    studies: [...studies],
    runs: snapshots,
    evaluations: store.history(),
    materializations,
    datasets: Object.fromEntries(
      Object.entries(store.allDatasets()).map(([id, dataset]) => [
        id,
        {
          ...dataset,
          resources: Object.fromEntries(
            Object.entries(dataset.resources).map(([path, bytes]) => [
              path,
              encode(bytes),
            ]),
          ),
        },
      ]),
    ),
  });
  return new TextEncoder().encode(
    JSON.stringify({ sha256: await digest(data), data }),
  );
}

/** Download a self-contained service archive without embedding runtime environment variables. */
export async function exportServiceArchive(
  client: import("./index.js").StudyClient,
  runId: string,
  maxBytes = 512 * 1024 * 1024,
): Promise<Uint8Array> {
  const handle = client.runHandle(runId);
  const status = await handle.status();
  const source = (await handle.export()) as {
    study: import("./contracts.js").PreparedStudy;
    results: {
      search: {
        members: {
          individual: import("./solver.js").SolverIndividual;
          materialization?: { data: unknown };
        }[];
      };
      validated: import("./contracts.js").ValidatedCandidate[];
    };
    evaluations: import("./contracts.js").EvaluationRecord[];
    datasets: import("./contracts.js").DatasetReference[];
  };
  const evaluations = [...source.evaluations];
  const owners = new Set(source.datasets.map((dataset) => dataset.ownerId));
  let jobOffset = 0;
  for (;;) {
    const page = await client.jobs(source.study.id, jobOffset);
    for (const job of page.items) owners.add(job.id);
    if (page.nextOffset === null) break;
    jobOffset = page.nextOffset;
  }
  owners.delete(runId);
  for (const owner of owners) {
    let offset = 0;
    for (;;) {
      const page = await client.history(owner, { offset });
      evaluations.push(...page.items);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
  }
  let retained = 0;
  const datasets: OptimizationArchive["datasets"] = {};
  for (const dataset of source.datasets) {
    const resources: Record<string, string> = {};
    for (const key of Object.keys(dataset.resources)) {
      const bytes = await client.datasetResource(dataset.id, key);
      retained += bytes.byteLength;
      if (retained > maxBytes)
        throw Error("Service archive exceeds maximum size");
      resources[key] = encode(bytes);
    }
    datasets[dataset.id] = {
      manifestKey: dataset.manifestKey,
      runHash: dataset.runHash,
      resources,
    };
  }
  const validated = source.results.validated.map((candidate) => ({
    candidateId: candidate.candidate_id,
    decisions: candidate.decisions,
    metrics: candidate.metrics,
    constraints: candidate.constraints,
    seedCount: candidate.seed_count,
    feasible: Object.values(candidate.constraints).every((value) => value <= 0),
  }));
  const { decodeDecisions } = await import("./study.js");
  const data = archiveSchema.parse({
    format: "genetic-assembly-archive",
    version: 1,
    createdAt: new Date().toISOString(),
    provenance: {
      execution: "service",
      engine: "rust-native",
      modelCodeIncluded: false,
      resumable: false,
      runtimeIdentity: source.study.runtime.identity,
    },
    studies: [source.study.spec],
    studyIds: [source.study.id],
    runs: [
      {
        id: runId,
        study: source.study.spec,
        studyId: source.study.id,
        status: status.status,
        error: status.error ?? undefined,
        results: {
          search: {
            generations: status.current_generation,
            evaluations: new Set(
              source.evaluations
                .filter((record) => record.phase === "search")
                .map((record) => record.candidateId),
            ).size,
            pareto_front: source.results.search.members.map(
              (member) => member.individual,
            ),
          },
          validatedFront: validated,
        },
      },
    ],
    evaluations,
    datasets,
    materializations: source.results.search.members
      .filter((member) => member.materialization)
      .map((member) => ({
        ownerId: runId,
        candidateId: String(member.individual.id),
        decisions: decodeDecisions(source.study.spec, member.individual.genes),
        value: member.materialization!.data,
      })),
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify({ sha256: await digest(data), data }),
  );
  if (bytes.byteLength > maxBytes)
    throw Error("Service archive exceeds maximum size");
  return bytes;
}
