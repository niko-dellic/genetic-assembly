// Main logic for land use allocation optimizer demo

import Plotly from "plotly.js-dist";
import init, { solve_json } from "../../pkg/index.js";
import type { OptimizationSpec } from "./types.js";
import {
  createExampleProblem,
  buildObjectiveMatrices,
  createSolution,
  type LandUseProblem,
  type LandUseSolution,
} from "./landUseOptimizer.js";
import {
  drawPieChart,
  drawUtilizationHeatmap,
  drawParetoFront,
  drawCapacityVsDemand,
} from "./visualization.js";

let wasmInitialized = false;
let currentProblem: LandUseProblem = createExampleProblem();
let paretoSolutions: LandUseSolution[] = [];
let selectedSolutionIdx = 0;

async function initWasm() {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
    console.log("WASM module initialized");
    loadExampleProblem();
  }
}

function loadExampleProblem() {
  currentProblem = createExampleProblem();

  // Populate land use table
  const tbody = document.getElementById("landUseTableBody")!;
  tbody.innerHTML = "";

  currentProblem.landUses.forEach((landUse) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${landUse.name}</td>
      <td>${(1 / landUse.capacityPerSqft).toFixed(0)}</td>
      <td>${landUse.minArea}</td>
    `;
    tbody.appendChild(row);
  });

  // Populate demand table
  const demandTbody = document.getElementById("demandTableBody")!;
  demandTbody.innerHTML = "";

  currentProblem.landUses.forEach((landUse) => {
    const pattern = currentProblem.demandPatterns[landUse.name];
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${landUse.name}</td>
      <td>${pattern.morning}</td>
      <td>${pattern.afternoon}</td>
      <td>${pattern.evening}</td>
    `;
    demandTbody.appendChild(row);
  });

  // Display total area
  const totalAreaSpan = document.getElementById("totalArea")!;
  totalAreaSpan.textContent = `${currentProblem.totalArea.toLocaleString()} sqft`;
}

function disableButton() {
  const btn = document.getElementById("runBtn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Optimizing...";
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

function updateLiveProgress(data: any) {
  // Update generation counter
  showStatus(
    `Generation ${data.generation}: ${data.pareto_size} solutions`,
    "info"
  );

  // Convert progress data to land use solutions for visualization
  const solutions: LandUseSolution[] = data.pareto_front.map((solution: any) =>
    createSolution(solution.genes, currentProblem)
  );

  if (solutions.length > 0) {
    // Update Pareto front chart
    updateLiveParetoChart(solutions);

    // Show best current solution
    const bestSolution = findBestCompromise(solutions);
    updateLiveSolutionDisplay(bestSolution);
  }
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

function updateLiveParetoChart(solutions: LandUseSolution[]) {
  const overcrowdings = solutions.map((s) => s.objectives.overcrowding);
  const underutilizations = solutions.map((s) => s.objectives.underutilization);

  // Use Plotly.react for efficient updates (no full redraw)
  const paretoData = [
    {
      x: overcrowdings,
      y: underutilizations,
      mode: "markers" as const,
      type: "scatter" as const,
      marker: {
        size: 8,
        color: "#667eea",
        opacity: 0.7,
      },
      name: "Current Front",
    },
  ];

  const layout: any = {
    title: { text: `Current Pareto Front (${solutions.length} solutions)` },
    xaxis: { title: { text: "Overcrowding" } },
    yaxis: { title: { text: "Underutilization" } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#e0e0e0" },
    margin: { t: 40, b: 60, l: 60, r: 20 },
    showlegend: false,
  };

  Plotly.react("paretoChart", paretoData, layout);
}

function updateLiveSolutionDisplay(solution: LandUseSolution) {
  // Update charts with best current solution
  drawPieChart("pieChart", solution, currentProblem);

  const metrics = solution.metrics!;
  drawUtilizationHeatmap("heatmapChart", metrics, currentProblem);
  drawCapacityVsDemand("capacityChart", metrics, currentProblem);

  // Make visualizations visible
  document.getElementById("visualizations")!.style.display = "block";
}

function findBestCompromise(solutions: LandUseSolution[]): LandUseSolution {
  const maxOvercrowding = Math.max(
    ...solutions.map((s) => s.objectives.overcrowding)
  );
  const maxUnderutilization = Math.max(
    ...solutions.map((s) => s.objectives.underutilization)
  );

  let best = solutions[0];
  let bestDistance = Infinity;

  for (const solution of solutions) {
    const normX = solution.objectives.overcrowding / maxOvercrowding;
    const normY = solution.objectives.underutilization / maxUnderutilization;
    const distance = Math.sqrt(normX * normX + normY * normY);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = solution;
    }
  }

  return best;
}

function displayResults(result: any) {
  showStatus("Optimization completed successfully!", "success");

  // Convert Pareto front to solutions
  paretoSolutions = result.pareto.map((genes: number[]) =>
    createSolution(genes, currentProblem)
  );

  console.log(`Found ${paretoSolutions.length} Pareto optimal solutions`);

  // Display first solution by default
  selectedSolutionIdx = 0;
  displaySolution(paretoSolutions[0]);

  // Draw Pareto front
  drawParetoFront("paretoChart", paretoSolutions);

  // Create solution selector
  createSolutionSelector();

  // Show visualizations
  document.getElementById("visualizations")!.style.display = "block";
}

function displaySolution(solution: LandUseSolution) {
  // Display allocation stats
  const allocationDiv = document.getElementById("allocationStats")!;
  allocationDiv.innerHTML = `
    <h4>Area Allocation</h4>
    ${Object.entries(solution.allocations)
      .map(
        ([name, area]) =>
          `<div><strong>${name}:</strong> ${area.toFixed(0)} sqft (${(
            (area / currentProblem.totalArea) *
            100
          ).toFixed(1)}%)</div>`
      )
      .join("")}
    <h4 style="margin-top: 15px;">Objectives</h4>
    <div><strong>Overcrowding Penalty:</strong> ${solution.objectives.overcrowding.toFixed(
      2
    )}</div>
    <div><strong>Underutilization Penalty:</strong> ${solution.objectives.underutilization.toFixed(
      2
    )}</div>
  `;

  // Draw pie chart
  drawPieChart("pieChart", solution, currentProblem);

  // Draw utilization heatmap
  drawUtilizationHeatmap("heatmapChart", solution.metrics, currentProblem);

  // Draw capacity vs demand chart
  drawCapacityVsDemand("capacityChart", solution.metrics, currentProblem);
}

function createSolutionSelector() {
  const selectorDiv = document.getElementById("solutionSelector")!;
  selectorDiv.innerHTML = `
    <label for="solutionSelect">Select Solution: </label>
    <select id="solutionSelect">
      ${paretoSolutions
        .map(
          (sol, idx) =>
            `<option value="${idx}">Solution ${
              idx + 1
            } (OC: ${sol.objectives.overcrowding.toFixed(
              1
            )}, UU: ${sol.objectives.underutilization.toFixed(1)})</option>`
        )
        .join("")}
    </select>
  `;

  const select = document.getElementById("solutionSelect") as HTMLSelectElement;
  select.onchange = () => {
    selectedSolutionIdx = parseInt(select.value);
    displaySolution(paretoSolutions[selectedSolutionIdx]);
  };
}

(window as any).runOptimization = async () => {
  if (!wasmInitialized) {
    showError("WASM not initialized yet");
    return;
  }

  disableButton();
  showStatus("Running land use optimization...", "info");

  const generations = parseInt(
    (document.getElementById("generations") as HTMLInputElement).value
  );
  const popSize = parseInt(
    (document.getElementById("popSize") as HTMLInputElement).value
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

  // Build objective matrices
  const objectives = buildObjectiveMatrices(currentProblem);
  const numVars = currentProblem.totalArea / currentProblem.unitSize;

  const spec: OptimizationSpec = {
    algorithm: "nsga2",
    num_vars: Math.floor(numVars),
    population_size: popSize,
    num_iterations: generations,
    crossover_rate: 0.9,
    mutation_rate: 0.1,
    num_offsprings: Math.floor(popSize * 0.5),
    objectives,
    workers: numWorkers || true, // Use specified workers or auto-detect
    migration_interval: migrationInterval,
    migration_rate: migrationRate,
    progress_interval: 10, // Update every 10 generations
  };

  try {
    const result = await solve_json(
      spec,
      (progressData) => {
        updateLiveProgress(progressData);
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

    displayResults(result);
    enableButton();
  } catch (error) {
    console.error("Optimization failed:", error);
    showError(`Optimization failed: ${(error as Error).message}`);
    enableButton();
  }
};

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  const numWorkersInput = document.getElementById(
    "numWorkers"
  ) as HTMLInputElement;
  numWorkersInput.value = String(navigator.hardwareConcurrency || 4);
  initWasm();
});
