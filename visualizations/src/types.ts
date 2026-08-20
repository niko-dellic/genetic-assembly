export type ObjectiveDirection = "minimize" | "maximize";

export interface VizObjective {
  index: number;
  name: string;
  direction: ObjectiveDirection;
}

export interface VizLever {
  index: number;
  id: string;
  kind: "real" | "integer" | "binary";
  lower?: number;
  upper?: number;
  step?: number;
}

export interface VizConstraint {
  index: number;
  name: string;
  feasible_when: "lte_zero";
}

export interface VizIndividual {
  id: number;
  genes: number[];
  objectives: number[];
  constraints: number[];
  constraint_violation: number;
  rank: number;
  crowding_distance: number;
}

export interface VizCandidate {
  individual: VizIndividual;
}

export interface NumericStatistics {
  min: number;
  max: number;
  mean: number;
  stddev: number;
}

export interface VizGeneration {
  generation: number;
  population_size: number;
  pareto_size: number;
  evaluations: number;
  sampled_front: VizIndividual[];
  objective_stats: NumericStatistics[];
  constraint_stats: NumericStatistics[];
  total_violation_stats?: NumericStatistics;
  feasible_count: number;
  infeasible_count: number;
}

export interface OptimizationDataset {
  objectives: VizObjective[];
  levers: VizLever[];
  constraints: VizConstraint[];
  candidates: VizCandidate[];
  generations: VizGeneration[];
  history_complete: boolean;
}

export interface SelectionState {
  activeId?: number;
  hoveredId?: number;
  pinnedIds: number[];
  filteredIds?: Set<number>;
}

export interface VisualizationFrame {
  dataset: OptimizationDataset;
  selection: SelectionState;
  xObjective?: number;
  yObjective?: number;
}

export interface VisualizationCallbacks {
  onHover?: (id?: number) => void;
  onSelect?: (id: number) => void;
  onFilter?: (ids?: Set<number>) => void;
}

export interface VisualizationController {
  update(frame: VisualizationFrame): void;
  resize(): void;
  destroy(): void;
}
