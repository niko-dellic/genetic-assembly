export type Variable =
  | { kind: "real"; lower: number; upper: number }
  | { kind: "integer"; lower: number; upper: number; step?: number }
  | { kind: "binary" };

export interface Objective { name: string; direction: "minimize" | "maximize" }
export interface ConstraintSpec { name: string; feasible_when?: "lte_zero" }
export interface ProblemSpec { variables: Variable[]; objectives: Objective[] }
export interface ArtifactReference {
  name: string;
  content_hash: string;
  artifact_key: string;
  media_type?: string;
}
export interface ProblemBundle {
  schema_version?: 1;
  name: string;
  problem: ProblemSpec;
  variable_ids?: string[];
  constraints?: ConstraintSpec[];
  artifacts?: ArtifactReference[];
  metadata?: unknown;
}
export interface AdapterLaunch {
  name: string;
  adapter_version: string;
  protocol_version?: "genetic-assembly-adapter-v1";
  command: string;
  args?: string[];
  working_directory?: string;
  environment?: Record<string, string>;
  timeout_ms?: number;
  retry_limit?: number;
}
export interface Nsga2Config {
  population_size?: number;
  generations?: number;
  crossover_probability?: number;
  mutation_probability?: number | null;
  sbx_distribution_index?: number;
  mutation_distribution_index?: number;
  seed?: number;
  threads?: number | null;
}
export interface Revision { id: string; content_hash: string }
export interface ArtifactResponse extends Revision {
  artifact_key: string;
  media_type?: string;
  byte_length: number;
}
export interface RunStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  current_generation: number;
  config: Nsga2Config;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}
export interface EvaluationEvidence {
  artifact_key?: string;
  metadata?: Record<string, string>;
  warnings?: string[];
  runtime_ms?: number;
}
export interface Individual {
  id: number;
  genes: number[];
  objectives: number[];
  constraints: number[];
  constraint_violation: number;
  rank: number;
  crowding_distance: number;
  evidence?: EvaluationEvidence;
}
export interface MaterializedCandidate {
  id: number;
  artifact_key?: string;
  media_type?: string;
  data: unknown;
}
export interface ResultMember {
  individual: Individual;
  patches: unknown[];
  materialization?: MaterializedCandidate;
}
export interface RunResults { run_id: string; members: ResultMember[] }
export interface NumericStatistics { min: number; max: number; mean: number; stddev: number }
export interface GenerationAnalytics {
  generation: number;
  population_size: number;
  pareto_size: number;
  evaluations: number;
  sampled_front: Individual[];
  objective_stats: NumericStatistics[];
  constraint_stats: NumericStatistics[];
  total_violation_stats?: NumericStatistics;
  feasible_count: number;
  infeasible_count: number;
}
export interface AnalyticsObjective extends Objective { index: number }
export type AnalyticsVariable = Variable & { index: number; id: string; target?: unknown };
export interface AnalyticsConstraint { index: number; name: string; feasible_when: "lte_zero" }
export interface RunAnalytics {
  schema_version: 1;
  run_id: string;
  status: RunStatus["status"];
  history_complete: boolean;
  objectives: AnalyticsObjective[];
  levers: AnalyticsVariable[];
  constraints: AnalyticsConstraint[];
  candidates: ResultMember[];
  generations: GenerationAnalytics[];
}
export type RunEvent =
  | { type: "status"; run_id: string; status: string }
  | { type: "generation"; run_id: string; summary: GenerationAnalytics }
  | { type: "checkpoint"; run_id: string; generation: number }
  | { type: "completed"; run_id: string; pareto_size: number }
  | { type: "failed"; run_id: string; error: string };
