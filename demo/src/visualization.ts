// Visualization utilities for land use optimizer using Plotly

import Plotly, { Config, Data } from "plotly.js-dist";
import type {
  LandUseSolution,
  LandUseProblem,
  UtilizationMetrics,
} from "./landUseOptimizer.js";

/**
 * Create a pie chart showing area allocation
 */
export function drawPieChart(
  containerId: string,
  solution: LandUseSolution,
  problem: LandUseProblem
): void {
  const values = problem.landUses.map(
    (landUse) => solution.allocations[landUse.name]
  );
  const labels = problem.landUses.map((landUse) => landUse.name);
  const colors = ["#667eea", "#f093fb", "#4facfe"];

  const data = [
    {
      values,
      labels,
      type: "pie" as const,
      marker: {
        colors,
      },
      textinfo: "label+percent" as const,
      textposition: "inside" as const,
      hovertemplate:
        "<b>%{label}</b><br>%{value} sqft<br>%{percent}<extra></extra>",
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
      orientation: "v" as const,
      x: 1,
      y: 0.5,
    },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  Plotly.newPlot(containerId, data, layout, config);
}

/**
 * Draw utilization heatmap
 */
export function drawUtilizationHeatmap(
  containerId: string,
  metrics: UtilizationMetrics,
  problem: LandUseProblem
): void {
  const periods = ["Morning", "Afternoon", "Evening"];
  const landUseNames = problem.landUses.map((lu) => lu.name);

  // Build z-values (utilization percentages) as a 2D array
  const zValues: number[][] = [];
  const hoverText: string[][] = [];

  problem.landUses.forEach((landUse) => {
    const row: number[] = [];
    const hoverRow: string[] = [];

    periods.forEach((period) => {
      const periodKey = period.toLowerCase();
      const data = metrics[landUse.name][periodKey];
      const utilization = data.utilization * 100; // Convert to percentage

      row.push(utilization);
      hoverRow.push(
        `<b>${landUse.name} - ${period}</b><br>` +
          `Utilization: ${utilization.toFixed(1)}%<br>` +
          `Demand: ${data.demand.toFixed(0)} people<br>` +
          `Capacity: ${data.capacity.toFixed(0)} people`
      );
    });

    zValues.push(row);
    hoverText.push(hoverRow);
  });

  const data: any = [
    {
      z: zValues,
      x: periods,
      y: landUseNames,
      type: "heatmap" as const,
      colorscale: [
        [0, "#42a5f5"], // Very underutilized (blue)
        [0.5, "#ffa726"], // Underutilized (orange)
        [0.9, "#66bb6a"], // Optimal (green)
        [1, "#ef5350"], // Overcrowded (red)
      ],
      zmin: 0,
      zmax: 150,
      hovertemplate: "%{text}<extra></extra>",
      text: hoverText,
      colorbar: {
        title: "Utilization %",
        titleside: "right",
        ticksuffix: "%",
        tickfont: { color: "#e0e0e0" },
        titlefont: { color: "#e0e0e0" },
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
      title: { text: "Time Period" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
    },
    yaxis: {
      title: { text: "Land Use" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
    },
    margin: { t: 20, b: 60, l: 100, r: 100 },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  Plotly.newPlot(containerId, data, layout, config);
}

/**
 * Draw Pareto front scatter plot
 */
export function drawParetoFront(
  containerId: string,
  solutions: LandUseSolution[]
): void {
  if (solutions.length === 0) return;

  const overcrowdings = solutions.map((s) => s.objectives.overcrowding);
  const underutilizations = solutions.map((s) => s.objectives.underutilization);

  // Find best compromise (closest to origin in normalized space)
  const maxOvercrowding = Math.max(...overcrowdings);
  const maxUnderutilization = Math.max(...underutilizations);

  let bestIdx = 0;
  let bestDistance = Infinity;
  solutions.forEach((solution, idx) => {
    const normX = solution.objectives.overcrowding / maxOvercrowding;
    const normY = solution.objectives.underutilization / maxUnderutilization;
    const distance = Math.sqrt(normX * normX + normY * normY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = idx;
    }
  });

  // All solutions
  const allSolutions = {
    x: overcrowdings,
    y: underutilizations,
    mode: "markers" as const,
    type: "scatter" as const,
    name: "Pareto Solutions",
    marker: {
      size: 10,
      color: "#667eea",
      line: {
        color: "#764ba2",
        width: 1,
      },
    },
    hovertemplate:
      "<b>Solution</b><br>" +
      "Overcrowding: %{x:.2f}<br>" +
      "Underutilization: %{y:.2f}<br>" +
      "<extra></extra>",
  };

  // Best compromise
  const bestSolution = {
    x: [overcrowdings[bestIdx]],
    y: [underutilizations[bestIdx]],
    mode: "markers" as const,
    type: "scatter" as const,
    name: "Best Compromise",
    marker: {
      size: 15,
      color: "#f093fb",
      symbol: "star",
      line: {
        color: "#ffffff",
        width: 2,
      },
    },
    hovertemplate:
      "<b>Best Compromise</b><br>" +
      "Overcrowding: %{x:.2f}<br>" +
      "Underutilization: %{y:.2f}<br>" +
      "<extra></extra>",
  };

  const data = [allSolutions, bestSolution];

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
      zeroline: true,
      zerolinecolor: "#667eea",
    },
    yaxis: {
      title: { text: "Underutilization Penalty" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
      zeroline: true,
      zerolinecolor: "#667eea",
    },
    margin: { t: 20, b: 60, l: 60, r: 20 },
    showlegend: true,
    legend: {
      x: 1,
      xanchor: "right" as const,
      y: 1,
      bgcolor: "rgba(42, 42, 42, 0.8)",
    },
    hovermode: "closest" as const,
  };

  const config: Partial<Config> = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };

  Plotly.newPlot(containerId, data, layout, config);
}

/**
 * Create a grouped bar chart comparing capacity vs demand
 */
export function drawCapacityVsDemand(
  containerId: string,
  metrics: UtilizationMetrics,
  problem: LandUseProblem
): void {
  const periods = ["Morning", "Afternoon", "Evening"];

  // Prepare traces for each land use
  const traces: Data[] = [];

  problem.landUses.forEach((landUse, idx) => {
    const capacities: number[] = [];
    const demands: number[] = [];

    periods.forEach((period) => {
      const periodKey = period.toLowerCase();
      const data = metrics[landUse.name][periodKey];
      capacities.push(data.capacity);
      demands.push(data.demand);
    });

    // Capacity trace
    traces.push({
      x: periods,
      y: capacities,
      name: `${landUse.name} Capacity`,
      type: "bar" as const,
      marker: {
        color: ["#667eea", "#764ba2", "#4facfe"][idx],
        opacity: 0.6,
      },
      hovertemplate: "%{y:.0f} people<extra></extra>",
    });

    // Demand trace
    traces.push({
      x: periods,
      y: demands,
      name: `${landUse.name} Demand`,
      type: "bar" as const,
      marker: {
        color: ["#667eea", "#764ba2", "#4facfe"][idx],
        pattern: {
          shape: "/",
        },
      },
      hovertemplate: "%{y:.0f} people<extra></extra>",
    });
  });

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: "#e0e0e0",
      size: 12,
    },
    xaxis: {
      title: { text: "Time Period" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
    },
    yaxis: {
      title: { text: "People" },
      color: "#e0e0e0",
      gridcolor: "#3a3a3a",
    },
    margin: { t: 20, b: 60, l: 60, r: 20 },
    barmode: "group" as const,
    showlegend: true,
    legend: {
      orientation: "h" as const,
      y: -0.2,
      bgcolor: "rgba(42, 42, 42, 0.8)",
    },
  };

  const config = {
    responsive: true,
    displayModeBar: false,
  };

  Plotly.newPlot(containerId, traces, layout, config);
}
