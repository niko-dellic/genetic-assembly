import * as d3 from "d3";
import type { SelectionState } from "./types.js";

export const CHART_COLORS = ["#2dd4bf", "#f59e0b", "#a78bfa"];

export function dimensions(container: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(240, container.clientWidth || 320),
    height: Math.max(180, container.clientHeight || 240),
  };
}

export function chartColor(id: number, selection: SelectionState): string {
  const pinned = selection.pinnedIds.indexOf(id);
  if (pinned >= 0) return CHART_COLORS[pinned % CHART_COLORS.length];
  if (selection.activeId === id) return "#fafafa";
  return "#71717a";
}

export function replaceSvg(container: HTMLElement, label: string) {
  d3.select(container).selectAll("*").remove();
  return d3
    .select(container)
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("role", "img")
    .attr("aria-label", label);
}

export function emptyMessage(container: HTMLElement, message: string): void {
  d3.select(container).selectAll("*").remove();
  d3.select(container).append("div").attr("class", "viz-empty").text(message);
}
