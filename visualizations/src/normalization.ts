import type { OptimizationDataset, VizCandidate, VizLever } from "./types.js";

export function directionalPercentiles(
  candidates: VizCandidate[],
  objectiveIndex: number,
  direction: "minimize" | "maximize",
): Map<number, number> {
  if (candidates.length === 0) return new Map();
  const ordered = candidates
    .map((candidate) => ({
      id: candidate.individual.id,
      value: candidate.individual.objectives[objectiveIndex],
    }))
    .sort((left, right) => left.value - right.value || left.id - right.id);
  if (ordered[0].value === ordered[ordered.length - 1].value) {
    return new Map(ordered.map(({ id }) => [id, 0.5]));
  }
  const ranks = new Map<number, number>();
  let start = 0;
  while (start < ordered.length) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const averageRank = (start + end - 1) / 2;
    const ascending = averageRank / (ordered.length - 1);
    const fitness = direction === "minimize" ? 1 - ascending : ascending;
    for (let index = start; index < end; index += 1) ranks.set(ordered[index].id, fitness);
    start = end;
  }
  return ranks;
}

export function normalizedLeverValue(value: number, lever: VizLever): number {
  if (lever.kind === "binary") return value >= 0.5 ? 1 : 0;
  const lower = lever.lower ?? 0;
  const upper = lever.upper ?? 1;
  if (upper === lower) return 0.5;
  return Math.min(1, Math.max(0, (value - lower) / (upper - lower)));
}

export function isConstraintFeasible(value: number): boolean {
  return Number.isFinite(value) && value <= 0;
}

export function selectedCandidates(dataset: OptimizationDataset, ids: Array<number | undefined>): VizCandidate[] {
  const wanted = new Set(ids.filter((id): id is number => id !== undefined));
  return dataset.candidates.filter((candidate) => wanted.has(candidate.individual.id));
}
