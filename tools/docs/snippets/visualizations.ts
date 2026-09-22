import { createParetoScatter, createConvergenceHistory, validateDataset, type OptimizationDataset, type SelectionState } from '@genetic-assembly/visualizations';
export function renderResults(scatterElement: HTMLElement, historyElement: HTMLElement, dataset: OptimizationDataset) {
  validateDataset(dataset);
  const selection: SelectionState = { pinnedIds: [] };
  const scatter = createParetoScatter(scatterElement, { onSelect(id) { selection.activeId = id; update(); } });
  const history = createConvergenceHistory(historyElement);
  function update() { for (const chart of [scatter, history]) chart.update({ dataset, selection }); }
  const observer = new ResizeObserver(() => { scatter.resize(); history.resize(); });
  observer.observe(scatterElement); observer.observe(historyElement); update();
  return () => { observer.disconnect(); scatter.destroy(); history.destroy(); };
}
