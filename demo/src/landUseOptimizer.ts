// Land Use Allocation Optimizer

export interface LandUse {
  name: string;
  capacityPerSqft: number; // people per sqft (inverse of sqft per person)
  minArea: number; // minimum viable area in sqft
}

export interface DemandPattern {
  [landUse: string]: {
    morning: number; // patron count
    afternoon: number;
    evening: number;
  };
}

export interface LandUseProblem {
  totalArea: number; // total area in sqft
  unitSize: number; // size of each decision variable unit in sqft
  landUses: LandUse[];
  demandPatterns: DemandPattern;
}

export interface LandUseAllocation {
  [landUseName: string]: number; // area in sqft
}

export interface UtilizationMetrics {
  [landUseName: string]: {
    [period: string]: {
      capacity: number;
      demand: number;
      utilization: number;
      overcrowding: number;
      underutilization: number;
    };
  };
}

export interface LandUseSolution {
  allocations: LandUseAllocation;
  objectives: {
    overcrowding: number;
    underutilization: number;
  };
  metrics: UtilizationMetrics;
  genes: number[]; // binary representation
}

/**
 * Decode binary solution into area allocations
 */
export function decodeSolution(
  solution: number[],
  problem: LandUseProblem
): LandUseAllocation {
  const allocations: LandUseAllocation = {};
  const numUnits = problem.totalArea / problem.unitSize;
  const unitsPerLandUse = Math.floor(numUnits / problem.landUses.length);

  problem.landUses.forEach((landUse, idx) => {
    const startIdx = idx * unitsPerLandUse;
    const endIdx = Math.min(
      (idx + 1) * unitsPerLandUse,
      idx === problem.landUses.length - 1
        ? solution.length
        : (idx + 1) * unitsPerLandUse
    );

    // Count active units (genes = 1)
    let activeUnits = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (solution[i] === 1) {
        activeUnits++;
      }
    }

    // Convert to area, ensuring minimum area
    const area = Math.max(activeUnits * problem.unitSize, landUse.minArea);
    allocations[landUse.name] = area;
  });

  return allocations;
}

/**
 * Calculate objectives for a given solution
 */
export function calculateObjectives(
  solution: number[],
  problem: LandUseProblem
): [number, number] {
  const allocations = decodeSolution(solution, problem);

  let totalOvercrowding = 0;
  let totalUnderutilization = 0;

  const periods = ["morning", "afternoon", "evening"] as const;

  for (const landUse of problem.landUses) {
    const area = allocations[landUse.name];
    const capacity = area * landUse.capacityPerSqft;

    for (const period of periods) {
      const demand = problem.demandPatterns[landUse.name][period];

      // Overcrowding penalty (squared for non-linearity)
      if (demand > capacity) {
        totalOvercrowding += Math.pow(demand - capacity, 2);
      }

      // Underutilization penalty
      if (capacity > 0) {
        const utilization = demand / capacity;
        if (utilization < 1) {
          totalUnderutilization += Math.pow(1 - utilization, 2);
        }
      }
    }
  }

  return [totalOvercrowding, totalUnderutilization];
}

/**
 * Calculate detailed metrics for a solution
 */
export function calculateMetrics(
  solution: number[],
  problem: LandUseProblem
): UtilizationMetrics {
  const allocations = decodeSolution(solution, problem);
  const metrics: UtilizationMetrics = {};

  const periods = ["morning", "afternoon", "evening"] as const;

  for (const landUse of problem.landUses) {
    metrics[landUse.name] = {};
    const area = allocations[landUse.name];
    const capacity = area * landUse.capacityPerSqft;

    for (const period of periods) {
      const demand = problem.demandPatterns[landUse.name][period];
      const utilization = capacity > 0 ? demand / capacity : 0;

      metrics[landUse.name][period] = {
        capacity,
        demand,
        utilization,
        overcrowding: Math.max(0, demand - capacity),
        underutilization: Math.max(0, capacity - demand),
      };
    }
  }

  return metrics;
}

/**
 * Build objective coefficient matrices for NSGA-II
 * This is a simplified linear approximation of the actual non-linear objectives
 */
export function buildObjectiveMatrices(problem: LandUseProblem): number[][] {
  const numUnits = problem.totalArea / problem.unitSize;
  const unitsPerLandUse = Math.floor(numUnits / problem.landUses.length);

  // Two objectives: overcrowding and underutilization
  const obj1Coeffs = new Array(numUnits).fill(0);
  const obj2Coeffs = new Array(numUnits).fill(0);

  const periods = ["morning", "afternoon", "evening"] as const;

  problem.landUses.forEach((landUse, landUseIdx) => {
    const startIdx = landUseIdx * unitsPerLandUse;
    const endIdx = Math.min(
      (landUseIdx + 1) * unitsPerLandUse,
      landUseIdx === problem.landUses.length - 1
        ? numUnits
        : (landUseIdx + 1) * unitsPerLandUse
    );

    // Calculate average demand across periods
    let avgDemand = 0;
    for (const period of periods) {
      avgDemand += problem.demandPatterns[landUse.name][period];
    }
    avgDemand /= periods.length;

    // Coefficient represents marginal contribution
    const capacityPerUnit = problem.unitSize * landUse.capacityPerSqft;

    for (let i = startIdx; i < endIdx; i++) {
      // Objective 1: Overcrowding (negative = bad when capacity is low)
      // Linear approximation: each unit reduces overcrowding
      obj1Coeffs[i] = -capacityPerUnit;

      // Objective 2: Underutilization (positive = bad when capacity is high)
      // Linear approximation: each unit increases potential underutilization
      obj2Coeffs[i] = capacityPerUnit - avgDemand / (endIdx - startIdx);
    }
  });

  return [obj1Coeffs, obj2Coeffs];
}

/**
 * Create a complete solution object from genes
 */
export function createSolution(
  genes: number[],
  problem: LandUseProblem
): LandUseSolution {
  const allocations = decodeSolution(genes, problem);
  const [overcrowding, underutilization] = calculateObjectives(genes, problem);
  const metrics = calculateMetrics(genes, problem);

  return {
    allocations,
    objectives: {
      overcrowding,
      underutilization,
    },
    metrics,
    genes,
  };
}

/**
 * Example problem instance
 */
export function createExampleProblem(): LandUseProblem {
  return {
    totalArea: 10000, // 10,000 sqft total
    unitSize: 100, // 100 sqft per decision variable
    landUses: [
      {
        name: "Restaurant",
        capacityPerSqft: 0.1, // 10 sqft per person
        minArea: 1000,
      },
      {
        name: "Residential",
        capacityPerSqft: 0.02, // 50 sqft per person
        minArea: 2000,
      },
      {
        name: "Retail",
        capacityPerSqft: 0.05, // 20 sqft per person
        minArea: 1000,
      },
    ],
    demandPatterns: {
      Restaurant: { morning: 50, afternoon: 150, evening: 200 },
      Residential: { morning: 100, afternoon: 80, evening: 120 },
      Retail: { morning: 80, afternoon: 120, evening: 100 },
    },
  };
}
