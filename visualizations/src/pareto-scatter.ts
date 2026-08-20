import * as d3 from "d3";
import { chartColor, dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationCallbacks, VisualizationController, VisualizationFrame } from "./types.js";

export function createParetoScatter(
  container: HTMLElement,
  callbacks: VisualizationCallbacks = {},
): VisualizationController {
  let frame: VisualizationFrame | undefined;

  function render(): void {
    if (!frame || frame.dataset.objectives.length < 2 || frame.dataset.candidates.length === 0) {
      emptyMessage(container, "At least two objectives and one candidate are required.");
      return;
    }
    const { width, height } = dimensions(container);
    const margin = { top: 18, right: 18, bottom: 42, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const xIndex = frame.xObjective ?? 0;
    const fallbackY = xIndex === 0 ? 1 : 0;
    const yIndex = frame.yObjective === undefined || frame.yObjective === xIndex
      ? fallbackY
      : frame.yObjective;
    const candidates = frame.dataset.candidates;
    const xValues = candidates.map((candidate) => candidate.individual.objectives[xIndex]);
    const yValues = candidates.map((candidate) => candidate.individual.objectives[yIndex]);
    const x = d3.scaleLinear().domain(paddedExtent(xValues)).nice().range([0, innerWidth]);
    const y = d3.scaleLinear().domain(paddedExtent(yValues)).nice().range([innerHeight, 0]);
    const svg = replaceSvg(container, "Pareto objective-space scatter plot")
      .attr("viewBox", `0 0 ${width} ${height}`);
    const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    root.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(5));
    root.append("g").call(d3.axisLeft(y).ticks(5));
    root.append("text").attr("class", "viz-axis-label").attr("x", innerWidth / 2)
      .attr("y", innerHeight + 36).attr("text-anchor", "middle")
      .text(frame.dataset.objectives[xIndex].name);
    root.append("text").attr("class", "viz-axis-label").attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2).attr("y", -40).attr("text-anchor", "middle")
      .text(frame.dataset.objectives[yIndex].name);
    const filtered = frame.selection.filteredIds;
    root.selectAll("circle").data(candidates, (datum) => (datum as typeof candidates[number]).individual.id)
      .join("circle")
      .attr("cx", (candidate) => x(candidate.individual.objectives[xIndex]))
      .attr("cy", (candidate) => y(candidate.individual.objectives[yIndex]))
      .attr("r", (candidate) => candidate.individual.id === frame?.selection.hoveredId ? 6 : 4)
      .attr("fill", (candidate) => chartColor(candidate.individual.id, frame!.selection))
      .attr("fill-opacity", (candidate) => filtered && !filtered.has(candidate.individual.id) ? 0.12 : 0.82)
      .attr("stroke", "#09090b")
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", (_event, candidate) => callbacks.onHover?.(candidate.individual.id))
      .on("mouseleave", () => callbacks.onHover?.())
      .on("click", (_event, candidate) => callbacks.onSelect?.(candidate.individual.id))
      .append("title")
      .text((candidate) => `#${candidate.individual.id} · ${frame!.dataset.objectives[xIndex].name}: ${candidate.individual.objectives[xIndex].toFixed(4)} · ${frame!.dataset.objectives[yIndex].name}: ${candidate.individual.objectives[yIndex].toFixed(4)}`);
  }

  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); frame = undefined; },
  };
}

function paddedExtent(values: number[]): [number, number] {
  const [minimum = 0, maximum = 1] = d3.extent(values);
  if (minimum === maximum) {
    const padding = Math.abs(minimum) * 0.05 || 1;
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.06;
  return [minimum - padding, maximum + padding];
}
