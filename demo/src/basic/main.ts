// Main TypeScript file for the demo
import init, { solve_json } from "../../../pkg/index.js";
import type { OptimizationSpec, OptimizationResult } from "../types/types.js";

let wasmInitialized = false;

// Initialize WASM on page load
async function initWasm() {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
    console.log("WASM module initialized");
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

function showError(message: string) {
  showStatus(message, "error");
}

function updateProgressVisualization(data: any) {
  // Update generation counter in status message
  const statusMsg =
    data.workerId !== undefined
      ? `Worker ${data.workerId} - Gen ${data.generation}: ${data.pareto_size} solutions`
      : `Generation ${data.generation}: ${data.pareto_size} Pareto solutions`;
  showStatus(statusMsg, "info");
}

function updateWorkerStatusDisplay(statuses: any[]) {
  const workerStatusDiv = document.getElementById("workerStatus")!;

  workerStatusDiv.innerHTML = statuses
    .map((status) => {
      const statusEmoji: Record<string, string> = {
        idle: "⚪",
        initializing: "🔄",
        running: "🟢",
        migrating: "🔄",
        completed: "✅",
        error: "❌",
      };
      const emoji = statusEmoji[status.status] || "⚪";

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
            <span>${status.status} ${emoji}</span>
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
      <div class="stat-value">${result.executionTime || 0}ms</div>
      <div class="stat-label">Execution Time</div>
    </div>
  `;

  // Display pareto front
  const paretoOutput = document.getElementById("paretoOutput")!;
  paretoOutput.textContent = JSON.stringify(result.pareto, null, 2);
}

(window as any).runOptimization = async () => {
  if (!wasmInitialized) {
    showError("WASM not initialized yet");
    return;
  }

  disableButton();
  showStatus("Running optimization...", "info");

  const algorithm = (document.getElementById("algorithm") as HTMLSelectElement)
    .value as "nsga2" | "nsga3";
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
  const numWorkersInput = document.getElementById(
    "numWorkers"
  ) as HTMLInputElement;
  const numWorkers = numWorkersInput.value
    ? parseInt(numWorkersInput.value)
    : undefined;
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
    workers: numWorkers || true, // Use specified workers or auto-detect
    migration_interval: migrationInterval,
    migration_rate: migrationRate,
    progress_interval: 10, // Callback every 10 generations
  };

  try {
    const result = await solve_json(
      spec,
      (progressData) => {
        updateProgressVisualization(progressData);
      },
      {
        onWorkerStatusChange: updateWorkerStatusDisplay,
        onMigration: (cycle, totalCycles) => {
          showStatus(`Migration ${cycle}/${totalCycles} completed`, "info");
        },
        onError: (error) => {
          showError(error);
        },
      }
    );

    // executionTime is now automatically tracked in the result
    displayResults(result);
    enableButton();
  } catch (error) {
    console.error("Optimization failed:", error);
    showError(`Optimization failed: ${(error as Error).message}`);
    enableButton();
  }
};

// Initialize WASM on page load
initWasm();
