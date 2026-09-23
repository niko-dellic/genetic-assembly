import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  StudyClient,
  ADAPTER_PROTOCOL_VERSION,
  canonical,
  measurementSchema,
  type Measurement,
  type StudyInput,
  type StudySpec,
  type Decisions,
  type EvaluationRecord,
  type DatasetReference,
} from "../index.js";
import {
  validateStudy,
  baselineDecisions,
  decodeDecisions,
  encodeDecisions,
} from "../study.js";
export * from "../study.js";
export type {
  StudyInput,
  StudySpec,
  Decisions,
  Measurement,
} from "../contracts.js";
export interface EvaluationContext {
  seed: number;
  phase: EvaluationRecord["phase"];
  signal: AbortSignal;
  directory: string;
  retainReplay: boolean;
}
export interface StudyModel extends StudyInput {
  evaluate(
    decisions: Decisions,
    inputs: unknown,
    context: EvaluationContext,
  ): Measurement | Promise<Measurement>;
  repair?(
    decisions: Decisions,
    inputs: unknown,
  ): { decisions: Decisions; repairs: string[] };
  validate?(decisions: Decisions, inputs: unknown): string[];
  materialize?(
    decisions: Decisions,
    inputs: unknown,
  ): unknown | Promise<unknown>;
  dataset?(
    context: EvaluationContext,
  ): Promise<
    { directory: string; manifestKey: string; runHash: string } | undefined
  >;
}
/** Define a study once for the SDK, CLI, evaluator and inspector. */
export function defineStudy(model: StudyModel): StudyModel {
  validateStudy(model);
  return model;
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function constraintValues(spec: StudySpec, metrics: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(spec.constraints).map(([id, c]) => {
      const value = metrics[c.metric];
      if (!Number.isFinite(value))
        throw Error(
          `Constraint ${id}: metric ${c.metric} is missing or non-finite`,
        );
      return [id, c.operator === "<=" ? value - c.bound : c.bound - value];
    }),
  );
}
function objectiveValues(spec: StudySpec, metrics: Record<string, number>) {
  return Object.entries(spec.objectives).map(([id, o]) => {
    const value = metrics[o.metric];
    if (!Number.isFinite(value))
      throw Error(
        `Objective ${id}: metric ${o.metric} is missing or non-finite`,
      );
    return value;
  });
}
/** Exercise the configured baseline, repair and goal mapping twice without a backend. */
export async function checkStudy(model: StudyModel) {
  const spec = validateStudy(model);
  const baseline = baselineDecisions(spec);
  const results = [];
  const repairsSeen: unknown[] = [];
  for (let n = 0; n < 2; n++) {
    const repaired = model.repair?.(
      structuredClone(baseline),
      structuredClone(spec.inputs),
    ) ?? { decisions: baseline, repairs: [] };
    encodeDecisions(spec, repaired.decisions);
    if (
      !Array.isArray(repaired.repairs) ||
      repaired.repairs.some((value) => typeof value !== "string")
    )
      throw Error("Repair must report an array of messages");
    repairsSeen.push(repaired);
    const invalid =
      model.validate?.(repaired.decisions, structuredClone(spec.inputs)) ?? [];
    if (invalid.length)
      throw Error("Baseline is invalid: " + invalid.join("; "));
    const directory = join(tmpdir(), "ga-check-" + crypto.randomUUID());
    await mkdir(directory, { recursive: true });
    try {
      const measurement = measurementSchema.parse(
        await model.evaluate(repaired.decisions, structuredClone(spec.inputs), {
          seed: spec.searchSeeds[0],
          phase: "baseline",
          signal: AbortSignal.timeout(120000),
          directory,
          retainReplay: false,
        }),
      );
      objectiveValues(spec, measurement.metrics);
      constraintValues(spec, measurement.metrics);
      results.push(measurement);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (canonical(repairsSeen[0]) !== canonical(repairsSeen[1]))
    throw Error("Repeated repairs differ for the same baseline");
  if (canonical(results[0]) !== canonical(results[1]))
    throw Error("Repeated baseline measurements differ for the same seed");
  return {
    spec,
    baseline,
    measurement: results[0],
    message: "Baseline is valid; named goals and repeatability passed.",
  };
}
async function uploadDataset(
  client: StudyClient,
  reference: { directory: string; manifestKey: string; runHash: string },
  record: EvaluationRecord,
): Promise<string> {
  const resources: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw Error("Dataset resources cannot be symbolic links");
      if (entry.isDirectory()) await walk(path);
      else {
        const bytes = await readFile(path);
        const response = await fetch(client.baseUrl + "/v2/artifacts", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            ...(process.env.GA_API_TOKEN
              ? { authorization: `Bearer ${process.env.GA_API_TOKEN}` }
              : {}),
          },
          body: bytes,
        });
        if (!response.ok) throw Error(await response.text());
        const artifact = (await response.json()) as { id: string };
        resources[relative(reference.directory, path).split("\\").join("/")] =
          artifact.id;
      }
    }
  }
  await walk(reference.directory);
  const dataset: DatasetReference = {
    id: hash({ evaluation: record.id, resources }),
    ownerId: record.ownerId,
    studyId: record.studyId,
    candidateId: record.candidateId,
    seed: record.seed,
    manifestKey: reference.manifestKey,
    runHash: reference.runHash,
    resources,
  };
  await client.request("/v2/datasets", {
    method: "POST",
    body: JSON.stringify(dataset),
  });
  return dataset.id;
}
/** Execute the versioned adapter protocol. The managed CLI supplies snapshot identity and backend connectivity. */
export async function serveStudy(model: StudyModel): Promise<void> {
  const spec = validateStudy(model);
  const client = new StudyClient(
    process.env.GA_INTERNAL_URL ?? "http://127.0.0.1:3001",
    process.env.GA_API_TOKEN,
  );
  let ownerId = "";
  let studyId = process.env.GA_STUDY_ID ?? "";
  let identity = process.env.GA_RUNTIME_ID ?? hash(spec);
  async function evaluate(
    candidateId: string,
    raw: Decisions,
    phase: EvaluationRecord["phase"],
  ) {
    const repaired = model.repair?.(
      structuredClone(raw),
      structuredClone(spec.inputs),
    ) ?? { decisions: raw, repairs: [] };
    encodeDecisions(spec, repaired.decisions);
    const invalid =
      model.validate?.(repaired.decisions, structuredClone(spec.inputs)) ?? [];
    const seeds =
      phase === "validation" ? spec.validationSeeds : spec.searchSeeds;
    const measurements: Record<string, number>[] = [];
    for (const seed of seeds) {
      const designHash = hash(repaired.decisions);
      const cacheKey = hash({ identity, spec, designHash, seed, phase });
      const record: EvaluationRecord = {
        id: hash({ ownerId, candidateId, phase, seed }),
        ownerId,
        studyId,
        candidateId,
        designHash,
        phase,
        seed,
        decisions: repaired.decisions,
        status: invalid.length ? "invalid" : "completed",
        metrics: {},
        constraints: {},
        warnings: [...invalid],
        repairs: repaired.repairs,
        cacheKey,
        cached: false,
        runtimeMs: 0,
      };
      const directory = join(tmpdir(), "ga-evaluation-" + record.id);
      await mkdir(directory, { recursive: true });
      const start = performance.now();
      const context: EvaluationContext = {
        seed,
        phase,
        signal: AbortSignal.timeout(120000),
        directory,
        retainReplay: phase === "baseline" || phase === "replay",
      };
      try {
        if (invalid.length) {
          record.constraints = { domain_validity: 1 };
        } else {
          const cached = context.retainReplay
            ? null
            : await client.request<EvaluationRecord | null>(
                `/v2/cache/${cacheKey}`,
              );
          const measured = cached
            ? { metrics: cached.metrics, warnings: cached.warnings }
            : measurementSchema.parse(
                await model.evaluate(
                  repaired.decisions,
                  structuredClone(spec.inputs),
                  context,
                ),
              );
          objectiveValues(spec, measured.metrics);
          record.metrics = measured.metrics;
          record.warnings = measured.warnings ?? [];
          record.cached = !!cached;
          record.constraints = {
            ...constraintValues(spec, record.metrics),
            domain_validity: 0,
          };
          if (context.retainReplay && model.dataset) {
            const reference = await model.dataset(context);
            if (reference)
              record.datasetId = await uploadDataset(client, reference, record);
          }
          measurements.push(record.metrics);
        }
      } catch (error) {
        record.status = "failed";
        record.error = String(error);
      } finally {
        record.runtimeMs = performance.now() - start;
        await client.request("/v2/evaluations", {
          method: "POST",
          body: JSON.stringify(record),
        });
        await rm(directory, { recursive: true, force: true });
      }
      if (record.status === "failed") throw Error(record.error);
    }
    const metrics = Object.fromEntries(
      Object.keys(measurements[0] ?? {}).map((k) => [
        k,
        measurements.reduce((sum, m) => sum + m[k], 0) / measurements.length,
      ]),
    );
    return {
      genes: encodeDecisions(spec, repaired.decisions),
      evaluation: {
        objectives: invalid.length
          ? Object.keys(spec.objectives).map(() => 0)
          : objectiveValues(spec, metrics),
        constraints: invalid.length
          ? [...Object.keys(spec.constraints).map(() => 0), 1]
          : [...Object.values(constraintValues(spec, metrics)), 0],
        evidence: {
          warnings: invalid,
          metadata: {
            design_hash: hash(repaired.decisions),
            repairs: JSON.stringify(repaired.repairs),
          },
        },
      },
    };
  }
  if (process.env.GA_JOB_REQUEST) {
    const job = JSON.parse(process.env.GA_JOB_REQUEST);
    ownerId = job.id;
    studyId = job.studyId;
    identity = job.identity;
    const decisions = job.decisions ?? baselineDecisions(spec);
    const evaluated = await evaluate(
      job.candidateId ?? (job.kind === "baseline" ? "baseline" : "selected"),
      decisions,
      job.kind,
    );
    const canonicalDecisions = decodeDecisions(spec, evaluated.genes);
    const materialization =
      (await model.materialize?.(canonicalDecisions, spec.inputs)) ??
      canonicalDecisions;
    process.stdout.write(
      JSON.stringify({ decisions: canonicalDecisions, materialization }) + "\n",
    );
    return;
  }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let request: any;
    try {
      request = JSON.parse(line);
      if (request.protocol_version !== ADAPTER_PROTOCOL_VERSION)
        throw Error("Unsupported adapter protocol");
      let response: any;
      if (request.type === "initialize") {
        ownerId = request.run_id;
        studyId = request.problem.metadata.studyId;
        identity = request.problem.metadata.runtimeIdentity;
        if (canonical(request.problem.metadata.study) !== canonical(spec))
          throw Error(
            "Model definition does not match immutable study revision",
          );
        response = {
          type: "initialized",
          adapter_version: identity,
          capabilities: {
            operator_mode: "builtin",
            max_concurrency: 1,
            validate_front: true,
            materialize: true,
          },
        };
      } else if (
        request.type === "evaluate_batch" ||
        request.type === "validate_front"
      ) {
        const candidates = [];
        for (const c of request.candidates)
          candidates.push({
            id: c.id,
            ...(await evaluate(
              String(c.id),
              decodeDecisions(spec, c.genes),
              request.type === "validate_front" ? "validation" : "search",
            )),
          });
        response = {
          type:
            request.type === "validate_front"
              ? "front_validated"
              : "batch_evaluated",
          candidates,
        };
      } else if (request.type === "materialize") {
        const candidates = [];
        for (const c of request.candidates) {
          const decisions = decodeDecisions(spec, c.genes);
          candidates.push({
            id: c.id,
            media_type: "application/json",
            data:
              (await model.materialize?.(decisions, spec.inputs)) ?? decisions,
          });
        }
        response = { type: "materialized", candidates };
      } else if (request.type === "shutdown") response = { type: "shutdown" };
      else if (request.type === "cancel") response = { type: "cancelled" };
      else throw Error("Unknown request " + request.type);
      process.stdout.write(
        JSON.stringify({
          protocol_version: ADAPTER_PROTOCOL_VERSION,
          request_id: request.request_id,
          ...response,
        }) + "\n",
      );
      if (request.type === "shutdown") break;
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          protocol_version: ADAPTER_PROTOCOL_VERSION,
          request_id: request?.request_id,
          type: "error",
          retryable: false,
          message: String(error),
        }) + "\n",
      );
    }
  }
}
