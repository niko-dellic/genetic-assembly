// Example usage of genetic-assembly WASM APIs

import init, { solve_json, solve_buffers } from './pkg/genetic_assembly.js';

// Initialize the WASM module
await init();

console.log('WASM module initialized!');

// ============================================================================
// Example 1: Using solve_json API (recommended for most use cases)
// ============================================================================

const spec = {
  algorithm: "nsga2",           // Use NSGA-II algorithm
  num_vars: 5,                  // 5 decision variables (binary)
  population_size: 100,         // Population size
  num_iterations: 200,          // Number of generations
  crossover_rate: 0.9,          // 90% crossover probability
  mutation_rate: 0.1,           // 10% mutation probability
  num_offsprings: 50,           // Generate 50 offspring per generation
  objectives: [
    // Multi-objective knapsack problem:
    // Objective 1: maximize value (negative for minimization)
    [-4, -2, -1, -5, -3],
    // Objective 2: minimize weight
    [12, 2, 1, 4, 10]
  ]
};

const resultJson = solve_json(JSON.stringify(spec));
const result = JSON.parse(resultJson);

console.log('Pareto Front Size:', result.stats.pareto_size);
console.log('Pareto Front Solutions:', result.pareto);
console.log('Statistics:', result.stats);

// ============================================================================
// Example 2: Using solve_buffers API (for high-performance scenarios)
// ============================================================================

const dims = 5;
const objectives = new Float64Array([
  -4, -2, -1, -5, -3,  // Objective 1 (row 1)
  12, 2, 1, 4, 10      // Objective 2 (row 2)
]);

const bufferResult = solve_buffers(
  null,           // No initial population
  dims,           // 5 variables
  objectives,     // Objective matrix
  2,              // 2 objectives
  5,              // 5 variables per objective
  100,            // Population size
  200             // Generations
);

console.log('Buffer result (flattened genes):', bufferResult);

// ============================================================================
// Example 3: Using with Web Worker (non-blocking)
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
      const result = solve_json(JSON.stringify(payload));
      const endTime = performance.now();
      
      self.postMessage({ 
        type: 'SOLVE_SUCCESS', 
        result: JSON.parse(result),
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
  const { type, result, error, time } = e.data;
  
  if (type === 'INIT_SUCCESS') {
    console.log('Worker ready!');
    
    // Send optimization task
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
        ]
      }
    });
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
  const returns = assets.map(a => -a.expectedReturn);
  
  // Objective 2: Minimize portfolio risk (variance)
  const risks = assets.map(a => a.risk);
  
  const portfolioSpec = {
    algorithm: "nsga2",
    num_vars: n,
    population_size: 100,
    num_iterations: 300,
    crossover_rate: 0.9,
    mutation_rate: 0.15,
    num_offsprings: 50,
    objectives: [returns, risks]
  };
  
  const result = solve_json(JSON.stringify(portfolioSpec));
  return JSON.parse(result);
}

// Example usage:
const assets = [
  { name: 'Asset A', expectedReturn: 0.12, risk: 0.15 },
  { name: 'Asset B', expectedReturn: 0.08, risk: 0.08 },
  { name: 'Asset C', expectedReturn: 0.15, risk: 0.20 },
  { name: 'Asset D', expectedReturn: 0.10, risk: 0.10 },
  { name: 'Asset E', expectedReturn: 0.06, risk: 0.05 },
];

const portfolioResult = optimizePortfolio(assets);
console.log('Optimal portfolios (Pareto front):', portfolioResult.pareto);

// Interpret results: 1 = include asset, 0 = exclude asset
portfolioResult.pareto.forEach((portfolio, i) => {
  const selectedAssets = portfolio
    .map((selected, idx) => selected === 1 ? assets[idx].name : null)
    .filter(Boolean);
  console.log(`Portfolio ${i + 1}:`, selectedAssets.join(', '));
});
