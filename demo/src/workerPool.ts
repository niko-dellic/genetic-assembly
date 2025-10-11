// WorkerPool for managing multiple workers in island model GA

export interface WorkerStatus {
  id: number;
  status:
    | "idle"
    | "initializing"
    | "running"
    | "migrating"
    | "completed"
    | "error";
  currentGeneration: number;
  totalGenerations: number;
  error?: string;
}

export interface OptimizationSpec {
  algorithm: string;
  num_vars: number;
  population_size: number;
  num_iterations: number;
  crossover_rate: number;
  mutation_rate: number;
  num_offsprings: number;
  objectives: number[][];
}

export interface WorkerResult {
  pareto: number[][];
  full_population?: number[][];
  stats: {
    iterations: number;
    population_size: number;
    pareto_size: number;
  };
}

export interface MigrationConfig {
  interval: number; // generations between migrations
  rate: number; // percentage of pareto front to migrate (0-1)
}

export interface PoolCallbacks {
  onWorkerStatusChange?: (statuses: WorkerStatus[]) => void;
  onMigration?: (cycle: number, totalCycles: number) => void;
  onComplete?: (result: WorkerResult) => void;
  onError?: (error: string) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private workerStatuses: WorkerStatus[] = [];
  private workerPopulations: (number[][] | null)[] = [];
  private numWorkers: number;
  private callbacks: PoolCallbacks;
  private isRunning: boolean = false;

  constructor(numWorkers?: number, callbacks: PoolCallbacks = {}) {
    this.numWorkers = numWorkers || navigator.hardwareConcurrency || 4;
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    console.log(`Initializing worker pool with ${this.numWorkers} workers...`);

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      this.workers.push(worker);

      const status: WorkerStatus = {
        id: i,
        status: "initializing",
        currentGeneration: 0,
        totalGenerations: 0,
      };
      this.workerStatuses.push(status);
      this.workerPopulations.push(null);

      // Setup worker message handler
      worker.onmessage = (e) => this.handleWorkerMessage(i, e);
      worker.onerror = (error) => this.handleWorkerError(i, error);

      // Initialize worker
      worker.postMessage({ type: "INIT", workerId: i });
    }

    // Wait for all workers to initialize
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const allInitialized = this.workerStatuses.every(
          (s) => s.status === "idle" || s.status === "error"
        );

        if (allInitialized) {
          clearInterval(checkInterval);
          const anyError = this.workerStatuses.some(
            (s) => s.status === "error"
          );
          if (anyError) {
            reject(new Error("One or more workers failed to initialize"));
          } else {
            console.log("All workers initialized successfully");
            resolve();
          }
        }
      }, 100);
    });
  }

  async solve(
    spec: OptimizationSpec,
    migrationConfig: MigrationConfig
  ): Promise<WorkerResult> {
    if (this.isRunning) {
      throw new Error("Pool is already running");
    }

    this.isRunning = true;
    const totalGenerations = spec.num_iterations;
    const migrationInterval = migrationConfig.interval;
    const numCycles = Math.ceil(totalGenerations / migrationInterval);

    console.log(
      `Starting optimization: ${totalGenerations} generations, ${numCycles} migration cycles`
    );

    try {
      for (let cycle = 0; cycle < numCycles; cycle++) {
        const generationsThisCycle = Math.min(
          migrationInterval,
          totalGenerations - cycle * migrationInterval
        );

        console.log(
          `Migration cycle ${
            cycle + 1
          }/${numCycles}: Running ${generationsThisCycle} generations`
        );

        // Run all workers for this cycle
        await this.runCycle(spec, generationsThisCycle, cycle);

        // Perform migration (except on last cycle)
        if (cycle < numCycles - 1) {
          this.performMigration(migrationConfig.rate);
          this.callbacks.onMigration?.(cycle + 1, numCycles);
        }
      }

      // Aggregate results from all workers
      const finalResult = this.aggregateResults(spec);
      this.callbacks.onComplete?.(finalResult);

      return finalResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.callbacks.onError?.(errorMsg);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private async runCycle(
    spec: OptimizationSpec,
    generations: number,
    cycle: number
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.numWorkers; i++) {
      const workerSpec = {
        ...spec,
        num_iterations: generations,
        initial_population: this.workerPopulations[i] || undefined,
        seed: cycle * this.numWorkers + i, // Unique seed per worker per cycle
      };

      this.workerStatuses[i].status = "running";
      this.workerStatuses[i].currentGeneration =
        (cycle * spec.num_iterations) /
        Math.ceil(spec.num_iterations / generations);
      this.workerStatuses[i].totalGenerations = spec.num_iterations;
      this.notifyStatusChange();

      promises.push(
        new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            const { type, result, error } = e.data;

            if (type === "SOLVE_SUCCESS") {
              this.workerPopulations[i] = result.full_population || null;
              this.workerStatuses[i].status = "idle";
              this.workerStatuses[i].currentGeneration += generations;
              this.notifyStatusChange();
              resolve();
            } else if (type === "ERROR") {
              this.workerStatuses[i].status = "error";
              this.workerStatuses[i].error = error;
              this.notifyStatusChange();
              reject(new Error(error));
            } else if (type === "PROGRESS") {
              this.workerStatuses[i].currentGeneration =
                (cycle * spec.num_iterations) /
                  Math.ceil(spec.num_iterations / generations) +
                result.generation;
              this.notifyStatusChange();
            }
          };

          this.workers[i].onmessage = handler;
          this.workers[i].postMessage({ type: "SOLVE", payload: workerSpec });
        })
      );
    }

    await Promise.all(promises);
  }

  private performMigration(rate: number): void {
    console.log(`Performing migration with rate ${rate}`);

    // Collect pareto fronts from all workers
    const paretoFronts: number[][][] = [];
    for (let i = 0; i < this.numWorkers; i++) {
      if (this.workerPopulations[i]) {
        // For simplicity, take the first N individuals as "elite"
        // In a real implementation, we'd run non-dominated sort
        const pop = this.workerPopulations[i]!;
        const numToMigrate = Math.max(1, Math.floor(pop.length * rate));
        paretoFronts.push(pop.slice(0, numToMigrate));
      }
    }

    // Pool all elite solutions
    const elitePool: number[][] = paretoFronts.flat();

    if (elitePool.length === 0) return;

    // Distribute elite solutions to all workers
    for (let i = 0; i < this.numWorkers; i++) {
      if (this.workerPopulations[i]) {
        const pop = this.workerPopulations[i]!;
        const numToReplace = Math.floor(pop.length * rate);

        // Replace worst individuals with random elite from other workers
        for (let j = 0; j < numToReplace; j++) {
          const randomEliteIdx = Math.floor(Math.random() * elitePool.length);
          pop[pop.length - 1 - j] = [...elitePool[randomEliteIdx]];
        }
      }

      this.workerStatuses[i].status = "migrating";
    }

    this.notifyStatusChange();

    // Brief delay to show migration status
    setTimeout(() => {
      for (let i = 0; i < this.numWorkers; i++) {
        this.workerStatuses[i].status = "idle";
      }
      this.notifyStatusChange();
    }, 100);
  }

  private aggregateResults(spec: OptimizationSpec): WorkerResult {
    console.log("Aggregating results from all workers...");

    // Collect all populations
    const allSolutions: number[][] = [];
    for (const pop of this.workerPopulations) {
      if (pop) {
        allSolutions.push(...pop);
      }
    }

    // For simplicity, take unique solutions and return top N by first objective
    // In a real implementation, we'd run non-dominated sort on the merged population
    const uniqueSolutions = Array.from(
      new Map(allSolutions.map((s) => [JSON.stringify(s), s])).values()
    );

    // Sort by first objective (simplified)
    uniqueSolutions.sort((a, b) => {
      const objA = a.reduce(
        (sum, gene, idx) => sum + gene * spec.objectives[0][idx],
        0
      );
      const objB = b.reduce(
        (sum, gene, idx) => sum + gene * spec.objectives[0][idx],
        0
      );
      return objA - objB;
    });

    const paretoSize = Math.min(uniqueSolutions.length, spec.population_size);
    const pareto = uniqueSolutions.slice(0, paretoSize);

    return {
      pareto,
      full_population: uniqueSolutions,
      stats: {
        iterations: spec.num_iterations,
        population_size: allSolutions.length,
        pareto_size: pareto.length,
      },
    };
  }

  private handleWorkerMessage(workerId: number, e: MessageEvent): void {
    const { type } = e.data;

    if (type === "INIT_SUCCESS") {
      this.workerStatuses[workerId].status = "idle";
      this.notifyStatusChange();
    }
  }

  private handleWorkerError(workerId: number, error: ErrorEvent): void {
    this.workerStatuses[workerId].status = "error";
    this.workerStatuses[workerId].error = error.message;
    this.notifyStatusChange();
    this.callbacks.onError?.(`Worker ${workerId} error: ${error.message}`);
  }

  private notifyStatusChange(): void {
    this.callbacks.onWorkerStatusChange?.([...this.workerStatuses]);
  }

  getStatuses(): WorkerStatus[] {
    return [...this.workerStatuses];
  }

  terminate(): void {
    console.log("Terminating worker pool...");
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    this.workerStatuses = [];
    this.workerPopulations = [];
    this.isRunning = false;
  }
}
