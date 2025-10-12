// Three.js Optimization Demo
import init, { solve_with_custom_eval } from "../../../pkg/index.js";
import {
  buildThreeJsSpec,
  decodeThreeJsResult,
  createComposedEvalFunction,
} from "../../../pkg/threejs-helpers.js";
import type { OptimizationResult, ProgressData } from "../types/types.js";
import Plotly from "plotly.js-dist";

let wasmInitialized = false;

// Mock Three.js object structure (in real app, use actual THREE.Mesh)
interface MockObject3D {
  userData: Record<string, any>;
  position: { toArray: () => number[]; fromArray: (arr: number[]) => void };
  rotation: {
    x: number;
    y: number;
    z: number;
    set: (x: number, y: number, z: number) => void;
  };
  scale: { toArray: () => number[]; fromArray: (arr: number[]) => void };
}

function createMockRoom(userData: Record<string, any>): MockObject3D {
  return {
    userData,
    position: {
      toArray: () => [0, 0, 0],
      fromArray: (_arr: number[]) => {},
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      set: (_x: number, _y: number, _z: number) => {},
    },
    scale: {
      toArray: () => [1, 1, 1],
      fromArray: (_arr: number[]) => {},
    },
  };
}

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

// Track progress for real-time visualization
let progressHistory: { generation: number; paretoSize: number }[] = [];

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

function updateProgressChart(usePlotlyReact = false) {
  if (progressHistory.length === 0) return;

  const generations = progressHistory.map((p) => p.generation);
  const paretoSizes = progressHistory.map((p) => p.paretoSize);

  const data = [
    {
      x: generations,
      y: paretoSizes,
      type: "scatter" as const,
      mode: "lines+markers" as const,
      name: "Pareto Front Size",
      line: {
        color: "#667eea",
        width: 2,
      },
      marker: {
        color: "#f093fb",
        size: 6,
      },
    },
  ];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: "#e0e0e0",
      size: 12,
    },
    xaxis: {
      title: { text: "Generation" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
    },
    yaxis: {
      title: { text: "Pareto Front Size" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
    },
    margin: { t: 20, b: 60, l: 60, r: 20 },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  // Use Plotly.react for efficient live updates, newPlot for initial render
  if (usePlotlyReact) {
    Plotly.react("progressChart", data, layout, config);
  } else {
    Plotly.newPlot("progressChart", data, layout, config);
  }
}

function updateLiveDisplay(bestSolution: any) {
  // Show visualization section if not already visible
  const vizSection = document.getElementById("visualizations")!;
  vizSection.style.display = "grid";

  // Update progress chart (use react for efficiency)
  updateProgressChart(true);

  // Update allocation chart (use react for efficiency)
  drawAllocationChart(bestSolution, true);

  // Update solution details
  const solutionDiv = document.getElementById("solutionDisplay")!;
  const totalArea = Object.values(bestSolution).reduce(
    (sum: number, val: any) => sum + Number(val),
    0
  );
  solutionDiv.innerHTML = `
    <h4>Optimized Solution</h4>
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; font-size: 11px;">
      <div style="text-align: center; padding: 8px; background: rgba(102, 126, 234, 0.1); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #667eea;">${Math.round(
          bestSolution.restaurant
        )}</div>
        <div style="opacity: 0.8;">Restaurant</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.restaurant / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
      <div style="text-align: center; padding: 8px; background: rgba(240, 147, 251, 0.1); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #f093fb;">${Math.round(
          bestSolution.residential
        )}</div>
        <div style="opacity: 0.8;">Residential</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.residential / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
      <div style="text-align: center; padding: 8px; background: rgba(79, 172, 254, 0.1); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #4facfe;">${Math.round(
          bestSolution.retail
        )}</div>
        <div style="opacity: 0.8;">Retail</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.retail / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
      <div style="text-align: center; padding: 8px; background: rgba(102, 187, 106, 0.1); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #66bb6a;">${Math.round(
          bestSolution.office
        )}</div>
        <div style="opacity: 0.8;">Office</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.office / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
      <div style="text-align: center; padding: 8px; background: rgba(255, 167, 38, 0.1); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #ffa726;">${Math.round(
          bestSolution.cafe
        )}</div>
        <div style="opacity: 0.8;">Cafe</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.cafe / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
      <div style="text-align: center; padding: 8px; background: rgba(239, 83, 80, 0.1); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #ef5350;">${Math.round(
          bestSolution.gym
        )}</div>
        <div style="opacity: 0.8;">Gym</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.gym / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
      <div style="text-align: center; padding: 8px; background: rgba(102, 187, 106, 0.2); border-radius: 4px;">
        <div style="font-size: 16px; font-weight: bold; color: #81c784;">${Math.round(
          bestSolution.greenSpace
        )}</div>
        <div style="opacity: 0.8;">Green Space</div>
        <div style="opacity: 0.6; font-size: 10px;">${(
          (bestSolution.greenSpace / totalArea) *
          100
        ).toFixed(1)}%</div>
      </div>
    </div>
  `;
}

function displayResults(result: OptimizationResult, bestSolution: any) {
  showStatus(
    `✅ Optimization completed! Found ${result.stats.pareto_size} Pareto optimal solutions in ${result.executionTime}ms`,
    "success"
  );

  // Final update of all visualizations (includes solution display)
  updateLiveDisplay(bestSolution);

  // Display pareto front JSON (the chart is already updated from real-time progress)
  const paretoOutput = document.getElementById("paretoOutput")!;
  paretoOutput.textContent = JSON.stringify(result.pareto, null, 2);
}

function updateParetoFront(
  allIndividuals: any[],
  paretoFront: any[],
  usePlotlyReact = false
) {
  if (!allIndividuals || allIndividuals.length === 0) return;
  if (!paretoFront || paretoFront.length === 0) return;

  // Create a Set of Pareto front genes for quick lookup
  const paretoGenesSets = new Set(
    paretoFront.map((ind) => JSON.stringify(ind.genes))
  );

  // Separate Pareto and non-Pareto individuals
  const paretoIndividuals: any[] = [];
  const nonParetoIndividuals: any[] = [];

  allIndividuals.forEach((ind) => {
    if (paretoGenesSets.has(JSON.stringify(ind.genes))) {
      paretoIndividuals.push(ind);
    } else {
      nonParetoIndividuals.push(ind);
    }
  });

  const data: any[] = [];

  // Plot non-Pareto solutions first (so they appear behind)
  if (nonParetoIndividuals.length > 0) {
    data.push({
      x: nonParetoIndividuals.map((ind) => ind.objectives[0]),
      y: nonParetoIndividuals.map((ind) => ind.objectives[1]),
      type: "scatter" as const,
      mode: "markers" as const,
      name: "Other Solutions",
      marker: {
        size: 5,
        color: "#3a3a3a", // Dark gray
        opacity: 0.3, // Faded
        line: {
          color: "#2a2a2a",
          width: 0.5,
        },
      },
      hovertemplate:
        "<b>Non-Pareto Solution</b><br>" +
        "Overcrowding: %{x:.2f}<br>" +
        "Underutilization: %{y:.2f}<br>" +
        "<extra></extra>",
    });
  }

  // Plot Pareto front solutions on top (prominent)
  if (paretoIndividuals.length > 0) {
    const paretoOvercrowding = paretoIndividuals.map(
      (ind) => ind.objectives[0]
    );
    const paretoUnderutilization = paretoIndividuals.map(
      (ind) => ind.objectives[1]
    );
    const paretoCost = paretoIndividuals.map((ind) => ind.objectives[2]);

    data.push({
      x: paretoOvercrowding,
      y: paretoUnderutilization,
      type: "scatter" as const,
      mode: "markers" as const,
      name: "Pareto Front",
      marker: {
        size: 9,
        color: paretoCost, // Color by cost
        colorscale: "Viridis",
        showscale: true,
        colorbar: {
          title: "Cost",
          titleside: "right" as const,
          tickfont: { color: "#e0e0e0" },
          titlefont: { color: "#e0e0e0" },
        },
        line: {
          color: "#ffffff",
          width: 1,
        },
      },
      hovertemplate:
        "<b>Pareto Solution</b><br>" +
        "Overcrowding: %{x:.2f}<br>" +
        "Underutilization: %{y:.2f}<br>" +
        "Cost: %{marker.color:.2f}<br>" +
        "<extra></extra>",
    });
  }

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: "#e0e0e0",
      size: 12,
    },
    xaxis: {
      title: { text: "Overcrowding Penalty" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
      zeroline: false,
    },
    yaxis: {
      title: { text: "Underutilization Penalty" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
      zeroline: false,
    },
    margin: { t: 20, b: 60, l: 60, r: 100 },
    hovermode: "closest" as const,
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  // Use Plotly.react for efficient live updates, newPlot for initial render
  if (usePlotlyReact) {
    Plotly.react("paretoChart", data, layout, config);
  } else {
    Plotly.newPlot("paretoChart", data, layout, config);
  }
}

function drawAllocationChart(bestSolution: any, usePlotlyReact = false) {
  const data = [
    {
      values: [
        bestSolution.restaurant,
        bestSolution.residential,
        bestSolution.retail,
        bestSolution.office,
        bestSolution.cafe,
        bestSolution.gym,
        bestSolution.greenSpace,
      ],
      labels: [
        "Restaurant",
        "Residential",
        "Retail",
        "Office",
        "Cafe",
        "Gym",
        "Green Space",
      ],
      type: "pie" as const,
      marker: {
        colors: [
          "#667eea",
          "#f093fb",
          "#4facfe",
          "#66bb6a",
          "#ffa726",
          "#ef5350",
          "#81c784",
        ],
      },
      textinfo: "label+percent" as const,
      textposition: "inside" as const,
      hovertemplate:
        "<b>%{label}</b><br>%{value:.0f} sqft<br>%{percent}<extra></extra>",
    },
  ];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: "#e0e0e0",
      size: 12,
    },
    margin: { t: 20, b: 20, l: 20, r: 20 },
    showlegend: true,
    legend: {
      orientation: "h" as const,
      y: -0.2,
    },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  // Use Plotly.react for efficient live updates, newPlot for initial render
  if (usePlotlyReact) {
    Plotly.react("allocationChart", data, layout, config);
  } else {
    Plotly.newPlot("allocationChart", data, layout, config);
  }
}

(window as any).runOptimization = async () => {
  if (!wasmInitialized) {
    showError("WASM not initialized yet");
    return;
  }

  disableButton();
  showStatus("Initializing optimization...", "info");

  const populationSize = parseInt(
    (document.getElementById("populationSize") as HTMLInputElement).value
  );
  const generations = parseInt(
    (document.getElementById("generations") as HTMLInputElement).value
  );

  // Enable workers for parallel execution
  const numWorkersInput = document.getElementById(
    "numWorkers"
  ) as HTMLInputElement;
  const numWorkers = numWorkersInput.value
    ? parseInt(numWorkersInput.value)
    : true; // true = auto-detect

  const totalArea = parseInt(
    (document.getElementById("totalArea") as HTMLInputElement).value
  );

  const migrationInterval = parseInt(
    (document.getElementById("migrationInterval") as HTMLInputElement).value
  );
  const migrationRate = parseFloat(
    (document.getElementById("migrationRate") as HTMLInputElement).value
  );

  // Reset progress history
  progressHistory = [];

  // Show visualization section at start
  const vizSection = document.getElementById("visualizations")!;
  vizSection.style.display = "grid";

  // Initialize empty charts
  Plotly.newPlot(
    "progressChart",
    [],
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#e0e0e0" },
      xaxis: {
        title: { text: "Generation" },
        color: "#e0e0e0",
        gridcolor: "#3a3a3a",
      },
      yaxis: {
        title: { text: "Pareto Front Size" },
        color: "#e0e0e0",
        gridcolor: "#3a3a3a",
      },
      margin: { t: 20, b: 60, l: 60, r: 20 },
    },
    { responsive: true, displayModeBar: false }
  );

  Plotly.newPlot(
    "allocationChart",
    [],
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#e0e0e0" },
      margin: { t: 20, b: 20, l: 20, r: 20 },
    },
    { responsive: true, displayModeBar: false }
  );

  Plotly.newPlot(
    "paretoChart",
    [],
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#e0e0e0" },
      xaxis: {
        title: { text: "Overcrowding Penalty" },
        color: "#e0e0e0",
        gridcolor: "#3a3a3a",
      },
      yaxis: {
        title: { text: "Underutilization Penalty" },
        color: "#e0e0e0",
        gridcolor: "#3a3a3a",
      },
      margin: { t: 20, b: 60, l: 60, r: 100 },
    },
    { responsive: true, displayModeBar: false }
  );

  // Initialize solution display
  const solutionDiv = document.getElementById("solutionDisplay")!;
  solutionDiv.innerHTML = `
    <h4>Optimizing...</h4>
    <div style="text-align: center; padding: 20px; opacity: 0.6;">
      Waiting for first generation results...
    </div>
  `;

  // Create mock Three.js room object with userData - Complex multi-use building
  const room = createMockRoom({
    // Mutable properties (will be optimized) - 7 different land uses
    restaurant: 800,
    residential: 1500,
    retail: 600,
    office: 1200,
    cafe: 400,
    gym: 500,
    greenSpace: 300,
    // Static properties (used for evaluation)
    totalArea: totalArea,
    // Demand varies by land use and time of day (people per hour)
    demandProfile: {
      restaurant: {
        earlyMorning: 20,
        morning: 50,
        lunchTime: 180,
        afternoon: 40,
        evening: 200,
        lateNight: 60,
      },
      residential: {
        earlyMorning: 300,
        morning: 250,
        lunchTime: 100,
        afternoon: 150,
        evening: 350,
        lateNight: 380,
      },
      retail: {
        earlyMorning: 10,
        morning: 80,
        lunchTime: 120,
        afternoon: 180,
        evening: 150,
        lateNight: 30,
      },
      office: {
        earlyMorning: 20,
        morning: 280,
        lunchTime: 200,
        afternoon: 300,
        evening: 80,
        lateNight: 10,
      },
      cafe: {
        earlyMorning: 40,
        morning: 150,
        lunchTime: 100,
        afternoon: 120,
        evening: 80,
        lateNight: 20,
      },
      gym: {
        earlyMorning: 80,
        morning: 120,
        lunchTime: 40,
        afternoon: 60,
        evening: 200,
        lateNight: 50,
      },
      greenSpace: {
        earlyMorning: 10,
        morning: 30,
        lunchTime: 80,
        afternoon: 60,
        evening: 40,
        lateNight: 5,
      },
    },
    // How many people can be accommodated per sqft
    capacityPerUnit: {
      restaurant: 0.08, // ~12.5 sqft per person (table + service space)
      residential: 0.04, // ~25 sqft per person (living space)
      retail: 0.06, // ~16.7 sqft per person (shopping space)
      office: 0.05, // ~20 sqft per person (desk + walkways)
      cafe: 0.1, // ~10 sqft per person (tight seating)
      gym: 0.03, // ~33 sqft per person (equipment + space)
      greenSpace: 0.02, // ~50 sqft per person (open area)
    },
    // Operating cost per sqft per year (for cost minimization objective)
    operatingCost: {
      restaurant: 45, // High cost (kitchen, staff)
      residential: 15, // Low cost (maintenance only)
      retail: 25, // Medium cost
      office: 20, // Medium cost
      cafe: 35, // High cost (equipment, staff)
      gym: 30, // High cost (equipment maintenance)
      greenSpace: 10, // Low cost (landscaping)
    },
    // Minimum required area for each use (constraints)
    minArea: {
      restaurant: 500,
      residential: 1000,
      retail: 400,
      office: 800,
      cafe: 200,
      gym: 300,
      greenSpace: 200,
    },
  });

  // Define mutation function (how genes map to userData) - 7 genes
  const mutationFn = (genes: number[], staticProps: any) => {
    // Normalize genes to sum to 1.0 so allocations add up to totalArea
    const geneSum = genes.reduce((sum, g) => sum + g, 0);
    console.log("mutationFn - genes:", genes, "geneSum:", geneSum);
    const normalizedGenes = geneSum > 0 ? genes.map((g) => g / geneSum) : genes;
    console.log("mutationFn - normalizedGenes:", normalizedGenes);

    // Enforce minimum areas by scaling remaining space
    const minAreas = staticProps.minArea;
    const totalMinArea = Object.values(minAreas).reduce(
      (sum: number, val: any) => sum + val,
      0
    );
    const availableSpace = staticProps.totalArea - totalMinArea;

    return {
      restaurant: minAreas.restaurant + normalizedGenes[0] * availableSpace,
      residential: minAreas.residential + normalizedGenes[1] * availableSpace,
      retail: minAreas.retail + normalizedGenes[2] * availableSpace,
      office: minAreas.office + normalizedGenes[3] * availableSpace,
      cafe: minAreas.cafe + normalizedGenes[4] * availableSpace,
      gym: minAreas.gym + normalizedGenes[5] * availableSpace,
      greenSpace: minAreas.greenSpace + normalizedGenes[6] * availableSpace,
    };
  };

  // Define evaluation function (calculate 3 objectives with complex constraints)
  const evaluationFn = (userData: any, staticProps: any) => {
    const { demandProfile, capacityPerUnit, operatingCost } = staticProps;

    const landUses = [
      "restaurant",
      "residential",
      "retail",
      "office",
      "cafe",
      "gym",
      "greenSpace",
    ];
    const timePeriods = [
      "earlyMorning",
      "morning",
      "lunchTime",
      "afternoon",
      "evening",
      "lateNight",
    ];

    // Objective 1: Minimize total overcrowding penalty
    // Heavy penalty for not meeting demand
    let overcrowding = 0;
    timePeriods.forEach((period) => {
      landUses.forEach((landUse) => {
        const demand = demandProfile[landUse][period];
        const area = userData[landUse];
        const capacity = area * capacityPerUnit[landUse];

        if (demand > capacity) {
          // Quadratic penalty for overcrowding (worse as it gets more severe)
          const shortage = demand - capacity;
          overcrowding += shortage * shortage * 0.5;
        }
      });
    });

    // Objective 2: Minimize underutilization and waste
    // Penalty for having too much empty space (but less severe than overcrowding)
    let underutilization = 0;
    timePeriods.forEach((period) => {
      landUses.forEach((landUse) => {
        const demand = demandProfile[landUse][period];
        const area = userData[landUse];
        const capacity = area * capacityPerUnit[landUse];

        // Allow 20% buffer, penalize beyond that
        if (capacity > demand * 1.2) {
          const excess = capacity - demand * 1.2;
          underutilization += excess * 0.3; // Linear penalty, lighter than overcrowding
        }
      });
    });

    // Objective 3: Minimize total annual operating cost
    // Economic consideration
    let totalCost = 0;
    landUses.forEach((landUse) => {
      totalCost += userData[landUse] * operatingCost[landUse];
    });

    // Normalize cost to similar scale as other objectives
    const normalizedCost = totalCost / 1000;

    // Additional penalty for imbalanced mix (soft constraint)
    // Encourage diverse land use rather than all-in on one type
    const areas = landUses.map((lu) => userData[lu]);
    const maxArea = Math.max(...areas);
    const minArea = Math.min(...areas);
    const balancePenalty = (maxArea / (minArea + 1)) * 2; // Penalty for extreme imbalance

    return [
      overcrowding + balancePenalty * 0.5,
      underutilization,
      normalizedCost,
    ];
  };

  // Build Three.js optimization spec
  // This uses buildThreeJsSpec to set up the spec with proper configuration
  const spec = buildThreeJsSpec([room], {
    mutableProps: [
      "restaurant",
      "residential",
      "retail",
      "office",
      "cafe",
      "gym",
      "greenSpace",
    ],
    staticProps: [
      "totalArea",
      "demandProfile",
      "capacityPerUnit",
      "operatingCost",
      "minArea",
    ],
    mutationFn,
    evaluationFn,
    populationSize,
    generations,
    workers: numWorkers, // Enable parallel workers
    migration_interval: migrationInterval,
    migration_rate: migrationRate,
  });

  // Create composed evaluation function (genes -> objectives)
  const composedEvalFn = createComposedEvalFunction(spec);

  try {
    // Use solve_with_custom_eval for non-linear objectives
    // When workers are enabled, this returns a Promise
    const result = await solve_with_custom_eval(
      spec,
      composedEvalFn,
      (progressData: ProgressData) => {
        // Only track progress from worker 0 to avoid chart jumping between workers
        // Each worker reports its own generation count, causing the chart to bounce
        if (
          progressData.workerId !== undefined &&
          progressData.workerId !== 0
        ) {
          return; // Ignore progress from other workers for charting
        }

        // Track progress for visualization
        progressHistory.push({
          generation: progressData.generation,
          paretoSize: progressData.pareto_size,
        });

        showStatus(
          `Generation ${progressData.generation}: ${progressData.pareto_size} solutions`,
          "info"
        );

        // Update progress chart every 5 generations
        if (progressHistory.length % 5 === 0) {
          updateProgressChart(true);
        }

        // Update solution display if we have pareto front data
        if (progressData.pareto_front?.length > 0) {
          // Update Pareto front chart with all individuals (Pareto and non-Pareto)
          updateParetoFront(
            progressData.full_population,
            progressData.pareto_front,
            true
          );

          // Decode best solution from Pareto front (first individual)
          const bestGenes = progressData.pareto_front[0].genes;
          console.log("Best genes:", bestGenes);
          const bestSolution = mutationFn(bestGenes, room.userData);
          console.log("Best solution:", bestSolution);

          // Update allocation chart and solution details
          drawAllocationChart(bestSolution, true);

          // Update solution details
          const solutionDiv = document.getElementById("solutionDisplay")!;
          const totalArea = Object.values(bestSolution).reduce(
            (sum: number, val: any) => sum + Number(val),
            0
          );
          solutionDiv.innerHTML = `
            <h4>Current Best Solution (Gen ${progressData.generation})</h4>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; font-size: 11px;">
              <div style="text-align: center; padding: 8px; background: rgba(102, 126, 234, 0.1); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #667eea;">${Math.round(
                  bestSolution.restaurant
                )}</div>
                <div style="opacity: 0.8;">Restaurant</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.restaurant / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(240, 147, 251, 0.1); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #f093fb;">${Math.round(
                  bestSolution.residential
                )}</div>
                <div style="opacity: 0.8;">Residential</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.residential / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(79, 172, 254, 0.1); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #4facfe;">${Math.round(
                  bestSolution.retail
                )}</div>
                <div style="opacity: 0.8;">Retail</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.retail / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(102, 187, 106, 0.1); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #66bb6a;">${Math.round(
                  bestSolution.office
                )}</div>
                <div style="opacity: 0.8;">Office</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.office / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(255, 167, 38, 0.1); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #ffa726;">${Math.round(
                  bestSolution.cafe
                )}</div>
                <div style="opacity: 0.8;">Cafe</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.cafe / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(239, 83, 80, 0.1); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #ef5350;">${Math.round(
                  bestSolution.gym
                )}</div>
                <div style="opacity: 0.8;">Gym</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.gym / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(102, 187, 106, 0.2); border-radius: 4px;">
                <div style="font-size: 16px; font-weight: bold; color: #81c784;">${Math.round(
                  bestSolution.greenSpace
                )}</div>
                <div style="opacity: 0.8;">Green Space</div>
                <div style="opacity: 0.6; font-size: 10px;">${(
                  (bestSolution.greenSpace / totalArea) *
                  100
                ).toFixed(1)}%</div>
              </div>
            </div>
          `;
        }
      },
      {
        onWorkerStatusChange: (statuses: any[]) => {
          updateWorkerStatusDisplay(statuses);
        },
      }
    );

    // Decode and apply best solution
    console.log("Result pareto genes:", result.pareto[0]);
    const solutions = decodeThreeJsResult(result, spec);
    const bestSolution = solutions[0];
    console.log("Decoded best solution:", bestSolution);

    // Apply the decoded solution to the room's userData
    Object.assign(room.userData, bestSolution);

    console.log("Optimized room.userData:", room.userData);

    displayResults(result, bestSolution);
    enableButton();
  } catch (error) {
    console.error("Optimization failed:", error);
    showError(`Optimization failed: ${(error as Error).message}`);
    enableButton();
  }
};

// Initialize WASM on page load
initWasm();
