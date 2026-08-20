import { useEffect, useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ListFilter, Pin, X } from "lucide-react";
import type { VizCandidate } from "@genetic-assembly/visualizations";
import { useWorkspace } from "../app-state.js";
import { Button, Dialog, DialogClose, DialogContent, DialogTrigger, Input } from "./ui.js";

const column = createColumnHelper<VizCandidate>();

export function CandidateDrawer() {
  const { state, dispatch } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo(() => [
    column.accessor((candidate) => candidate.individual.id, { id: "id", header: "Candidate", cell: (info) => `#${info.getValue()}` }),
    ...state.dataset.objectives.map((objective) => column.accessor((candidate) => candidate.individual.objectives[objective.index], {
      id: `objective-${objective.index}`, header: objective.name, cell: (info) => Number(info.getValue()).toFixed(3),
    })),
    column.accessor((candidate) => candidate.individual.constraint_violation, { id: "violation", header: "Violation", cell: (info) => info.getValue().toFixed(3) }),
  ], [state.dataset.objectives]);
  const table = useReactTable({
    data: state.dataset.candidates, columns, state: { sorting, globalFilter: query },
    onSortingChange: setSorting, onGlobalFilterChange: setQuery,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, value) => `candidate ${row.original.individual.id}`.includes(String(value).toLowerCase()),
  });
  const scroll = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 42, overscan: 8 });
  useEffect(() => {
    if (!open) return;
    const animation = requestAnimationFrame(() => virtual.measure());
    return () => cancelAnimationFrame(animation);
  }, [open, rows.length, virtual]);

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline"><ListFilter size={14} /> Browse all <span className="button-count">{state.dataset.candidates.length}</span></Button></DialogTrigger>
    <DialogContent title="Candidate browser">
      <div className="drawer-toolbar">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidate ID…" aria-label="Search candidates" />
        <DialogClose asChild><Button variant="ghost" aria-label="Close candidate browser"><X size={16} /></Button></DialogClose>
      </div>
      <div className="table-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(110px, 1fr)) 56px` }}>
        {table.getHeaderGroups()[0]?.headers.map((header) => <button key={header.id} onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === "asc" ? " ↑" : header.column.getIsSorted() === "desc" ? " ↓" : ""}</button>)}
        <span />
      </div>
      <div className="candidate-table" ref={scroll}>
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            const id = row.original.individual.id;
            return <div key={row.id} className="table-row" style={{ transform: `translateY(${item.start}px)`, gridTemplateColumns: `repeat(${columns.length}, minmax(110px, 1fr)) 56px` }}
              data-active={id === state.activeId} onMouseEnter={() => dispatch({ type: "hover", id })} onMouseLeave={() => dispatch({ type: "hover" })} onClick={() => dispatch({ type: "active", id })}>
              {row.getVisibleCells().map((cell) => <span key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>)}
              <button className="icon-button" aria-label={`Pin candidate ${id}`} onClick={(event) => { event.stopPropagation(); dispatch({ type: "pin", id }); }} data-pinned={state.pinnedIds.includes(id)}><Pin size={13} /></button>
            </div>;
          })}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
