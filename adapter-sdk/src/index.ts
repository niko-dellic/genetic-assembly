import { createInterface } from "node:readline";
import type {
  AdapterCapabilities,
  AdapterContext,
  EvaluatedCandidate,
  EvaluationRequest,
  GeneticAssemblyAdapter,
  OffspringRequest,
  RequestEnvelope,
  ResponseEnvelope,
  SeedPopulationRequest,
} from "./types.js";
import { ADAPTER_PROTOCOL_VERSION } from "./types.js";

export * from "./types.js";

export function defineAdapter(adapter: GeneticAssemblyAdapter): GeneticAssemblyAdapter {
  return adapter;
}

export async function serveAdapter(adapter: GeneticAssemblyAdapter): Promise<void> {
  let context: AdapterContext | undefined;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let request: RequestEnvelope;
    try {
      request = JSON.parse(line) as RequestEnvelope;
    } catch (error) {
      process.stderr.write(`Invalid adapter JSON: ${String(error)}\n`);
      continue;
    }
    const base = {
      protocol_version: ADAPTER_PROTOCOL_VERSION,
      request_id: Number(request.request_id),
    } as const;
    try {
      if (request.protocol_version !== ADAPTER_PROTOCOL_VERSION)
        throw new Error(`Unsupported protocol ${String(request.protocol_version)}`);
      const response = await dispatch(adapter, request, context);
      if (request.type === "initialize")
        context = { runId: String(request.run_id), problem: request.problem as AdapterContext["problem"] };
      writeResponse({ ...base, ...response });
      if (request.type === "shutdown") break;
    } catch (error) {
      writeResponse({
        ...base,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  }
  lines.close();
}

async function dispatch(
  adapter: GeneticAssemblyAdapter,
  request: RequestEnvelope,
  context: AdapterContext | undefined,
): Promise<{ type: string; [key: string]: unknown }> {
  switch (request.type) {
    case "initialize": {
      const nextContext = {
        runId: String(request.run_id),
        problem: request.problem as AdapterContext["problem"],
      };
      const capabilities = normalizeCapabilities(await adapter.initialize(nextContext));
      validateCapabilities(adapter, capabilities);
      return { type: "initialized", capabilities, adapter_version: adapter.version };
    }
    case "seed_population": {
      requireInitialized(context);
      if (adapter.seedPopulation === undefined) throw new Error("seedPopulation is not implemented");
      const requestBody = request.request as unknown as SeedPopulationRequest;
      const genes = await adapter.seedPopulation(requestBody);
      if (genes.length !== requestBody.size) throw new Error("seedPopulation returned the wrong size");
      return { type: "population_seeded", genes };
    }
    case "make_offspring": {
      requireInitialized(context);
      if (adapter.makeOffspring === undefined) throw new Error("makeOffspring is not implemented");
      const requests = request.requests as unknown as OffspringRequest[];
      const candidates = await adapter.makeOffspring(requests);
      assertOrderedIds(requests, candidates);
      return { type: "offspring_created", candidates };
    }
    case "evaluate_batch": {
      requireInitialized(context);
      const candidates = request.candidates as unknown as EvaluationRequest[];
      const evaluated = await adapter.evaluateBatch(candidates, String(request.phase ?? "search"));
      validateEvaluations(context.problem, candidates, evaluated);
      return { type: "batch_evaluated", candidates: evaluated };
    }
    case "validate_front": {
      requireInitialized(context);
      if (adapter.validateFront === undefined) throw new Error("validateFront is not implemented");
      const candidates = request.candidates as unknown as EvaluationRequest[];
      const evaluated = await adapter.validateFront(candidates);
      validateEvaluations(context.problem, candidates, evaluated);
      return { type: "front_validated", candidates: evaluated };
    }
    case "materialize": {
      requireInitialized(context);
      if (adapter.materialize === undefined) throw new Error("materialize is not implemented");
      const candidates = request.candidates as unknown as EvaluationRequest[];
      const materialized = await adapter.materialize(candidates);
      assertOrderedIds(candidates, materialized);
      return { type: "materialized", candidates: materialized };
    }
    case "cancel":
      await adapter.cancel?.();
      return { type: "cancelled" };
    case "shutdown":
      await adapter.shutdown?.();
      return { type: "shutdown" };
    default:
      throw new Error(`Unknown adapter request ${request.type}`);
  }
}

function normalizeCapabilities(value: AdapterCapabilities): Required<AdapterCapabilities> {
  return {
    operator_mode: value.operator_mode ?? "builtin",
    max_concurrency: value.max_concurrency ?? 1,
    validate_front: value.validate_front ?? false,
    materialize: value.materialize ?? false,
  };
}

function validateCapabilities(adapter: GeneticAssemblyAdapter, value: Required<AdapterCapabilities>): void {
  if (!Number.isInteger(value.max_concurrency) || value.max_concurrency < 1)
    throw new Error("max_concurrency must be a positive integer");
  if (value.operator_mode === "adapter" &&
      (adapter.seedPopulation === undefined || adapter.makeOffspring === undefined))
    throw new Error("adapter operator mode requires seedPopulation and makeOffspring");
  if (value.validate_front && adapter.validateFront === undefined)
    throw new Error("validate_front requires validateFront");
  if (value.materialize && adapter.materialize === undefined)
    throw new Error("materialize requires materialize");
}

function validateEvaluations(
  problem: AdapterContext["problem"],
  requests: readonly EvaluationRequest[],
  candidates: readonly EvaluatedCandidate[],
): void {
  assertOrderedIds(requests, candidates);
  for (const candidate of candidates) {
    if (candidate.genes.length !== problem.problem.variables.length)
      throw new Error(`Candidate ${candidate.id} returned the wrong gene count`);
    if (candidate.evaluation.objectives.length !== problem.problem.objectives.length)
      throw new Error(`Candidate ${candidate.id} returned the wrong objective count`);
    const values = [...candidate.genes, ...candidate.evaluation.objectives,
      ...(candidate.evaluation.constraints ?? [])];
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error(`Candidate ${candidate.id} returned a non-finite value`);
  }
}

function assertOrderedIds(
  requests: readonly { id: number }[],
  responses: readonly { id: number }[],
): void {
  if (requests.length !== responses.length ||
      requests.some((request, index) => request.id !== responses[index]?.id))
    throw new Error("Adapter must return one response per request in request order");
}

function requireInitialized(context: AdapterContext | undefined): asserts context is AdapterContext {
  if (context === undefined) throw new Error("Adapter has not been initialized");
}

function writeResponse(response: ResponseEnvelope): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export async function runConformanceSuite(
  adapter: GeneticAssemblyAdapter,
  problem: AdapterContext["problem"],
): Promise<void> {
  const capabilities = normalizeCapabilities(await adapter.initialize({ runId: "conformance", problem }));
  validateCapabilities(adapter, capabilities);
  const requests = [
    { id: 1, genes: problem.problem.variables.map((variable) =>
      variable.kind === "binary" ? 0 : variable.lower) },
    { id: 2, genes: problem.problem.variables.map((variable) =>
      variable.kind === "binary" ? 1 : variable.upper) },
  ];
  const first = await adapter.evaluateBatch(requests, "conformance");
  const second = await adapter.evaluateBatch(requests, "conformance");
  validateEvaluations(problem, requests, first);
  validateEvaluations(problem, requests, second);
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error("Adapter is not deterministic for identical indexed requests");
  if (capabilities.materialize) {
    const materialized = await adapter.materialize?.(requests);
    if (materialized === undefined) throw new Error("materialize capability did not produce data");
    assertOrderedIds(requests, materialized);
  }
  await adapter.shutdown?.();
}
