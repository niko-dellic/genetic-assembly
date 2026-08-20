import {
  defineAdapter,
  type AdapterContext,
  type EvaluatedCandidate,
  type EvaluationRequest,
  type GeneticAssemblyAdapter,
  type GeneratedCandidate,
  type OffspringRequest,
  type SeedPopulationRequest,
} from "@genetic-assembly/adapter-sdk";

type Plan = [warehouses: number, vans: number, staff: number, automation: number];
let context: AdapterContext | undefined;

function random(seed: string): () => number {
  let state = BigInt(seed) & 0xffff_ffff_ffff_ffffn;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    state &= 0xffff_ffff_ffff_ffffn;
    return Number(state >> 11n) / 9_007_199_254_740_992;
  };
}

function capacity(plan: Plan): number {
  return plan[0] * 14 + plan[1] * 5 + plan[2] * 2 + plan[3] * 30;
}

function cost(plan: Plan): number {
  return plan[0] * 34 + plan[1] * 7 + plan[2] * 3 + plan[3] * 58;
}

function repair(input: readonly number[]): Plan {
  const plan: Plan = [
    clamp(Math.round(input[0] ?? 1), 1, 12),
    clamp(Math.round(input[1] ?? 1), 1, 20),
    clamp(Math.round(input[2] ?? 2), 2, 30),
    (input[3] ?? 0) >= 0.5 ? 1 : 0,
  ];
  while (capacity(plan) < 80 && plan[2] < 30) plan[2] += 1;
  while (capacity(plan) < 80 && plan[1] < 20) plan[1] += 1;
  while (capacity(plan) < 80 && plan[0] < 12) plan[0] += 1;
  return plan;
}

function evaluateOne(candidate: EvaluationRequest, seedCount: number): EvaluatedCandidate {
  const started = performance.now();
  const plan = repair(candidate.genes);
  const times: number[] = [];
  const emissions: number[] = [];
  for (let index = 0; index < seedCount; index += 1) {
    // Common deterministic seeds make candidate comparisons fair and keep a
    // repeated genome identical regardless of scheduling or candidate ID.
    const rng = random(String(BigInt(index * 97 + 11)));
    const demand = 72 + rng() * 38;
    const congestion = 0.85 + rng() * 0.45;
    const available = Math.max(1, capacity(plan) - demand);
    times.push(18 + 180 / available + 30 / plan[0] + congestion * 8 - plan[3] * 2.5);
    emissions.push(demand * congestion * (1.35 - plan[1] * 0.035) + plan[0] * 4);
  }
  return {
    id: candidate.id,
    genes: plan,
    evaluation: {
      objectives: [cost(plan), mean(times), mean(emissions)],
      constraints: [80 - capacity(plan), cost(plan) - 500],
      evidence: {
        runtime_ms: Math.round(performance.now() - started),
        metadata: { seed_count: String(seedCount), capacity: String(capacity(plan)) },
      },
    },
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

export const referenceAdapter: GeneticAssemblyAdapter = defineAdapter({
  version: "delivery-network-v1",
  initialize: (nextContext) => {
    context = nextContext;
    return {
      operator_mode: "adapter",
      max_concurrency: 1,
      validate_front: true,
      materialize: true,
    };
  },
  seedPopulation: (request: SeedPopulationRequest) => request.seeds.map((seed, index) => {
    const rng = random(seed);
    if (index === 0) return repair([3, 8, 12, 0]);
    return repair([
      1 + Math.floor(rng() * 12),
      1 + Math.floor(rng() * 20),
      2 + Math.floor(rng() * 29),
      rng() > 0.5 ? 1 : 0,
    ]);
  }),
  makeOffspring: (requests: readonly OffspringRequest[]): GeneratedCandidate[] =>
    requests.map((request) => {
      const rng = random(request.seed);
      const genes = rng() < 0.5
        ? [request.left_genes[0], request.right_genes[1], request.right_genes[2], request.left_genes[3]]
        : [request.right_genes[0], request.left_genes[1], request.left_genes[2], request.right_genes[3]];
      const index = Math.floor(rng() * genes.length);
      if (index === 3) genes[index] = genes[index] === 0 ? 1 : 0;
      else genes[index] = Number(genes[index] ?? 0) + (rng() < 0.5 ? -1 : 1);
      return { id: request.id, genes: repair(genes) };
    }),
  evaluateBatch: (candidates) => {
    if (context === undefined) throw new Error("Adapter was not initialized");
    return candidates.map((candidate) => evaluateOne(candidate, 5));
  },
  validateFront: (candidates) => candidates.map((candidate) => evaluateOne(candidate, 32)),
  materialize: (candidates) => candidates.map((candidate) => {
    const plan = repair(candidate.genes);
    return {
      id: candidate.id,
      media_type: "application/json",
      data: {
        warehouses: plan[0],
        electricVans: plan[1],
        staff: plan[2],
        automation: plan[3] === 1,
        capacity: capacity(plan),
        operatingCost: cost(plan),
      },
    };
  }),
});
