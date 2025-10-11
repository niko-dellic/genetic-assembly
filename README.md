# genetic-assembly

WebAssembly wrapper for NSGA-II multi-objective genetic algorithm with parallel island model support.

## Features

- 🚀 **High Performance**: Compiled to WebAssembly for near-native performance
- 🧬 **NSGA-II Algorithm**: Fast non-dominated sorting genetic algorithm
- 🏝️ **Parallel Island Model**: Distribute optimization across multiple CPU cores
- 👷 **Web Worker Pool**: Automatic worker management and load balancing
- 🔄 **Solution Migration**: Periodic elite exchange between islands for better convergence
- 🌱 **Population Seeding**: Resume optimization from previous populations
- 🎲 **Deterministic Execution**: Optional RNG seeding for reproducible results
- 📦 **TypeScript APIs**: Fully typed interfaces for easy integration
- 🎯 **Two API Styles**: JSON-based and buffer-based APIs

## Implementation

This project provides a custom WebAssembly-compatible implementation of the NSGA-II (Non-dominated Sorting Genetic Algorithm II) algorithm. While inspired by the [moors](https://github.com/andresliszt/moo-rs/) library's approach to multi-objective optimization, we implemented a standalone version that compiles to WebAssembly without dependency conflicts.

The implementation includes:

- Fast non-dominated sorting for Pareto front identification
- Crowding distance calculation for solution diversity
- Binary tournament selection
- Single-point crossover and bit-flip mutation operators
- **Binary decision variables only** (0.0 or 1.0 genes)
- **Linear objective functions** (coefficient matrix representation)
- Population seeding for resumable/incremental optimization
- Deterministic RNG seeding for reproducible results

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

**Interactive Visualizations** (using Plotly.js):

- Pie chart showing area allocation across land uses
- Utilization heatmap (land use × time period)
- Pareto front scatter plot showing trade-offs between objectives
- Capacity vs demand comparison bar charts
- Click any Pareto solution to explore its detailed metrics

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
  algorithm: "nsga2",                 // Algorithm (only "nsga2" currently supported)
  num_vars: number,                   // Number of binary decision variables
  population_size: number,            // Population size
  num_iterations: number,             // Number of generations
  crossover_rate: number,             // Crossover probability (0-1)
  mutation_rate: number,              // Mutation probability (0-1)
  num_offsprings: number,             // Number of offspring per generation
  objectives: number[][],             // Objective coefficient matrix (M objectives × N variables)
  constraints?: number[][],           // Optional constraint matrix (not yet enforced)
  initial_population?: number[][],    // Optional: Resume from previous population (genes only)
  seed?: number                       // Optional: RNG seed for deterministic execution
}
```

**Notes:**

- `algorithm`: While "nsga3" is accepted, it currently runs NSGA-II internally (NSGA-III not yet implemented)
- `objectives`: Each row represents one objective as a linear combination of decision variables
- `initial_population`: Array of gene arrays (binary values 0.0 or 1.0) to seed the initial population
- `seed`: Use the same seed to get reproducible results across runs

**Returns:**

```typescript
{
  pareto: number[][],                 // Pareto front solutions (genes only)
  stats: {
    iterations: number,               // Number of iterations run
    population_size: number,          // Final population size
    pareto_size: number               // Number of solutions in Pareto front
  },
  full_population?: number[][]        // Optional: Complete final population for resuming
}
```

**Notes:**

- `pareto`: Array of gene arrays representing non-dominated solutions (rank 0)
- `full_population`: Included by default when using `solve_json`, can be used as `initial_population` for resumable execution

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

// Resume from previous population
const resumedSpec = {
  ...spec,
  initial_population: result.full_population, // Use previous final population
  num_iterations: 100, // Run 100 more generations
};

const resumedResult = solve_json(JSON.stringify(resumedSpec));
console.log("Improved solutions:", JSON.parse(resumedResult).pareto);

// Deterministic execution (same seed = same results)
const deterministicSpec = {
  ...spec,
  seed: 12345, // Fixed seed for reproducibility
};

const result1 = solve_json(JSON.stringify(deterministicSpec));
const result2 = solve_json(JSON.stringify(deterministicSpec));
// result1 and result2 will be identical
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

### Supported Algorithms

**Currently Implemented:**

- ✅ **NSGA-II** (Non-dominated Sorting Genetic Algorithm II)

**Planned:**

- ⏳ **NSGA-III** (for many-objective optimization with 4+ objectives)

**Note:** While the API accepts "nsga3" as an algorithm parameter, it currently falls back to NSGA-II internally. This is documented for future compatibility when NSGA-III is implemented.

### NSGA-II Implementation

The NSGA-II implementation includes:

- **Fast Non-dominated Sorting**: Efficiently categorizes population into Pareto fronts
- **Crowding Distance**: Maintains diversity in the Pareto front
- **Binary Tournament Selection**: Selects parents based on rank and crowding distance
- **Single-point Crossover**: Combines genetic material from two parents
- **Bit-flip Mutation**: Introduces variation by flipping binary genes (0.0 ↔ 1.0)

**Limitations:**

- Binary variables only (each gene is either 0.0 or 1.0)
- Linear objective functions (expressed as coefficient matrices)
- Constraints are accepted but not enforced (for future use)

### Multi-Objective Optimization

The algorithm optimizes multiple conflicting objectives simultaneously, producing a **Pareto front** of trade-off solutions.

**Ideal Use Cases:**

- **Binary Knapsack Problems**: Select items (0/1) to maximize value while minimizing weight
- **Feature Selection**: Choose which features to include (on/off) to balance accuracy and complexity
- **Resource Allocation**: Allocate discrete units (present/absent) across competing objectives
- **Subset Selection**: Pick elements from a set to optimize multiple criteria

**Examples:**

- **Knapsack Problem**: Maximize value while minimizing weight
- **Land Use Allocation**: Allocate building space to minimize overcrowding and underutilization (see demo)
- **Portfolio Selection**: Choose which assets to include while balancing risk and return
- **Network Design**: Select which links to activate to optimize cost and reliability

**Not Suitable For:**

- Continuous optimization problems (requires binary encoding)
- Non-linear objective functions
- Problems requiring constraint enforcement
- Many-objective optimization (4+ objectives - use NSGA-III when available)

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
│   └── lib.rs                  # Rust WASM implementation (NSGA-II only)
├── demo/
│   ├── index.html              # Parallel NSGA-II demo
│   ├── landuse.html            # Land use allocation example
│   ├── styles/
│   │   └── styles.css          # Shared styles for demos
│   └── src/
│       ├── main.ts             # Main demo logic
│       ├── worker.ts           # Web Worker for WASM
│       ├── workerPool.ts       # Parallel worker pool manager
│       ├── landUseMain.ts      # Land use demo logic
│       ├── landUseOptimizer.ts # Land use problem formulation
│       ├── visualization.ts    # Plotly.js visualizations
│       └── plotly.d.ts         # Plotly type declarations
├── pkg/                        # Generated WASM package
├── Cargo.toml                  # Rust dependencies
├── package.json                # Node.js dependencies
└── vite.config.ts              # Vite configuration
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
