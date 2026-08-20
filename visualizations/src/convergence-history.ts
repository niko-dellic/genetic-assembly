import * as d3 from "d3";
import { CHART_COLORS, dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationController, VisualizationFrame, VizGeneration } from "./types.js";

export function createConvergenceHistory(container: HTMLElement): VisualizationController {
  let frame: VisualizationFrame | undefined;
  function render(): void {
    if (!frame || !frame.dataset.history_complete || frame.dataset.generations.length === 0) {
      emptyMessage(container, "Complete generation statistics are unavailable for this run.");
      return;
    }
    const { width, height } = dimensions(container);
    const margin = { top: 14, right: 18, bottom: 34, left: 48 };
    const generations = frame.dataset.generations;
    const values = generations.flatMap((generation) =>
      generation.objective_stats.flatMap((stats) => [stats.min, stats.max]));
    const x = d3.scaleLinear().domain(d3.extent(generations, (item) => item.generation) as [number, number])
      .range([margin.left, width - margin.right]);
    const extent = d3.extent(values) as [number, number];
    const padding = (extent[1] - extent[0]) * 0.06 || 1;
    const y = d3.scaleLinear().domain([extent[0] - padding, extent[1] + padding]).nice()
      .range([height - margin.bottom, margin.top]);
    const svg = replaceSvg(container, "Objective convergence history")
      .attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));
    frame.dataset.objectives.forEach((objective, objectiveIndex) => {
      const color = CHART_COLORS[objectiveIndex % CHART_COLORS.length];
      const area = d3.area<VizGeneration>()
        .x((generation) => x(generation.generation))
        .y0((generation) => y(Math.max(generation.objective_stats[objectiveIndex].min, generation.objective_stats[objectiveIndex].mean - generation.objective_stats[objectiveIndex].stddev)))
        .y1((generation) => y(Math.min(generation.objective_stats[objectiveIndex].max, generation.objective_stats[objectiveIndex].mean + generation.objective_stats[objectiveIndex].stddev)));
      const line = d3.line<VizGeneration>()
        .x((generation) => x(generation.generation))
        .y((generation) => y(generation.objective_stats[objectiveIndex].mean));
      svg.append("path").datum(generations).attr("d", area).attr("fill", color).attr("fill-opacity", 0.08);
      svg.append("path").datum(generations).attr("d", line).attr("fill", "none")
        .attr("stroke", color).attr("stroke-width", 1.8);
      svg.append("text").attr("x", margin.left + objectiveIndex * 105).attr("y", 11)
        .attr("fill", color).attr("class", "viz-legend-label").text(objective.name);
    });
  }
  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); frame = undefined; },
  };
}
