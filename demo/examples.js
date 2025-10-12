// Example usage of genetic-assembly WASM APIs

import init, { solve_json, solve_buffers } from "../pkg/genetic_assembly.js";

// Initialize the WASM module
await init();

console.log("WASM module initialized!");

// ============================================================================
// Example 1: Using solve_json API (recommended for most use cases)
// ============================================================================

const spec = {
  algorithm: "nsga2", // Use NSGA-II algorithm
  num_vars: 5, // 5 decision variables (binary)
  population_size: 100, // Population size
  num_iterations: 200, // Number of generations
  crossover_rate: 0.9, // 90% crossover probability
  mutation_rate: 0.1, // 10% mutation probability
  num_offsprings: 50, // Generate 50 offspring per generation
  objectives: [
    // Multi-objective knapsack problem:
    // Objective 1: maximize value (negative for minimization)
    [-4, -2, -1, -5, -3],
    // Objective 2: minimize weight
    [12, 2, 1, 4, 10],
  ],
};

const result = solve_json(spec);

console.log("Pareto Front Size:", result.stats.pareto_size);
console.log("Pareto Front Solutions:", result.pareto);
console.log("Statistics:", result.stats);

// ============================================================================
// Example 2: Using solve_buffers API (for high-performance scenarios)
// ============================================================================

const dims = 5;
const objectives = new Float64Array([
  -4,
  -2,
  -1,
  -5,
  -3, // Objective 1 (row 1)
  12,
  2,
  1,
  4,
  10, // Objective 2 (row 2)
]);

const bufferResult = solve_buffers(
  null, // No initial population
  dims, // 5 variables
  objectives, // Objective matrix
  2, // 2 objectives
  5, // 5 variables per objective
  100, // Population size
  200 // Generations
);

console.log("Buffer result (flattened genes):", bufferResult);

// ============================================================================
// Example 3: Using progress callbacks for real-time visualization
// ============================================================================

const specWithProgress = {
  ...spec,
  progress_interval: 10, // Callback every 10 generations
};

console.log("\n=== Running with progress callbacks ===");

const resultWithProgress = solve_json(specWithProgress, (progressData) => {
  console.log(
    `Generation ${progressData.generation}: ` +
      `${progressData.pareto_size} Pareto solutions, ` +
      `Population size: ${progressData.population_size}`
  );
  // Here you could update Three.js scene, Plotly chart, etc.
  // progressData.pareto_front contains current non-dominated solutions
});

console.log("Final result:", resultWithProgress);

// ============================================================================
// Example 4: Parallel execution with multiple workers
// ============================================================================

console.log("\n=== Parallel execution examples ===");

// Auto-detect CPU cores (returns Promise)
const parallelSpec1 = {
  ...spec,
  workers: true, // Auto-detect cores
};

console.log("Running with auto-detected workers...");
const parallelResult1 = await solve_json(parallelSpec1); // Note: await required
console.log("Parallel result (auto):", parallelResult1.stats);

// Specify exact worker count (returns Promise)
const parallelSpec2 = {
  ...spec,
  workers: 4, // Use exactly 4 workers
  migration_interval: 50, // Migrate every 50 generations
  migration_rate: 0.15, // Migrate 15% of population
};

console.log("Running with 4 workers...");
const parallelResult2 = await solve_json(parallelSpec2); // Note: await required
console.log("Parallel result (4 workers):", parallelResult2.stats);

// Single-threaded for comparison (synchronous, no await needed)
console.log("Running single-threaded...");
const singleResult = solve_json(spec); // No workers = synchronous
console.log("Single-threaded result:", singleResult.stats);

// ============================================================================
// Example 5: Using with Web Worker (non-blocking)
// ============================================================================

// worker.js
/*
import init, { solve_json } from './pkg/genetic_assembly.js';

let isInitialized = false;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    await init();
    isInitialized = true;
    self.postMessage({ type: 'INIT_SUCCESS' });
    return;
  }

  if (type === 'SOLVE') {
    if (!isInitialized) {
      self.postMessage({ type: 'ERROR', error: 'Not initialized' });
      return;
    }

    try {
      const startTime = performance.now();
      
      // Progress callback for real-time updates
      const progressCallback = payload.progress_interval
        ? (progressData) => {
            self.postMessage({
              type: 'PROGRESS',
              data: progressData
            });
          }
        : undefined;
      
      const result = solve_json(payload, progressCallback);
      const endTime = performance.now();
      
      self.postMessage({ 
        type: 'SOLVE_SUCCESS', 
        result,  // Already parsed by WASM
        time: endTime - startTime
      });
    } catch (error) {
      self.postMessage({ type: 'ERROR', error: error.message });
    }
  }
};
*/

// main.js
/*
const worker = new Worker('./worker.js', { type: 'module' });

worker.onmessage = (e) => {
  const { type, result, error, time, data } = e.data;
  
  if (type === 'INIT_SUCCESS') {
    console.log('Worker ready!');
    
    // Send optimization task with progress callbacks
    worker.postMessage({
      type: 'SOLVE',
      payload: {
        algorithm: "nsga2",
        num_vars: 10,
        population_size: 200,
        num_iterations: 500,
        crossover_rate: 0.9,
        mutation_rate: 0.1,
        num_offsprings: 100,
        objectives: [
          Array.from({ length: 10 }, () => -Math.random() * 10),
          Array.from({ length: 10 }, () => Math.random() * 5)
        ],
        progress_interval: 50  // Progress every 50 generations
      }
    });
  }
  
  if (type === 'PROGRESS') {
    console.log(`Gen ${data.generation}: ${data.pareto_size} solutions`);
    // Update visualization in real-time (Three.js, Plotly, etc.)
  }
  
  if (type === 'SOLVE_SUCCESS') {
    console.log('Optimization completed in', time, 'ms');
    console.log('Result:', result);
  }
  
  if (type === 'ERROR') {
    console.error('Worker error:', error);
  }
};

worker.postMessage({ type: 'INIT' });
*/

// ============================================================================
// Example 4: Real-world problem - Portfolio Optimization
// ============================================================================

/**
 * Portfolio optimization: select assets to maximize return and minimize risk
 */
function optimizePortfolio(assets) {
  const n = assets.length;

  // Objective 1: Maximize expected return (negative for minimization)
  const returns = assets.map((a) => -a.expectedReturn);

  // Objective 2: Minimize portfolio risk (variance)
  const risks = assets.map((a) => a.risk);

  const portfolioSpec = {
    algorithm: "nsga2",
    num_vars: n,
    population_size: 100,
    num_iterations: 300,
    crossover_rate: 0.9,
    mutation_rate: 0.15,
    num_offsprings: 50,
    objectives: [returns, risks],
  };

  const result = solve_json(portfolioSpec);
  return result;
}

// Example usage:
const assets = [
  { name: "Asset A", expectedReturn: 0.12, risk: 0.15 },
  { name: "Asset B", expectedReturn: 0.08, risk: 0.08 },
  { name: "Asset C", expectedReturn: 0.15, risk: 0.2 },
  { name: "Asset D", expectedReturn: 0.1, risk: 0.1 },
  { name: "Asset E", expectedReturn: 0.06, risk: 0.05 },
];

const portfolioResult = optimizePortfolio(assets);
console.log("Optimal portfolios (Pareto front):", portfolioResult.pareto);

// Interpret results: 1 = include asset, 0 = exclude asset
portfolioResult.pareto.forEach((portfolio, i) => {
  const selectedAssets = portfolio
    .map((selected, idx) => (selected === 1 ? assets[idx].name : null))
    .filter(Boolean);
  console.log(`Portfolio ${i + 1}:`, selectedAssets.join(", "));
});

// ============================================================================
// Example 6: Three.js Integration
// ============================================================================

console.log("\n=== Three.js Integration Example ===");

// Note: This example shows the API usage pattern
// In a real Three.js application, you would import THREE and create actual meshes

import {
  buildThreeJsSpec,
  decodeThreeJsResult,
  applyGenes,
} from "../pkg/threejs-helpers.js";

// Mock Three.js object for demonstration
const createRoom = (userData) => ({
  userData,
  position: { toArray: () => [0, 0, 0], fromArray: (arr) => {} },
  rotation: { x: 0, y: 0, z: 0, set: (x, y, z) => {} },
  scale: { toArray: () => [1, 1, 1], fromArray: (arr) => {} },
});

// Create room with mutable and static userData
const room = createRoom({
  // Mutable properties (will be optimized)
  restaurant: 1000,
  residential: 2000,
  retail: 500,
  // Static properties (used for evaluation)
  totalArea: 3500,
  demandProfile: {
    restaurant: { morning: 50, afternoon: 100, evening: 150 },
    residential: { morning: 200, afternoon: 150, evening: 300 },
    retail: { morning: 80, afternoon: 150, evening: 100 },
  },
  capacityPerUnit: { restaurant: 0.1, residential: 0.05, retail: 0.08 },
});

// Define mutation function (genes to userData)
const mutationFn = (genes, staticProps) => ({
  restaurant: genes[0] * staticProps.totalArea,
  residential: genes[1] * staticProps.totalArea,
  retail: genes[2] * staticProps.totalArea,
});

// Define evaluation function (calculate objectives)
const evaluationFn = (userData, staticProps) => {
  // Simplified objective calculation
  const { restaurant, residential, retail } = userData;
  const { demandProfile, capacityPerUnit } = staticProps;

  // Objective 1: Minimize total overcrowding
  let overcrowding = 0;
  ["morning", "afternoon", "evening"].forEach((period) => {
    const demand = Object.keys(demandProfile).reduce((sum, landUse) => {
      return sum + demandProfile[landUse][period];
    }, 0);
    const capacity =
      restaurant * capacityPerUnit.restaurant +
      residential * capacityPerUnit.residential +
      retail * capacityPerUnit.retail;
    if (demand > capacity) {
      overcrowding += demand - capacity;
    }
  });

  // Objective 2: Minimize underutilization
  let underutilization = 0;
  ["morning", "afternoon", "evening"].forEach((period) => {
    const demand = Object.keys(demandProfile).reduce((sum, landUse) => {
      return sum + demandProfile[landUse][period];
    }, 0);
    const capacity =
      restaurant * capacityPerUnit.restaurant +
      residential * capacityPerUnit.residential +
      retail * capacityPerUnit.retail;
    if (capacity > demand * 1.2) {
      // 20% buffer acceptable
      underutilization += capacity - demand * 1.2;
    }
  });

  return [overcrowding, underutilization];
};

// Build Three.js optimization spec
// Note: Functions are automatically serialized for worker transfer
// Functions must be self-contained (no closures - no external variable references)
const threejsSpec = buildThreeJsSpec([room], {
  mutableProps: ["restaurant", "residential", "retail"],
  staticProps: ["totalArea", "demandProfile", "capacityPerUnit"],
  mutationFn,
  evaluationFn,
  populationSize: 50,
  generations: 100,
  workers: false, // Set to true for parallel execution (functions will be serialized)
});

console.log("Running Three.js userData optimization...");
const threejsResult = await solve_json(threejsSpec);

console.log(
  `Found ${threejsResult.stats.pareto_size} optimal room configurations`
);
console.log(`Execution time: ${threejsResult.executionTime}ms`);

// Decode and apply best solution
const roomSolutions = decodeThreeJsResult(threejsResult, threejsSpec);
const bestRoomConfig = roomSolutions[0];

console.log("\nBest room configuration:");
console.log(`  Restaurant: ${bestRoomConfig.restaurant.toFixed(0)} sqft`);
console.log(`  Residential: ${bestRoomConfig.residential.toFixed(0)} sqft`);
console.log(`  Retail: ${bestRoomConfig.retail.toFixed(0)} sqft`);

// Apply to Three.js object
Object.assign(room.userData, bestRoomConfig);
console.log("\nUpdated room.userData:", room.userData);
