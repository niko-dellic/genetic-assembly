import {
  compileStudy,
  encodeDecisions,
  type CandidateResult,
  type GenerationSnapshot,
  type StudySpec,
} from "@genetic-assembly/sdk";
import type {
  NumericStatistics,
  OptimizationDataset,
  VizIndividual,
} from "./types.js";
/** Convert authoritative SDK snapshots to chart data without inferring survivors or fronts. */
export function fromGenerationSnapshots(
  study: StudySpec,
  snapshots: GenerationSnapshot[],
  evidence: CandidateResult[],
): OptimizationDataset {
  const candidates = new Map(
    evidence.map((candidate) => [candidate.candidateId, candidate]),
  );
  const constraintNames = [
    ...Object.keys(study.constraints),
    "domain_validity",
  ];
  function individual(
    member: GenerationSnapshot["population"][number],
  ): VizIndividual {
    const candidate = candidates.get(member.candidateId);
    if (!candidate)
      throw Error(`Missing evidence for candidate ${member.candidateId}`);
    const id = Number(member.candidateId);
    if (!Number.isSafeInteger(id) || id < 0)
      throw Error("Chart candidate IDs must be numeric solver IDs");
    const constraints = constraintNames.map(
      (key) => candidate.constraints[key] ?? 0,
    );
    return {
      id,
      genes: encodeDecisions(study, candidate.decisions),
      objectives: Object.values(study.objectives).map(
        (goal) => candidate.metrics[goal.metric],
      ),
      constraints,
      constraint_violation: constraints.reduce(
        (sum, value) => sum + Math.max(0, value),
        0,
      ),
      rank: member.rank,
      crowding_distance: member.crowdingDistance ?? Infinity,
    };
  }
  const stats = (values: number[]): NumericStatistics => {
    if (!values.length) return { min: 0, max: 0, mean: 0, stddev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      stddev: Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          values.length,
      ),
    };
  };
  const compiled = compileStudy(study);
  return {
    objectives: Object.entries(study.objectives).map(([name, goal], index) => ({
      index,
      name,
      direction: goal.direction,
    })),
    levers: compiled.problem.variables.map((variable, index) => ({
      index,
      id: Object.keys(study.decisions)[index],
      kind:
        variable.kind === "real"
          ? "real"
          : variable.kind === "binary"
            ? "binary"
            : "integer",
      ...("lower" in variable
        ? { lower: variable.lower, upper: variable.upper }
        : {}),
    })),
    constraints: constraintNames.map((name, index) => ({
      index,
      name,
      feasible_when: "lte_zero",
    })),
    candidates: (snapshots.at(-1)?.population ?? []).map((member) => ({
      individual: individual(member),
    })),
    generations: snapshots.map((snapshot) => {
      const population = snapshot.population.map(individual);
      return {
        generation: snapshot.generation,
        evaluations: snapshot.summary.evaluations,
        population_size: population.length,
        pareto_size: snapshot.paretoCandidateIds.length,
        sampled_front: population.filter((member) =>
          snapshot.paretoCandidateIds.includes(String(member.id)),
        ),
        feasible_count: snapshot.summary.feasible_count,
        infeasible_count: snapshot.summary.infeasible_count,
        objective_stats: Object.keys(study.objectives).map((_, index) =>
          stats(population.map((c) => c.objectives[index])),
        ),
        constraint_stats: constraintNames.map((_, index) =>
          stats(population.map((c) => c.constraints[index])),
        ),
      };
    }),
    history_complete: true,
  };
}
