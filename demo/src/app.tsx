import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Activity, Maximize2, RotateCcw, Square, Zap } from "lucide-react";
import { validateDataset } from "@genetic-assembly/visualizations";
import {
  exportScene, GeneticAssemblyClient, type ResultMember, type RunEvent,
} from "../../client/src/index.js";
import { useWorkspace } from "./app-state.js";
import { AnalyticsPane } from "./components/analytics-pane.js";
import { ProblemPicker } from "./components/problem-picker.js";
import { SceneView, type SceneHandle } from "./components/scene-view.js";
import { Badge, Button, Input, Tooltip } from "./components/ui.js";
import { defaultProblem, type OptimizationProblem } from "./problem.js";

const api = new GeneticAssemblyClient(import.meta.env.VITE_GA_SERVER_URL || "http://127.0.0.1:3001");

export function App() {
  const { state, dispatch } = useWorkspace();
  const sceneHandle = useRef<SceneHandle | undefined>(undefined);
  const activeRun = useRef<string | undefined>(undefined);
  const [selectedProblem, setSelectedProblem] = useState(defaultProblem);
  const [server, setServer] = useState<"checking" | "connected" | "unavailable">("checking");
  const [population, setPopulation] = useState(64);
  const [generations, setGenerations] = useState(50);
  const [threads, setThreads] = useState("");
  const [analyticsWidth, setAnalyticsWidth] = useState(400);
  const running = ["preparing", "queued", "running"].includes(state.runStatus);
  const onSceneReady = useCallback((handle: SceneHandle) => { sceneHandle.current = handle; }, []);
  const activeCandidate = useMemo(() => {
    const candidate = state.dataset.candidates.find((item) => item.individual.id === state.activeId) as ResultMember | undefined;
    return candidate && Array.isArray(candidate.patches) ? candidate : undefined;
  }, [state.dataset.candidates, state.activeId]);

  function selectProblem(problem: OptimizationProblem) {
    if (problem.id === selectedProblem.id || running) return;
    sceneHandle.current?.preview.revert();
    sceneHandle.current = undefined;
    setSelectedProblem(problem);
    setPopulation(problem.recommendedPopulation);
    setGenerations(problem.recommendedGenerations);
    dispatch({ type: "problem-selected", problem });
  }

  useEffect(() => {
    let live = true;
    fetch(`${api.baseUrl}/health`).then((response) => { if (!response.ok) throw new Error(); if (live) setServer("connected"); })
      .catch(() => { if (live) setServer("unavailable"); });
    return () => { live = false; };
  }, []);

  async function startRun() {
    if (!sceneHandle.current) return;
    dispatch({ type: "new-run", message: "Exporting immutable scene geometry…" });
    try {
      const exported = await exportScene(sceneHandle.current.scene, selectedProblem.sceneManifest);
      const sceneRevision = await api.uploadScene(exported.glb, exported.manifest);
      dispatch({ type: "run-status", status: "preparing", message: "Validating evaluator contract…" });
      const evaluatorRevision = await api.createEvaluator(selectedProblem.evaluatorSource, selectedProblem.evaluatorManifest);
      const run = await api.startRun(sceneRevision.id, evaluatorRevision.id, {
        population_size: validInteger(population, "Population"), generations: validInteger(generations, "Generations"),
        threads: threads.trim() ? validInteger(Number(threads), "Worker threads") : undefined, seed: 42,
      });
      activeRun.current = run.id;
      dispatch({ type: "new-run", runId: run.id, message: `Queued run ${shortId(run.id)}` });
      let eventError: string | undefined;
      await api.subscribe(run.id, (event: RunEvent) => {
        if (event.type === "generation") dispatch({ type: "generation", summary: event.summary, total: generations });
        else if (event.type === "status") dispatch({ type: "run-status", status: event.status });
        else if (event.type === "failed") { eventError = event.error; dispatch({ type: "run-status", status: "failed", message: event.error, tone: "danger" }); }
      });
      const finalRun = await api.getRun(run.id);
      if (finalRun.status === "failed") throw new Error(finalRun.error || eventError || "The solver failed without recording a reason.");
      if (finalRun.status !== "completed" && finalRun.status !== "cancelled") throw new Error(`Run stopped in unexpected state: ${finalRun.status}`);
      const analytics = await api.getAnalytics(run.id);
      validateDataset(analytics);
      dispatch({ type: "analytics", analytics });
    } catch (error) {
      dispatch({ type: "run-status", status: "failed", message: error instanceof Error ? error.message : String(error), tone: "danger" });
    } finally { activeRun.current = undefined; }
  }

  async function cancelRun() {
    if (!activeRun.current) return;
    await api.cancel(activeRun.current);
    dispatch({ type: "run-status", status: "cancelling", message: "Cancellation requested; finishing the current evaluation batch…" });
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = analyticsWidth;
    const move = (pointer: PointerEvent) => setAnalyticsWidth(Math.max(320, Math.min(600, startWidth + startX - pointer.clientX)));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }

  return <div className="app-shell" style={{ "--analytics-width": `${analyticsWidth}px` } as CSSProperties}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark">GA</div><div><div className="brand-name">Genetic Assembly</div><div className="brand-description">Rust NSGA-II · linked scene analytics</div></div></div>
      <div className="topbar-status"><span className={`status-dot ${server}`} /><span>{server === "connected" ? "Solver connected" : server === "unavailable" ? "Solver unavailable" : "Checking solver…"}</span><code>127.0.0.1:3001</code></div>
    </header>
    <main className="workspace">
      <aside className="controls-pane">
        <ProblemPicker selected={selectedProblem} disabled={running} onSelect={selectProblem} />
        <section className="control-section">
          <div className="eyebrow">Run configuration</div>
          <div className="field-grid">
            <label>Population<Input type="number" min={4} step={4} value={population} onChange={(event) => setPopulation(event.target.valueAsNumber)} /></label>
            <label>Generations<Input type="number" min={1} value={generations} onChange={(event) => setGenerations(event.target.valueAsNumber)} /></label>
            <label className="field-wide">Worker threads <small>blank uses available cores</small><Input type="number" min={1} placeholder="Auto" value={threads} onChange={(event) => setThreads(event.target.value)} /></label>
          </div>
          <div className="run-actions"><Button onClick={() => void startRun()} disabled={running}><Zap size={14} />{running ? "Running…" : "Start optimization"}</Button>{running && <Button variant="outline" onClick={() => void cancelRun()}><Square size={12} /> Cancel</Button>}</div>
        </section>
        <section className="control-section progress-section">
          <div className="section-heading compact"><div className="eyebrow">Run progress</div><Badge tone={state.runStatus}>{state.runStatus}</Badge></div>
          <div className="progress-track"><div className="progress-bar" style={{ width: `${state.progress * 100}%` }} /></div>
          <div className="status-message" data-tone={state.tone}>{state.message}</div>
          {state.runId && <code className="run-id">Run {shortId(state.runId)}</code>}
        </section>
      </aside>
      <section className="scene-pane">
        <header className="scene-toolbar"><div><div className="eyebrow">Scene preview</div><strong>{selectedProblem.sceneName}</strong></div><div className="scene-actions"><div className="legend"><span><i className="swatch movable" />Facility</span><span><i className="swatch obstacle" />Obstacle</span><span><i className="swatch target" />{selectedProblem.id === "three-anchor" ? "Anchors A–C" : "Target"}</span></div><Tooltip label="Restore the scene's original values"><Button variant="outline" onClick={() => dispatch({ type: "active" })}><RotateCcw size={13} /> Revert</Button></Tooltip><Button variant="outline" className="analytics-mobile-trigger" onClick={() => dispatch({ type: "analytics-open", open: true })}><Activity size={14} /> Analytics</Button></div></header>
        <SceneView active={activeCandidate} problem={selectedProblem} onReady={onSceneReady} />
        {state.activeId !== undefined && <div className="scene-selection"><span className="active-color" /> Previewing candidate #{state.activeId}{!activeCandidate && <small> · geometry patch available when run completes</small>}</div>}
      </section>
      <div className="resize-handle" onPointerDown={beginResize} role="separator" aria-label="Resize analytics pane" aria-orientation="vertical"><Maximize2 size={11} /></div>
      <AnalyticsPane />
    </main>
  </div>;
}

function validInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
function shortId(id: string): string { return id.slice(0, 8); }
