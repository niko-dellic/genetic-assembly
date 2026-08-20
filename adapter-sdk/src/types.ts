export const ADAPTER_PROTOCOL_VERSION = "genetic-assembly-adapter-v1" as const;

export type Variable =
  | { kind: "real"; lower: number; upper: number }
  | { kind: "integer"; lower: number; upper: number; step?: number }
  | { kind: "binary" };
export interface Objective { name: string; direction: "minimize" | "maximize" }
export interface ProblemBundle {
  schema_version?: 1;
  name: string;
  problem: { variables: Variable[]; objectives: Objective[] };
  variable_ids?: string[];
  constraints?: { name: string; feasible_when?: "lte_zero" }[];
  artifacts?: { name: string; content_hash: string; artifact_key: string; media_type?: string }[];
  metadata?: unknown;
}
export interface EvaluationRequest { id: number; genes: number[] }
export interface EvaluationEvidence {
  artifact_key?: string;
  metadata?: Record<string, string>;
  warnings?: string[];
  runtime_ms?: number;
}
export interface EvaluatedCandidate {
  id: number;
  genes: number[];
  evaluation: {
    objectives: number[];
    constraints?: number[];
    evidence?: EvaluationEvidence;
  };
}
export interface SeedPopulationRequest { size: number; seeds: string[] }
export interface OffspringRequest {
  id: number;
  left_id: number;
  left_genes: number[];
  right_id: number;
  right_genes: number[];
  seed: string;
}
export interface GeneratedCandidate { id: number; genes: number[] }
export interface MaterializedCandidate {
  id: number;
  artifact_key?: string;
  media_type?: string;
  data?: unknown;
}
export interface AdapterCapabilities {
  operator_mode?: "builtin" | "adapter";
  max_concurrency?: number;
  validate_front?: boolean;
  materialize?: boolean;
}
export interface AdapterContext { runId: string; problem: ProblemBundle }

export interface GeneticAssemblyAdapter {
  readonly version: string;
  initialize(context: AdapterContext): AdapterCapabilities | Promise<AdapterCapabilities>;
  evaluateBatch(
    candidates: readonly EvaluationRequest[],
    phase: string,
  ): EvaluatedCandidate[] | Promise<EvaluatedCandidate[]>;
  seedPopulation?(request: SeedPopulationRequest): number[][] | Promise<number[][]>;
  makeOffspring?(
    requests: readonly OffspringRequest[],
  ): GeneratedCandidate[] | Promise<GeneratedCandidate[]>;
  validateFront?(
    candidates: readonly EvaluationRequest[],
  ): EvaluatedCandidate[] | Promise<EvaluatedCandidate[]>;
  materialize?(
    candidates: readonly EvaluationRequest[],
  ): MaterializedCandidate[] | Promise<MaterializedCandidate[]>;
  cancel?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface RequestEnvelope {
  protocol_version: typeof ADAPTER_PROTOCOL_VERSION;
  request_id: number;
  type: string;
  [key: string]: unknown;
}

export interface ResponseEnvelope {
  protocol_version: typeof ADAPTER_PROTOCOL_VERSION;
  request_id: number;
  type: string;
  [key: string]: unknown;
}
