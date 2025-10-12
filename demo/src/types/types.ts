// Shared TypeScript types for genetic-assembly

export interface ProgressData {
  generation: number;
  pareto_front: Solution[];
  full_population: Solution[];
  pareto_size: number;
  population_size: number;
  workerId?: number; // Added by worker when forwarding
}

export interface Solution {
  genes: number[];
  objectives: number[];
  rank: number;
  crowding_distance: number;
}

export interface OptimizationSpec {
  algorithm: "nsga2" | "nsga3";
  num_vars: number;
  population_size: number;
  num_iterations: number;
  crossover_rate: number;
  mutation_rate: number;
  num_offsprings: number;
  objectives: number[][];
  constraints?: number[][];
  initial_population?: number[][];
  seed?: number;
  progress_interval?: number;
  workers?: boolean | number; // true = auto-detect cores, number = specific count
  migration_interval?: number; // Generations between migrations (default: 20)
  migration_rate?: number; // Percentage of population to migrate (default: 0.1)
}

export interface OptimizationResult {
  pareto: number[][];
  stats: OptimizationStats;
  full_population?: number[][];
  executionTime?: number;
}

export interface OptimizationStats {
  iterations: number;
  population_size: number;
  pareto_size: number;
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (data: ProgressData) => void;
