import * as d3 from "d3";
import { chartColor, dimensions, emptyMessage, replaceSvg } from "./svg.js";
import type { VisualizationCallbacks, VisualizationController, VisualizationFrame, VizCandidate } from "./types.js";

interface Dimension {
  key: string;
  label: string;
  value(candidate: VizCandidate): number;
}

export function createParallelCoordinates(
  container: HTMLElement,
  callbacks: VisualizationCallbacks = {},
): VisualizationController {
  let frame: VisualizationFrame | undefined;
  const ranges = new Map<string, [number, number]>();

  function render(): void {
    if (!frame || frame.dataset.candidates.length === 0) {
      emptyMessage(container, "Candidate data is required for parallel coordinates.");
      return;
    }
    const dimensionsList: Dimension[] = [
      ...frame.dataset.objectives.map((objective) => ({
        key: `objective-${objective.index}`,
        label: objective.name,
        value: (candidate: VizCandidate) => candidate.individual.objectives[objective.index],
      })),
      ...frame.dataset.constraints.map((constraint) => ({
        key: `constraint-${constraint.index}`,
        label: constraint.name,
        value: (candidate: VizCandidate) => candidate.individual.constraints[constraint.index] ?? 0,
      })),
      ...frame.dataset.levers.map((lever) => ({
        key: `lever-${lever.index}`,
        label: lever.id,
        value: (candidate: VizCandidate) => candidate.individual.genes[lever.index],
      })),
    ];
    if (dimensionsList.length < 2) {
      emptyMessage(container, "At least two dimensions are required.");
      return;
    }
    const { width, height } = dimensions(container);
    const margin = { top: 28, right: 22, bottom: 18, left: 22 };
    const x = d3.scalePoint<string>().domain(dimensionsList.map((item) => item.key))
      .range([margin.left, width - margin.right]).padding(0.2);
    const y = new Map(dimensionsList.map((dimension) => {
      const extent = d3.extent(frame!.dataset.candidates, dimension.value) as [number, number];
      const domain: [number, number] = extent[0] === extent[1]
        ? [extent[0] - 1, extent[1] + 1]
        : extent;
      return [dimension.key, d3.scaleLinear().domain(domain).nice().range([height - margin.bottom, margin.top])];
    }));
    const svg = replaceSvg(container, "Parallel coordinates for objectives, constraints, and levers")
      .attr("viewBox", `0 0 ${width} ${height}`);
    const path = (candidate: VizCandidate) => d3.line<[number, number]>()(
      dimensionsList.map((dimension) => [
        x(dimension.key) ?? 0,
        y.get(dimension.key)!(dimension.value(candidate)),
      ]),
    );
    const filtered = frame.selection.filteredIds;
    svg.append("g").selectAll("path").data(frame.dataset.candidates)
      .join("path").attr("d", path).attr("fill", "none")
      .attr("stroke", (candidate) => chartColor(candidate.individual.id, frame!.selection))
      .attr("stroke-width", (candidate) => candidate.individual.id === frame?.selection.hoveredId ? 2.6 : 1)
      .attr("stroke-opacity", (candidate) => filtered && !filtered.has(candidate.individual.id) ? 0.03 : 0.24)
      .style("cursor", "pointer")
      .on("mouseenter", (_event, candidate) => callbacks.onHover?.(candidate.individual.id))
      .on("mouseleave", () => callbacks.onHover?.())
      .on("click", (_event, candidate) => callbacks.onSelect?.(candidate.individual.id));
    const axes = svg.append("g").selectAll("g").data(dimensionsList).join("g")
      .attr("transform", (dimension) => `translate(${x(dimension.key)},0)`);
    axes.each(function (dimension) {
      d3.select(this as SVGGElement).call(d3.axisLeft(y.get(dimension.key)!).ticks(4));
    });
    axes.append("text").attr("class", "viz-axis-label").attr("y", 14)
      .attr("text-anchor", "middle").text((dimension) => dimension.label);
    axes.append("g").attr("class", "viz-brush").each(function (dimension) {
      const scale = y.get(dimension.key)!;
      const brush = d3.brushY<unknown>().extent([[-8, margin.top], [8, height - margin.bottom]])
        .on("end", (event) => {
          if (!event.selection) ranges.delete(dimension.key);
          else {
            const [top, bottom] = event.selection as [number, number];
            ranges.set(dimension.key, [scale.invert(bottom), scale.invert(top)]);
          }
          if (ranges.size === 0) callbacks.onFilter?.();
          else {
            const ids = new Set(frame!.dataset.candidates.filter((candidate) =>
              dimensionsList.every((item) => {
                const range = ranges.get(item.key);
                const value = item.value(candidate);
                return !range || (value >= range[0] && value <= range[1]);
              })).map((candidate) => candidate.individual.id));
            callbacks.onFilter?.(ids);
          }
        });
      const brushGroup = d3.select(this as SVGGElement);
      brushGroup.call(brush);
      const range = ranges.get(dimension.key);
      if (range) brushGroup.call(brush.move, [scale(range[1]), scale(range[0])]);
    });
  }

  return {
    update(next) { frame = next; render(); },
    resize() { render(); },
    destroy() { d3.select(container).selectAll("*").remove(); ranges.clear(); frame = undefined; },
  };
}
