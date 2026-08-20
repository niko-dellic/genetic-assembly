import * as d3 from "d3";
import { directionalPercentiles, selectedCandidates } from "./normalization.js";
import { CHART_COLORS, dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationController, VisualizationFrame } from "./types.js";

export function createDiamondFitness(container: HTMLElement): VisualizationController {
  let frame: VisualizationFrame | undefined;

  function render(): void {
    if (!frame || frame.dataset.objectives.length === 0) {
      emptyMessage(container, "Select a candidate to inspect fitness.");
      return;
    }
    const ids = [frame.selection.activeId, ...frame.selection.pinnedIds];
    const candidates = selectedCandidates(frame.dataset, ids);
    if (candidates.length === 0) {
      emptyMessage(container, "Select or pin candidates to compare fitness.");
      return;
    }
    const { width, height } = dimensions(container);
    const center: [number, number] = [width / 2, height / 2];
    const radius = Math.max(45, Math.min(width, height) * 0.33);
    const objectives = frame.dataset.objectives;
    const axisIndexes = objectives.length === 2 ? [0, 1, 0, 1] : objectives.map((objective) => objective.index);
    const angle = (index: number) => -Math.PI / 2 + index * Math.PI * 2 / axisIndexes.length;
    const point = (index: number, value: number): [number, number] => [
      center[0] + Math.cos(angle(index)) * radius * value,
      center[1] + Math.sin(angle(index)) * radius * value,
    ];
    const ranks = objectives.map((objective) =>
      directionalPercentiles(frame!.dataset.candidates, objective.index, objective.direction));
    const svg = replaceSvg(container, "Directional percentile diamond fitness chart")
      .attr("viewBox", `0 0 ${width} ${height}`);
    const line = d3.line<[number, number]>().curve(d3.curveLinearClosed);
    for (const level of [0.25, 0.5, 0.75, 1]) {
      svg.append("path").attr("d", line(axisIndexes.map((_, index) => point(index, level))))
        .attr("class", "viz-grid-shape");
    }
    axisIndexes.forEach((objectiveIndex, index) => {
      const [x, y] = point(index, 1);
      svg.append("line").attr("x1", center[0]).attr("y1", center[1]).attr("x2", x).attr("y2", y)
        .attr("class", "viz-grid-line");
      if (objectives.length !== 2 || index < 2) {
        const labelPoint = point(index, 1.14);
        svg.append("text").attr("x", labelPoint[0]).attr("y", labelPoint[1])
          .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .attr("class", "viz-axis-label").text(objectives[objectiveIndex].name);
      }
    });
    candidates.forEach((candidate, candidateIndex) => {
      const points = axisIndexes.map((objectiveIndex, index) =>
        point(index, ranks[objectiveIndex].get(candidate.individual.id) ?? 0.5));
      const pinnedIndex = frame!.selection.pinnedIds.indexOf(candidate.individual.id);
      const color = pinnedIndex >= 0 ? CHART_COLORS[pinnedIndex] : "#fafafa";
      svg.append("path").attr("d", line(points)).attr("fill", color).attr("fill-opacity", 0.08)
        .attr("stroke", color).attr("stroke-width", candidateIndex === 0 ? 2.2 : 1.7);
    });
  }

  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); frame = undefined; },
  };
}
