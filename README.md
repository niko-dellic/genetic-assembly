# genetic-assembly

WebAssembly wrapper for NSGA-II/III multi-objective genetic algorithms with parallel island model support.

## Features

- 🚀 **High Performance**: Compiled to WebAssembly for near-native performance
- 🧬 **NSGA-II Algorithm**: Fast non-dominated sorting genetic algorithm
- 🏝️ **Parallel Island Model**: Distribute optimization across multiple CPU cores
- 👷 **Web Worker Pool**: Automatic worker management and load balancing
- 🔄 **Solution Migration**: Periodic elite exchange between islands for better convergence
- 📦 **TypeScript APIs**: Fully typed interfaces for easy integration
- 🎯 **Two API Styles**: JSON-based and buffer-based APIs

## Implementation

This project provides a custom WebAssembly-compatible implementation of the NSGA-II (Non-dominated Sorting Genetic Algorithm II) algorithm. While inspired by the [moors](https://github.com/andresliszt/moo-rs/) library's approach to multi-objective optimization, we implemented a standalone version that compiles to WebAssembly without dependency conflicts.

The implementation includes:

- Fast non-dominated sorting for Pareto front identification
- Crowding distance calculation for solution diversity
- Binary tournament selection
- Single-point crossover and bit-flip mutation operators
- Support for binary decision variables

## Installation

### Prerequisites

- Rust toolchain (1.90+)
- Node.js (20+)
- wasm-pack

### Build from Source

```bash
# Install wasm-pack if not already installed
cargo install wasm-pack

# Build the WASM package
npm run build:wasm

# Install node packages
npm i

# Run the demo
npm run dev
```

The demo includes two examples:

- **Parallel NSGA-II Demo** (`index.html`) - General-purpose multi-objective optimization
- **Land Use Optimizer** (`landuse.html`) - Real-world example optimizing building space allocation

## Demo Examples

### 1. Parallel NSGA-II Demo

A general-purpose demonstration of the parallel island model genetic algorithm. Access at `http://localhost:3001/`

**Features:**

- Configure algorithm parameters (population size, generations, mutation rates)
- Adjust parallel execution settings (worker count, migration intervals)
- Real-time worker status monitoring
- View Pareto front solutions

### 2. Land Use Allocation Optimizer

A real-world application that optimizes building space allocation across different land uses (Restaurant, Residential, Retail) to balance occupancy and minimize overcrowding. Access at `http://localhost:3001/landuse.html`

**Problem:**

- Given a fixed total building area
- Multiple land uses with different capacity requirements
- Varying demand patterns across time periods (morning, afternoon, evening)
- Find optimal area allocation that minimizes both overcrowding and underutilization

**Objectives:**

1. **Minimize Overcrowding**: Penalty when demand exceeds capacity
2. **Minimize Underutilization**: Penalty when capacity significantly exceeds demand

**Visualizations:**

- Pie chart showing area allocation across land uses
- Utilization heatmap (land use × time period)
- Pareto front showing trade-offs between objectives
- Capacity vs demand comparison charts

This example demonstrates how to apply NSGA-II to real-world resource allocation problems with multiple competing objectives.

## Parallel Island Model

The demo application now includes a **parallel island model** implementation that distributes optimization across multiple CPU cores using Web Workers.

### How It Works

1. **Multiple Islands**: Each Web Worker runs an independent NSGA-II population
2. **Parallel Evolution**: Workers evolve populations simultaneously on different CPU cores
3. **Periodic Migration**: Elite solutions are exchanged between workers at regular intervals
4. **Result Aggregation**: Final Pareto fronts from all workers are merged into a unified result

### Configuration

The parallel demo provides these additional controls:

- **Number of Workers**: How many parallel workers to use (auto-detected from your CPU)
- **Migration Interval**: How many generations between elite solution exchanges (default: 20)
- **Migration Rate**: Percentage of population to exchange (default: 10%)

### Performance Benefits

- **Speedup**: Near-linear speedup with number of cores (4x faster on 4 cores, 8x on 8 cores)
- **Diversity**: Each island maintains genetic diversity with unique random seeds
- **Convergence**: Migration shares elite solutions, improving overall solution quality

### Usage Example

```typescript
import { WorkerPool } from "./workerPool.js";

// Create pool with auto-detected workers
const pool = new WorkerPool();
await pool.initialize();

// Run optimization with migration
const result = await pool.solve(
  {
    algorithm: "nsga2",
    num_vars: 10,
    population_size: 100,
    num_iterations: 200,
    crossover_rate: 0.9,
    mutation_rate: 0.1,
    num_offsprings: 50,
    objectives: [
      /* your objectives */
    ],
  },
  {
    interval: 20, // Migrate every 20 generations
    rate: 0.1, // Exchange 10% of population
  }
);

console.log(`Found ${result.stats.pareto_size} Pareto optimal solutions`);
```

See [PARALLEL_IMPLEMENTATION.md](./PARALLEL_IMPLEMENTATION.md) for detailed technical documentation.

## API Reference

### TypeScript API

The package exports two main functions for solving multi-objective optimization problems:

#### `solve_json(spec: string): string`

Solves a multi-objective optimization problem using a JSON specification.

**Parameters:**

- `spec`: JSON string containing the optimization specification

**Specification Format:**

```typescript
{
  algorithm: "nsga2" | "nsga3",      // Algorithm to use
  num_vars: number,                   // Number of decision variables
  population_size: number,            // Population size
  num_iterations: number,             // Number of generations
  crossover_rate: number,             // Crossover probability (0-1)
  mutation_rate: number,              // Mutation probability (0-1)
  num_offsprings: number,             // Number of offspring per generation
  objectives: number[][],             // Objective coefficient matrix
  constraints?: number[][]            // Optional constraint matrix
}
```

**Returns:**

```typescript
{
  pareto: number[][],                 // Pareto front solutions
  stats: {
    iterations: number,
    population_size: number,
    pareto_size: number
  }
}
```

**Example:**

```typescript
import init, { solve_json } from "./pkg/genetic_assembly.js";

await init();

const spec = {
  algorithm: "nsga2",
  num_vars: 5,
  population_size: 100,
  num_iterations: 200,
  crossover_rate: 0.9,
  mutation_rate: 0.1,
  num_offsprings: 50,
  objectives: [
    [-4, -2, -1, -5, -3], // Objective 1 (maximize value, so negative)
    [12, 2, 1, 4, 10], // Objective 2 (minimize weight)
  ],
};

const resultJson = solve_json(JSON.stringify(spec));
const result = JSON.parse(resultJson);

console.log("Pareto front:", result.pareto);
console.log("Statistics:", result.stats);
```

#### `solve_buffers(x0?, dims, objectives, rows, cols, popSize, generations): Float64Array`

Solves a multi-objective optimization problem using typed arrays.

**Parameters:**

- `x0`: Optional initial population (Float64Array or null)
- `dims`: Number of decision variables
- `objectives`: Flattened objective coefficient matrix (Float64Array)
- `rows`: Number of objectives
- `cols`: Number of variables
- `popSize`: Population size
- `generations`: Number of generations

**Returns:** Float64Array containing the flattened genes of the final population

**Example:**

```typescript
import init, { solve_buffers } from "./pkg/genetic_assembly.js";

await init();

const dims = 5;
const objectives = new Float64Array([
  -4,
  -2,
  -1,
  -5,
  -3, // Objective 1
  12,
  2,
  1,
  4,
  10, // Objective 2
]);

const result = solve_buffers(
  null, // No initial population
  dims, // 5 variables
  objectives, // Objective matrix
  2, // 2 objectives
  5, // 5 variables
  100, // Population size
  200 // Generations
);

console.log("Result:", result);
```

### Web Worker Integration

The demo includes a Web Worker implementation for running optimization in a background thread:

```typescript
// worker.ts
import init, { solve_json } from "../../pkg/genetic_assembly.js";

let isInitialized = false;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === "INIT") {
    await init();
    isInitialized = true;
    self.postMessage({ type: "INIT_SUCCESS" });
    return;
  }

  if (type === "SOLVE") {
    if (!isInitialized) {
      self.postMessage({ type: "ERROR", error: "Not initialized" });
      return;
    }

    try {
      const result = solve_json(JSON.stringify(payload));
      self.postMessage({ type: "SOLVE_SUCCESS", result: JSON.parse(result) });
    } catch (error) {
      self.postMessage({ type: "ERROR", error: error.message });
    }
  }
};
```

## Demo

The repository includes a full Vite-based demo application showcasing:

- Interactive parameter configuration
- Real-time optimization in a Web Worker
- Visualization of Pareto front solutions
- Performance metrics

Run the demo:

```bash
npm run dev
```

Build the demo for production:

```bash
npm run build
```

## Algorithm Details

### NSGA-II (Non-dominated Sorting Genetic Algorithm II)

The implementation includes:

- **Fast Non-dominated Sorting**: Efficiently categorizes population into Pareto fronts
- **Crowding Distance**: Maintains diversity in the Pareto front
- **Binary Tournament Selection**: Selects parents based on rank and crowding distance
- **Single-point Crossover**: Combines genetic material from two parents
- **Bit-flip Mutation**: Introduces variation by flipping binary genes

### Multi-Objective Optimization

The algorithm optimizes multiple conflicting objectives simultaneously. For example:

- **Knapsack Problem**: Maximize value while minimizing weight
- **Engineering Design**: Minimize cost while maximizing performance
- **Portfolio Optimization**: Maximize returns while minimizing risk

## Examples

See [examples.js](./examples.js) for comprehensive usage examples including:

- Basic usage with `solve_json` and `solve_buffers` APIs
- Web Worker integration for non-blocking optimization
- Real-world portfolio optimization example

## Development

### Project Structure

```
genetic-assembly/
├── src/
│   └── lib.rs              # Rust WASM implementation
├── demo/
│   ├── index.html          # Demo UI
│   └── src/
│       ├── main.ts         # Main application logic
│       └── worker.ts       # Web Worker for WASM
├── pkg/                    # Generated WASM package
├── Cargo.toml             # Rust dependencies
├── package.json           # Node.js dependencies
└── vite.config.ts         # Vite configuration
```

### Building

```bash
# Build WASM package
npm run build:wasm

# Build demo for production
npm run build

# Preview production build
npm run preview
```

### Testing

The WASM module can be tested with:

```bash
# Run Rust tests
cargo test

# Build and run the demo
npm run dev
```

## License

MIT

## Acknowledgments

This project provides a WebAssembly wrapper inspired by the [moors](https://github.com/andresliszt/moo-rs/) genetic algorithm library, implementing NSGA-II for multi-objective optimization in the browser.
