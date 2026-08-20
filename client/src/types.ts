export type Axis = "x" | "y" | "z";

export type Variable =
  | { kind: "real"; lower: number; upper: number }
  | { kind: "integer"; lower: number; upper: number; step?: number }
  | { kind: "binary" };

export type LeverTarget =
  | { type: "position"; object_id: string; axis: Axis }
  | { type: "rotation"; object_id: string; axis: Axis }
  | { type: "scale"; object_id: string; axis: Axis }
  | { type: "visibility"; object_id: string }
  | { type: "material"; object_id: string; property: string }
  | { type: "user_data"; object_id: string; path: string };

export type LeverSpec = Variable & { id: string; target: LeverTarget };

export interface ManifestObject {
  id: string;
  numeric_metadata?: Record<string, number>;
  numeric_properties?: Record<string, number>;
  visible?: boolean;
}

export interface SceneManifest { schema_version?: 1; objects?: ManifestObject[]; levers: LeverSpec[] }

export interface Objective { name: string; direction: "minimize" | "maximize" }
export interface ConstraintDefinition { name: string }
export interface EvaluatorManifest {
  api_version?: 1;
  objectives: Objective[];
  constraints?: ConstraintDefinition[];
}
export interface ScriptLimits { memory_bytes?: number; stack_bytes?: number; timeout_ms?: number }
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
export interface RunStatus {
  id: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  current_generation: number; config: Nsga2Config; error?: string;
  created_at: string; started_at?: string; finished_at?: string;
}
export interface Individual {
  id: number; genes: number[]; objectives: number[]; constraints: number[];
  constraint_violation: number; rank: number; crowding_distance: number;
}
export interface ScenePatch { lever_id: string; target: LeverTarget; value: number }
export interface ResultMember { individual: Individual; patches: ScenePatch[] }
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
export type AnalyticsLever = LeverSpec & { index: number };
export interface AnalyticsConstraint {
  index: number;
  name: string;
  feasible_when: "lte_zero";
}
export interface RunAnalytics {
  schema_version: 1;
  run_id: string;
  status: RunStatus["status"];
  history_complete: boolean;
  objectives: AnalyticsObjective[];
  levers: AnalyticsLever[];
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
