import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cuboid, Triangle } from "lucide-react";
import { problems, type OptimizationProblem } from "../problem.js";
import { Badge } from "./ui.js";

export function ProblemPicker({ selected, disabled, onSelect }: {
  selected: OptimizationProblem;
  disabled?: boolean;
  onSelect(problem: OptimizationProblem): void;
}) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <section ref={picker} className="control-section problem-picker" data-open={open}>
    <button className="problem-current-card" type="button" disabled={disabled} aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>
      <div className="problem-card-heading">
        <span className="problem-icon">{selected.id === "three-anchor" ? <Triangle size={15} /> : <Cuboid size={15} />}</span>
        <div><span className="eyebrow">Current problem</span><h1>{selected.name}</h1></div>
        <Badge>NSGA-II</Badge>
        <ChevronDown className="problem-chevron" size={15} />
      </div>
      <p>{selected.shortDescription}</p>
      <ProblemStats problem={selected} />
    </button>
    {open && <div className="problem-tray" aria-label="Available optimization problems">
      <div className="problem-tray-label">Choose a problem before starting the solver</div>
      {problems.map((problem) => <button key={problem.id} type="button" className="problem-option" data-selected={problem.id === selected.id}
        onClick={() => { onSelect(problem); setOpen(false); }}>
        <span className="problem-icon">{problem.id === "three-anchor" ? <Triangle size={14} /> : <Cuboid size={14} />}</span>
        <span><strong>{problem.name}</strong><small>{problem.evaluatorManifest.objectives.length} objectives · {problem.sceneManifest.levers.length} levers</small></span>
        {problem.id === selected.id && <Check size={14} />}
      </button>)}
    </div>}
  </section>;
}

function ProblemStats({ problem }: { problem: OptimizationProblem }) {
  return <div className="problem-stats">
    <span><strong>{problem.sceneManifest.levers.length}</strong> levers</span>
    <span><strong>{problem.evaluatorManifest.objectives.length}</strong> objectives</span>
    <span><strong>{problem.evaluatorManifest.constraints?.length ?? 0}</strong> constraints</span>
  </div>;
}
