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

**Build Flags Explained:**

The `build:wasm` script uses these important flags:

- `--target web`: Generates ES module output for direct browser import (required for Vite/module bundlers)
- `--out-dir pkg`: Outputs to the `pkg/` directory
- `--release`: Builds with optimizations (3x+ faster than debug builds)

**Manual build command:**

```bash
wasm-pack build --target web --out-dir pkg --release
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

Parallel execution is now built into the main `solve_json` API. Simply add the `workers` field to your spec:

```typescript
import init, { solve_json } from "./pkg/index.js";

await init();

// Single-threaded (synchronous)
const result1 = solve_json({
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
}); // Returns OptimizationResult immediately

// Parallel execution with auto-detected cores (asynchronous)
const result2 = await solve_json({
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
  workers: true, // Enable parallel execution - returns Promise<OptimizationResult>
  migration_interval: 20, // Migrate every 20 generations (default: 20)
  migration_rate: 0.1, // Exchange 10% of population (default: 0.1)
});

console.log(`Found ${result2.stats.pareto_size} Pareto optimal solutions`);

// Or specify exact worker count (also asynchronous)
const result3 = await solve_json({
  ...spec,
  workers: 4, // Use exactly 4 workers - returns Promise<OptimizationResult>
});
```

**Key Benefits:**

- No manual worker pool management
- Workers automatically created and cleaned up
- Same API for single and parallel execution
- **Smart return types**: Synchronous without workers, Promise with workers (TypeScript enforces correct usage)
- Progress callbacks work transparently

See [PARALLEL_IMPLEMENTATION.md](./PARALLEL_IMPLEMENTATION.md) for detailed technical documentation.

## Progress Callbacks

Monitor optimization progress in real-time for live visualizations with Three.js, Plotly, or other visualization libraries.

### Usage

```typescript
import init, { solve_json } from "./pkg/index.js";
import type { OptimizationSpec, OptimizationResult } from "./pkg/index.js";

await init();

const result = solve_json(
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
    progress_interval: 10, // Callback every 10 generations
  },
  (progressData) => {
    // Update your visualization here
    console.log(
      `Gen ${progressData.generation}: ${progressData.pareto_size} solutions`
    );
    updateVisualization(progressData.pareto_front);
  }
);
```

### With Worker Pool

```typescript
const pool = new WorkerPool(4, {
  onProgress: (data) => {
    // Aggregate progress from all workers
    updateLiveChart(data.pareto_front);
  },
  onWorkerProgress: (workerId, data) => {
    // Per-worker progress for status display
    console.log(`Worker ${workerId} - Gen ${data.generation}`);
  },
});

await pool.initialize();

await pool.solve(
  {
    algorithm: "nsga2",
    // ... spec ...
    progress_interval: 5, // Update every 5 generations
  },
  {
    interval: 20,
    rate: 0.1,
  }
);
```

### Progress Data Structure

```typescript
interface ProgressData {
  generation: number; // Current generation number
  pareto_size: number; // Number of solutions in Pareto front
  population_size: number; // Total population size
  pareto_front: Solution[]; // Current non-dominated solutions
  workerId?: number; // Worker ID (when using WorkerPool)
}

interface Solution {
  genes: number[]; // Decision variables (binary: 0.0 or 1.0)
  objectives: number[]; // Objective values
  rank: number; // Pareto rank (0 = non-dominated)
  crowding_distance: number; // Diversity metric
}
```

### Benefits

- **Live Visualization**: Update charts, 3D scenes, or dashboards in real-time
- **User Feedback**: Show optimization progress to users
- **Early Stopping**: Monitor convergence and stop early if needed
- **Performance**: Callbacks are triggered at user-controlled intervals (no overhead if disabled)

### Examples

The demo applications include progress callbacks:

- **NSGA-II Demo**: Shows generation count and Pareto size in status message
- **Land Use Demo**: Updates Plotly charts with current Pareto front and best solution in real-time

See [examples.js](./examples.js) for standalone code examples.

## API Reference

### TypeScript API

The package exports two main functions for solving multi-objective optimization problems:

#### `solve_json(spec: object, progressCallback?: Function): object`

Solves a multi-objective optimization problem using a JavaScript object specification.

**Parameters:**

- `spec`: JavaScript object containing the optimization specification (automatically serialized internally)
- `progressCallback` (optional): Callback function called at regular intervals with progress data

**Note:** Pass the specification object directly—no need for `JSON.stringify()`. The WASM module handles serialization internally for convenience.

**TypeScript Support:** The package includes full TypeScript definitions. Import types from `"./pkg/index.js"` for complete type safety:

```typescript
import type {
  OptimizationSpec,
  OptimizationResult,
  ProgressCallback,
} from "./pkg/index.js";
```

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
  seed?: number,                      // Optional: RNG seed for deterministic execution
  progress_interval?: number,         // Optional: Callback interval in generations
  workers?: boolean | number,         // Optional: Enable parallel execution (true=auto-detect, number=specific count)
  migration_interval?: number,        // Optional: Generations between migrations (default: 20, only with workers)
  migration_rate?: number             // Optional: Percentage to migrate (default: 0.1, only with workers)
}
```

**Notes:**

- `algorithm`: While "nsga3" is accepted, it currently runs NSGA-II internally (NSGA-III not yet implemented)
- `objectives`: Each row represents one objective as a linear combination of decision variables
- `initial_population`: Array of gene arrays (binary values 0.0 or 1.0) to seed the initial population
- `seed`: Use the same seed to get reproducible results across runs
- `workers`: Set to `true` for auto-detection or a number (e.g., `4`) for specific worker count. Workers are automatically managed (created and terminated)
- `migration_interval` & `migration_rate`: Only used when `workers` is enabled. Controls the island model migration strategy

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
import init, { solve_json } from "./pkg/index.js";
import type { OptimizationSpec, OptimizationResult } from "./pkg/index.js";

await init();

const spec: OptimizationSpec = {
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

const result: OptimizationResult = solve_json(spec);

console.log("Pareto front:", result.pareto);
console.log("Statistics:", result.stats);

// Resume from previous population
const resumedSpec: OptimizationSpec = {
  ...spec,
  initial_population: result.full_population, // Use previous final population
  num_iterations: 100, // Run 100 more generations
};

const resumedResult: OptimizationResult = solve_json(resumedSpec);
console.log("Improved solutions:", resumedResult.pareto);

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
import init, { solve_json } from "../../pkg/index.js";
import type { OptimizationSpec } from "./types.js";

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
      // Optional progress callback
      const progressCallback = payload.progress_interval
        ? (progressData) => {
            self.postMessage({ type: "PROGRESS", data: progressData });
          }
        : undefined;

      const result = solve_json(payload, progressCallback);
      self.postMessage({ type: "SOLVE_SUCCESS", result });
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
# Build WASM package (generates optimized WASM in pkg/ directory)
npm run build:wasm

# Build demo for production
npm run build

# Preview production build
npm run preview
```

**Note:** The `build:wasm` command compiles Rust to WebAssembly with the `--target web` flag, which generates ES module output compatible with modern browsers and bundlers like Vite.

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
