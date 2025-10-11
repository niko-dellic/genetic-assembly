# Parallel Island Model Genetic Algorithm Implementation

## Overview

This implementation transforms the single-worker WASM-based NSGA-II solver into a parallel island model genetic algorithm that can leverage multiple CPU cores simultaneously.

## Architecture

### Island Model Strategy

The parallel implementation uses an **island model** where:

1. **Multiple Worker Islands**: Each Web Worker runs an independent NSGA-II population
2. **Independent Evolution**: Workers evolve their populations separately for a configured number of generations
3. **Periodic Migration**: At regular intervals, elite solutions (top Pareto front members) are exchanged between workers
4. **Final Aggregation**: Results from all workers are merged to produce a unified Pareto front

### Components

#### 1. Rust WASM Solver (`src/lib.rs`)

Enhanced to support:

- **Population Seeding**: Accepts `initial_population` parameter to resume from existing solutions
- **Deterministic RNG**: Accepts `seed` parameter for reproducible results per worker
- **Full Population Export**: Returns complete population in results for migration between cycles

#### 2. WorkerPool Manager (`demo/src/workerPool.ts`)

Central coordinator that:

- Manages multiple Web Worker instances (auto-detected from `navigator.hardwareConcurrency`)
- Distributes optimization work across workers
- Coordinates migration cycles
- Tracks per-worker status and progress
- Aggregates final results from all workers

Key methods:

- `initialize()`: Spawns and initializes all workers
- `solve()`: Runs the full optimization with migration cycles
- `runCycle()`: Executes one migration cycle across all workers
- `performMigration()`: Exchanges elite solutions between workers
- `aggregateResults()`: Merges all worker results into unified Pareto front

#### 3. Worker Script (`demo/src/worker.ts`)

Updated to:

- Accept worker ID for unique seeding
- Support resumable execution with initial populations
- Report progress during execution

#### 4. Main UI (`demo/src/main.ts`)

Integrates WorkerPool with:

- Real-time worker status updates
- Migration event notifications
- Final result aggregation and display

#### 5. UI (`demo/index.html`)

Enhanced with:

- Worker count selector (auto-detected, user-overridable)
- Migration interval configuration
- Migration rate configuration
- Real-time worker status grid with progress bars
- Visual indicators for worker states (idle, running, migrating, completed, error)

## Configuration Parameters

### Parallel Execution Settings

- **Number of Workers**: How many parallel workers to use (default: auto-detected CPU cores)
- **Migration Interval**: How many generations between migrations (default: 20)
- **Migration Rate**: Percentage of population to exchange (default: 0.1 = 10%)

### How It Works

Example with 4 workers, 100 total generations, migration every 20 generations:

```
Cycle 1 (Generations 0-20):
  Worker 0: Random population → Evolve 20 generations
  Worker 1: Random population → Evolve 20 generations
  Worker 2: Random population → Evolve 20 generations
  Worker 3: Random population → Evolve 20 generations

  Migration: Exchange top 10% of each worker's population

Cycle 2 (Generations 20-40):
  Worker 0: Seeded with migrated solutions → Evolve 20 generations
  Worker 1: Seeded with migrated solutions → Evolve 20 generations
  Worker 2: Seeded with migrated solutions → Evolve 20 generations
  Worker 3: Seeded with migrated solutions → Evolve 20 generations

  Migration: Exchange top 10% again

... (Cycles 3-4)

Cycle 5 (Generations 80-100):
  All workers complete final 20 generations

  Final Aggregation:
    - Collect all populations from all workers
    - Merge into single population
    - Extract unified Pareto front
    - Display combined results
```

## Benefits

1. **Parallel Speedup**: Utilizes all available CPU cores for faster optimization
2. **Population Diversity**: Each worker maintains genetic diversity with unique RNG seeds
3. **Solution Quality**: Migration shares elite solutions, improving convergence
4. **Scalability**: Automatically adapts to available hardware (4-16+ cores)
5. **Real-time Monitoring**: Live progress tracking per worker

## Performance Considerations

- **Migration Overhead**: Too frequent migrations can reduce parallel efficiency
- **Migration Rate**: Too high can cause premature convergence; too low reduces information sharing
- **Population Size**: Each worker maintains its own population, so total memory = workers × population size
- **Optimal Settings**:
  - Migration interval: 10-20 generations
  - Migration rate: 10-20% of population
  - Workers: Equal to or slightly less than CPU cores

## Usage

```typescript
// Auto-detect cores and initialize
const pool = new WorkerPool();
await pool.initialize();

// Run optimization with migration
const result = await pool.solve(optimizationSpec, {
  interval: 20, // Migrate every 20 generations
  rate: 0.1, // Exchange 10% of population
});

// result contains merged Pareto front from all workers
console.log(`Found ${result.stats.pareto_size} Pareto optimal solutions`);
```

## Future Enhancements

Potential improvements:

1. **Adaptive Migration**: Dynamically adjust migration frequency based on convergence
2. **Topology-based Migration**: Use ring or toroidal topology instead of all-to-all
3. **Elite Selection**: Implement proper non-dominated sorting for migration selection
4. **Load Balancing**: Distribute uneven workloads across workers
5. **Progress Streaming**: Real-time generation-by-generation updates
6. **Result Visualization**: Plot Pareto fronts from each worker and merged result
