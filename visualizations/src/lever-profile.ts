import * as d3 from "d3";
import { normalizedLeverValue, selectedCandidates } from "./normalization.js";
import { CHART_COLORS, dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationController, VisualizationFrame } from "./types.js";

export function createLeverProfile(container: HTMLElement): VisualizationController {
  let frame: VisualizationFrame | undefined;
  function render(): void {
    if (!frame || frame.dataset.levers.length === 0) {
      emptyMessage(container, "No geometry levers are available.");
      return;
    }
    const candidates = selectedCandidates(
      frame.dataset,
      [frame.selection.activeId, ...frame.selection.pinnedIds],
    );
    if (candidates.length === 0) {
      emptyMessage(container, "Select or pin candidates to compare lever values.");
      return;
    }
    const { width, height } = dimensions(container);
    const margin = { top: 12, right: 16, bottom: 34, left: 28 };
    const x = d3.scalePoint<number>().domain(frame.dataset.levers.map((lever) => lever.index))
      .range([margin.left, width - margin.right]).padding(0.35);
    const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);
    const svg = replaceSvg(container, "Normalized geometry lever profile")
      .attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4));
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickFormat((index) => frame!.dataset.levers[index].id));
    const line = d3.line<number>()
      .x((_, index) => x(frame!.dataset.levers[index].index) ?? 0)
      .y((value) => y(value));
    candidates.forEach((candidate) => {
      const values = frame!.dataset.levers.map((lever, index) =>
        normalizedLeverValue(candidate.individual.genes[index], lever));
      const pinnedIndex = frame!.selection.pinnedIds.indexOf(candidate.individual.id);
      const color = pinnedIndex >= 0 ? CHART_COLORS[pinnedIndex] : "#fafafa";
      svg.append("path").datum(values).attr("d", line).attr("fill", "none")
        .attr("stroke", color).attr("stroke-width", 2);
      svg.selectAll(`.lever-${candidate.individual.id}`).data(values).join("circle")
        .attr("cx", (_, index) => x(frame!.dataset.levers[index].index) ?? 0)
        .attr("cy", (value) => y(value)).attr("r", 3).attr("fill", color);
    });
  }
  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); frame = undefined; },
  };
}
