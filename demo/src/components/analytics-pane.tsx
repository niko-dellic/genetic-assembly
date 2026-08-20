import { useMemo, useState } from "react";
import { BarChart3, History, Pin, ScanSearch, X } from "lucide-react";
import {
  createConstraintFeasibility, createConvergenceHistory, createDiamondFitness, createGenerationCounts,
  createLeverProfile, createParallelCoordinates, createParetoScatter, createParetoSpace3d,
  type VisualizationCallbacks, type VisualizationFrame,
} from "@genetic-assembly/visualizations";
import { useWorkspace } from "../app-state.js";
import { CandidateDrawer } from "./candidate-drawer.js";
import { Chart } from "./chart.js";
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from "./ui.js";

export function AnalyticsPane() {
  const { state, dispatch } = useWorkspace();
  const [xObjective, setXObjective] = useState(0);
  const [yObjective, setYObjective] = useState(1);
  const frame = useMemo<VisualizationFrame>(() => ({
    dataset: state.dataset,
    selection: { activeId: state.activeId, hoveredId: state.hoveredId, pinnedIds: state.pinnedIds, filteredIds: state.filteredIds },
    xObjective, yObjective,
  }), [state.dataset, state.activeId, state.hoveredId, state.pinnedIds, state.filteredIds, xObjective, yObjective]);
  const callbacks = useMemo<VisualizationCallbacks>(() => ({
    onHover: (id) => dispatch({ type: "hover", id }),
    onSelect: (id) => dispatch({ type: "active", id }),
    onFilter: (ids) => dispatch({ type: "filter", ids }),
  }), [dispatch]);
  const active = state.dataset.candidates.find((candidate) => candidate.individual.id === state.activeId);

  return <aside className="analytics-pane" data-open={state.analyticsOpen}>
    <header className="analytics-header">
      <div><div className="eyebrow">Linked analytics</div><h2>Run inspector</h2></div>
      <div className="analytics-actions"><Badge tone={state.runStatus}>{state.dataset.candidates.length} candidates</Badge><CandidateDrawer /><Button variant="ghost" className="mobile-close" onClick={() => dispatch({ type: "analytics-open", open: false })} aria-label="Close analytics"><X size={16} /></Button></div>
    </header>
    <Tabs className="analytics-tabs" defaultValue="explore">
      <TabsList className="tabs-list">
        <TabsTrigger value="explore"><ScanSearch size={14} /> Explore</TabsTrigger>
        <TabsTrigger value="compare"><BarChart3 size={14} /> Compare</TabsTrigger>
        <TabsTrigger value="history"><History size={14} /> History</TabsTrigger>
      </TabsList>
      <div className="analytics-scroll">
        <TabsContent value="explore" className="tab-content">
          <ChartCard title={state.dataset.objectives.length === 3 ? "Objective space" : "Pareto projection"} meta="Click to preview · hover to link">
            {state.dataset.objectives.length > 3 && <div className="projection-controls">
              <label>X <select value={xObjective} onChange={(event) => setXObjective(Number(event.target.value))}>{state.dataset.objectives.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}</select></label>
              <label>Y <select value={yObjective} onChange={(event) => setYObjective(Number(event.target.value))}>{state.dataset.objectives.map((item) => <option key={item.index} value={item.index}>{item.name}</option>)}</select></label>
            </div>}
            <Chart create={state.dataset.objectives.length === 3 ? createParetoSpace3d : createParetoScatter} frame={frame} callbacks={callbacks} className="chart chart-large" />
          </ChartCard>
          <ChartCard title="Parallel coordinates" meta="Brush any axis to filter every view">
            <Chart create={createParallelCoordinates} frame={frame} callbacks={callbacks} className="chart chart-large" />
          </ChartCard>
        </TabsContent>
        <TabsContent value="compare" className="tab-content">
          <SelectionSummary activeId={state.activeId} pinnedIds={state.pinnedIds} onPin={(id) => dispatch({ type: "pin", id })} />
          {state.pinNotice && <div className="notice">{state.pinNotice}</div>}
          <ChartCard title="Diamond fitness" meta="Worst at center · best at edge · raw values on hover">
            <Chart create={createDiamondFitness} frame={frame} className="chart chart-medium" />
          </ChartCard>
          <ChartCard title="Lever profile" meta="Normalized to declared variable bounds">
            <Chart create={createLeverProfile} frame={frame} className="chart chart-medium" />
          </ChartCard>
          <ChartCard title="Constraint feasibility" meta="Values at or below zero are feasible">
            <Chart create={createConstraintFeasibility} frame={frame} className="chart chart-small" />
          </ChartCard>
          {active && <div className="raw-values"><span>Selected #{active.individual.id}</span><code>{active.individual.objectives.map((value) => value.toFixed(4)).join(" · ")}</code></div>}
        </TabsContent>
        <TabsContent value="history" className="tab-content">
          {!state.dataset.history_complete && <div className="notice">This run predates full-population summaries. History is unavailable rather than estimated from sampled candidates.</div>}
          <ChartCard title="Objective convergence" meta="Mean · standard-deviation band · min/max population envelope">
            <Chart create={createConvergenceHistory} frame={frame} className="chart chart-large" />
          </ChartCard>
          <ChartCard title="Population composition" meta="Pareto, feasible, and infeasible counts by generation">
            <Chart create={createGenerationCounts} frame={frame} className="chart chart-medium" />
          </ChartCard>
        </TabsContent>
      </div>
    </Tabs>
  </aside>;
}

function ChartCard({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return <section className="chart-card"><header><h3>{title}</h3><span>{meta}</span></header>{children}</section>;
}

function SelectionSummary({ activeId, pinnedIds, onPin }: { activeId?: number; pinnedIds: number[]; onPin(id: number): void }) {
  return <div className="selection-summary"><div><span className="eyebrow">Active candidate</span><strong>{activeId === undefined ? "Select from a chart" : `#${activeId}`}</strong></div>
    {activeId !== undefined && <Button variant="outline" onClick={() => onPin(activeId)}><Pin size={13} /> {pinnedIds.includes(activeId) ? "Unpin" : "Pin"}</Button>}
    <div className="pin-row">{pinnedIds.length === 0 ? <span>No pinned comparisons</span> : pinnedIds.map((id, index) => <button key={id} className={`pin-chip pin-${index}`} onClick={() => onPin(id)}>#{id} <X size={11} /></button>)}</div>
  </div>;
}
