import type { OptimizationDataset } from "./types.js";

export function validateDataset(dataset: OptimizationDataset): void {
  const objectiveCount = dataset.objectives.length;
  const leverCount = dataset.levers.length;
  const constraintCount = dataset.constraints.length;
  const ids = new Set<number>();
  dataset.candidates.forEach((candidate, candidateIndex) => {
    const individual = candidate.individual;
    if (ids.has(individual.id)) throw new Error(`Duplicate candidate ID ${individual.id}`);
    ids.add(individual.id);
    assertLength(individual.objectives, objectiveCount, `candidate ${candidateIndex} objectives`);
    assertLength(individual.genes, leverCount, `candidate ${candidateIndex} genes`);
    assertLength(individual.constraints, constraintCount, `candidate ${candidateIndex} constraints`);
    assertFinite([...individual.objectives, ...individual.genes, ...individual.constraints, individual.constraint_violation], `candidate ${candidateIndex}`);
  });
  dataset.generations.forEach((generation) => {
    if (dataset.history_complete) {
      assertLength(generation.objective_stats, objectiveCount, `generation ${generation.generation} objective statistics`);
      assertLength(generation.constraint_stats, constraintCount, `generation ${generation.generation} constraint statistics`);
    }
    if (dataset.history_complete && generation.feasible_count + generation.infeasible_count !== generation.population_size) {
      throw new Error(`Generation ${generation.generation} feasibility counts do not match its population`);
    }
  });
}

function assertLength(values: unknown[], expected: number, label: string): void {
  if (values.length !== expected) throw new Error(`${label} length ${values.length} does not match ${expected}`);
}

function assertFinite(values: number[], label: string): void {
  if (values.some((value) => !Number.isFinite(value))) throw new Error(`${label} contains a non-finite value`);
}
