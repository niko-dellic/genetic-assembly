// Main TypeScript file for the demo
import {
  WorkerPool,
  type WorkerStatus,
  type OptimizationSpec,
} from "./workerPool.js";

let workerPool: WorkerPool | null = null;
let startTime = 0;

interface OptimizationResult {
  pareto: number[][];
  stats: {
    iterations: number;
    population_size: number;
    pareto_size: number;
  };
  executionTime?: number;
}

async function initWorkerPool() {
  const numWorkersInput = document.getElementById(
    "numWorkers"
  ) as HTMLInputElement;
  const numWorkers = parseInt(numWorkersInput.value);

  console.log(`Initializing worker pool with ${numWorkers} workers...`);

  workerPool = new WorkerPool(numWorkers, {
    onWorkerStatusChange: updateWorkerStatusDisplay,
    onMigration: (cycle, totalCycles) => {
      showStatus(`Migration ${cycle}/${totalCycles} completed`, "info");
    },
    onComplete: (result) => {
      const executionTime = Math.round(performance.now() - startTime);
      displayResults({
        pareto: result.pareto,
        stats: result.stats,
        executionTime,
      });
      enableButton();
    },
    onError: (error) => {
      showError(error);
      enableButton();
    },
  });

  try {
    await workerPool.initialize();
    console.log("Worker pool initialized");
  } catch (error) {
    showError(`Failed to initialize worker pool: ${(error as Error).message}`);
  }
}

function disableButton() {
  const btn = document.getElementById("runBtn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Running...";
}

function enableButton() {
  const btn = document.getElementById("runBtn") as HTMLButtonElement;
  btn.disabled = false;
  btn.textContent = "Run Optimization";
}

function showStatus(message: string, className: string) {
  const results = document.getElementById("results")!;
  const status = document.getElementById("status")!;

  results.style.display = "block";
  status.className = `status ${className}`;
  status.textContent = message;
}

function updateWorkerStatusDisplay(statuses: WorkerStatus[]) {
  const workerStatusDiv = document.getElementById("workerStatus")!;

  workerStatusDiv.innerHTML = statuses
    .map((status) => {
      const statusEmoji = {
        idle: "⚪",
        initializing: "🔄",
        running: "🟢",
        migrating: "🔄",
        completed: "✅",
        error: "❌",
      }[status.status];

      const progress =
        status.totalGenerations > 0
          ? Math.round(
              (status.currentGeneration / status.totalGenerations) * 100
            )
          : 0;

      return `
        <div class="worker-card">
          <div class="worker-header">
            <span class="worker-id">Worker ${status.id + 1}</span>
            <span class="worker-status">${statusEmoji} ${status.status}</span>
          </div>
          <div class="worker-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-text">${status.currentGeneration} / ${
        status.totalGenerations
      } generations</div>
          </div>
          ${
            status.error
              ? `<div class="worker-error">${status.error}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function showError(message: string) {
  showStatus(message, "error");
}

function displayResults(result: OptimizationResult) {
  showStatus("Optimization completed successfully!", "success");

  // Display stats
  const statsDiv = document.getElementById("stats")!;
  statsDiv.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${result.stats.iterations}</div>
      <div class="stat-label">Generations</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${result.stats.population_size}</div>
      <div class="stat-label">Population Size</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${result.stats.pareto_size}</div>
      <div class="stat-label">Pareto Front Size</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${result.executionTime}ms</div>
      <div class="stat-label">Execution Time</div>
    </div>
  `;

  // Display pareto front
  const paretoOutput = document.getElementById("paretoOutput")!;
  paretoOutput.textContent = JSON.stringify(result.pareto, null, 2);
}

(window as any).runOptimization = async () => {
  if (!workerPool) {
    showError("Worker pool not initialized");
    return;
  }

  disableButton();
  showStatus("Running parallel optimization...", "info");

  const algorithm = (document.getElementById("algorithm") as HTMLSelectElement)
    .value;
  const numVars = parseInt(
    (document.getElementById("numVars") as HTMLInputElement).value
  );
  const popSize = parseInt(
    (document.getElementById("popSize") as HTMLInputElement).value
  );
  const generations = parseInt(
    (document.getElementById("generations") as HTMLInputElement).value
  );
  const crossoverRate = parseFloat(
    (document.getElementById("crossoverRate") as HTMLInputElement).value
  );
  const mutationRate = parseFloat(
    (document.getElementById("mutationRate") as HTMLInputElement).value
  );
  const migrationInterval = parseInt(
    (document.getElementById("migrationInterval") as HTMLInputElement).value
  );
  const migrationRate = parseFloat(
    (document.getElementById("migrationRate") as HTMLInputElement).value
  );

  // Create a simple multi-objective problem: knapsack-like
  // Objective 1: maximize value (minimize -value)
  // Objective 2: minimize weight
  const objectives: number[][] = [];

  // First objective: random values (we minimize, so negative for max)
  const obj1 = Array.from({ length: numVars }, () => -Math.random() * 10);
  objectives.push(obj1);

  // Second objective: random weights (minimize)
  const obj2 = Array.from({ length: numVars }, () => Math.random() * 5);
  objectives.push(obj2);

  const spec: OptimizationSpec = {
    algorithm,
    num_vars: numVars,
    population_size: popSize,
    num_iterations: generations,
    crossover_rate: crossoverRate,
    mutation_rate: mutationRate,
    num_offsprings: Math.floor(popSize * 0.5),
    objectives,
  };

  startTime = performance.now();

  try {
    await workerPool.solve(spec, {
      interval: migrationInterval,
      rate: migrationRate,
    });
  } catch (error) {
    console.error("Optimization failed:", error);
  }
};

(window as any).reinitializePool = async () => {
  if (workerPool) {
    workerPool.terminate();
  }
  await initWorkerPool();
};

// Initialize worker pool on page load
initWorkerPool();
