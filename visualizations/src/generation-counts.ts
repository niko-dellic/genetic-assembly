import * as d3 from "d3";
import { dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationController, VisualizationFrame } from "./types.js";

export function createGenerationCounts(container: HTMLElement): VisualizationController {
  let frame: VisualizationFrame | undefined;

  function render(): void {
    const generations = frame?.dataset.generations ?? [];
    if (generations.length === 0 || !frame?.dataset.history_complete) {
      emptyMessage(container, "Complete generation history is unavailable for this run.");
      return;
    }
    const { width, height } = dimensions(container);
    const margin = { top: 18, right: 16, bottom: 28, left: 38 };
    const x = d3.scaleLinear().domain(d3.extent(generations, (item) => item.generation) as [number, number])
      .range([margin.left, width - margin.right]);
    const maximum = d3.max(generations, (item) => Math.max(item.pareto_size, item.feasible_count, item.infeasible_count)) ?? 1;
    const y = d3.scaleLinear().domain([0, maximum]).nice().range([height - margin.bottom, margin.top]);
    const svg = replaceSvg(container, "Pareto and feasibility population history").attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(5));
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4));
    const series = [
      { label: "Pareto", color: "#5eead4", value: (item: typeof generations[number]) => item.pareto_size },
      { label: "Feasible", color: "#60a5fa", value: (item: typeof generations[number]) => item.feasible_count },
      { label: "Infeasible", color: "#fb7185", value: (item: typeof generations[number]) => item.infeasible_count },
    ];
    for (const item of series) {
      const line = d3.line<typeof generations[number]>().x((datum) => x(datum.generation)).y((datum) => y(item.value(datum)));
      svg.append("path").datum(generations).attr("fill", "none").attr("stroke", item.color)
        .attr("stroke-width", 1.8).attr("d", line);
    }
    const legend = svg.append("g").attr("transform", `translate(${margin.left + 4},${margin.top})`);
    series.forEach((item, index) => {
      const row = legend.append("g").attr("transform", `translate(${index * 82},0)`);
      row.append("circle").attr("r", 3).attr("fill", item.color);
      row.append("text").attr("x", 7).attr("y", 3).attr("class", "viz-axis-label").text(item.label);
    });
  }

  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); frame = undefined; },
  };
}
