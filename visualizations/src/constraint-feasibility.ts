import * as d3 from "d3";
import { isConstraintFeasible, selectedCandidates } from "./normalization.js";
import { CHART_COLORS, dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationController, VisualizationFrame } from "./types.js";

export function createConstraintFeasibility(container: HTMLElement): VisualizationController {
  let frame: VisualizationFrame | undefined;
  function render(): void {
    if (!frame || frame.dataset.constraints.length === 0) {
      emptyMessage(container, "This problem has no constraints.");
      return;
    }
    const candidates = selectedCandidates(
      frame.dataset,
      [frame.selection.activeId, ...frame.selection.pinnedIds],
    );
    if (candidates.length === 0) {
      emptyMessage(container, "Select or pin candidates to inspect feasibility.");
      return;
    }
    const { width, height } = dimensions(container);
    const margin = { top: 16, right: 16, bottom: 38, left: 44 };
    const values = candidates.flatMap((candidate) => candidate.individual.constraints);
    const extent = d3.extent([...values, 0]) as [number, number];
    const padding = (extent[1] - extent[0]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([extent[0] - padding, extent[1] + padding]).nice()
      .range([height - margin.bottom, margin.top]);
    const x = d3.scaleBand<number>().domain(frame.dataset.constraints.map((item) => item.index))
      .range([margin.left, width - margin.right]).padding(0.25);
    const inner = d3.scaleBand<number>().domain(candidates.map((item) => item.individual.id))
      .range([0, x.bandwidth()]).padding(0.1);
    const svg = replaceSvg(container, "Constraint feasibility chart")
      .attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4));
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickFormat((index) => frame!.dataset.constraints[index].name));
    svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right)
      .attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#f87171").attr("stroke-dasharray", "4 4");
    frame.dataset.constraints.forEach((constraint) => {
      candidates.forEach((candidate) => {
        const value = candidate.individual.constraints[constraint.index] ?? 0;
        const pinnedIndex = frame!.selection.pinnedIds.indexOf(candidate.individual.id);
        const color = pinnedIndex >= 0 ? CHART_COLORS[pinnedIndex] : "#fafafa";
        svg.append("rect")
          .attr("x", (x(constraint.index) ?? 0) + (inner(candidate.individual.id) ?? 0))
          .attr("width", inner.bandwidth()).attr("y", Math.min(y(0), y(value)))
          .attr("height", Math.max(1, Math.abs(y(value) - y(0))))
          .attr("fill", color).attr("fill-opacity", isConstraintFeasible(value) ? 0.78 : 0.35)
          .append("title").text(`#${candidate.individual.id}: ${value.toFixed(4)}`);
      });
    });
  }
  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); frame = undefined; },
  };
}
