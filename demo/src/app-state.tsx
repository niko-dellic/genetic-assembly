import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { GenerationAnalytics, RunAnalytics } from "../../client/src/index.js";
import type { OptimizationDataset } from "@genetic-assembly/visualizations";
import { evaluatorManifest, sceneManifest } from "./problem.js";

export interface WorkspaceState {
  dataset: OptimizationDataset;
  runId?: string;
  runStatus: string;
  progress: number;
  message: string;
  tone: "neutral" | "success" | "danger";
  hoveredId?: number;
  activeId?: number;
  pinnedIds: number[];
  filteredIds?: Set<number>;
  pinNotice?: string;
  analyticsOpen: boolean;
}

type Action =
  | { type: "new-run"; runId?: string; message?: string }
  | { type: "run-status"; status: string; progress?: number; message?: string; tone?: WorkspaceState["tone"] }
  | { type: "generation"; summary: GenerationAnalytics; total: number }
  | { type: "analytics"; analytics: RunAnalytics }
  | { type: "hover"; id?: number }
  | { type: "active"; id?: number }
  | { type: "pin"; id: number }
  | { type: "filter"; ids?: Set<number> }
  | { type: "analytics-open"; open: boolean };

function baseDataset(): OptimizationDataset {
  return {
    objectives: evaluatorManifest.objectives.map((objective, index) => ({ ...objective, index })),
    levers: sceneManifest.levers.map((lever, index) => ({ ...lever, index })),
    constraints: (evaluatorManifest.constraints ?? []).map((constraint, index) => ({ ...constraint, index, feasible_when: "lte_zero" })),
    candidates: [], generations: [], history_complete: true,
  };
}

const initialState: WorkspaceState = {
  dataset: baseDataset(), runStatus: "idle", progress: 0,
  message: "Ready to start a server-side optimization.", tone: "neutral",
  pinnedIds: [], analyticsOpen: false,
};

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "new-run": return { ...initialState, dataset: baseDataset(), runId: action.runId, runStatus: action.runId ? "queued" : "preparing", message: action.message ?? "Preparing run…" };
    case "run-status": return { ...state, runStatus: action.status, progress: action.progress ?? state.progress, message: action.message ?? state.message, tone: action.tone ?? state.tone };
    case "generation": return {
      ...state, runStatus: "running", progress: Math.min(1, action.summary.generation / action.total),
      message: `${action.summary.pareto_size} Pareto candidates · ${action.summary.evaluations} evaluations`,
      dataset: {
        ...state.dataset,
        candidates: action.summary.sampled_front.map((individual) => ({ individual })),
        generations: [...state.dataset.generations.filter((item) => item.generation !== action.summary.generation), action.summary]
          .sort((left, right) => left.generation - right.generation),
      },
    };
    case "analytics": return {
      ...state, runStatus: action.analytics.status, progress: 1,
      dataset: action.analytics,
      message: `${action.analytics.candidates.length} final Pareto candidates available.`, tone: "success",
    };
    case "hover": return { ...state, hoveredId: action.id };
    case "active": return { ...state, activeId: action.id };
    case "pin": {
      if (state.pinnedIds.includes(action.id)) return { ...state, pinnedIds: state.pinnedIds.filter((id) => id !== action.id), pinNotice: undefined };
      if (state.pinnedIds.length >= 3) return { ...state, pinNotice: "Three candidates are already pinned. Unpin one first." };
      return { ...state, pinnedIds: [...state.pinnedIds, action.id], pinNotice: undefined };
    }
    case "filter": return { ...state, filteredIds: action.ids };
    case "analytics-open": return { ...state, analyticsOpen: action.open };
  }
}

const WorkspaceContext = createContext<{ state: WorkspaceState; dispatch: Dispatch<Action> } | undefined>(undefined);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
