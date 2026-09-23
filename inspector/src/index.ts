import type {InspectorProvider} from "./providers.js";
export {ArchiveInspectorProvider, LocalInspectorProvider, type InspectorProvider} from "./providers.js";
import {
  StudyClient,
  type PreparedStudy,
  type EvaluationRecord,
  type Decisions,
} from "@genetic-assembly/sdk";
export interface InspectorOptions {
  provider?: InspectorProvider;
  baseUrl?: string;
  token?: string;
  onPreview?: (decisions: Decisions, study: PreparedStudy) => void;
  onExport?: (value: unknown) => void;
  onReplay?: (dataset: unknown) => void;
}
/** Mount a domain-neutral local study browser; dispose stops polling and releases the DOM. */
export function mountInspector(
  container: HTMLElement,
  options: InspectorOptions = {},
) {
  const api: InspectorProvider = options.provider ?? new StudyClient(
    options.baseUrl ?? location.origin,
    options.token,
  );
  let disposed = false;
  let study: PreparedStudy | undefined;
  let runId = "";
  let isJob = false;
  let selected: EvaluationRecord | undefined;
  let replayView: { dispose(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  container.innerHTML = `<style>
 .ga-inspector{font:15px/1.5 system-ui;background:#101315;color:#e7eded;min-height:100vh;padding:32px;box-sizing:border-box}.ga-inspector *{box-sizing:border-box}.ga-inspector h1{font-size:28px;margin:0}.ga-inspector h2{font-size:19px}.ga-inspector button,.ga-inspector select,.ga-inspector input{background:#22292c;color:inherit;border:1px solid #485558;border-radius:6px;padding:8px;margin:4px}.ga-inspector button{cursor:pointer}.ga-inspector button:disabled{opacity:.4}.ga-inspector table{width:100%;border-collapse:collapse}.ga-inspector td,.ga-inspector th{text-align:left;padding:9px;border-bottom:1px solid #394346}.ga-inspector pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#191f21;padding:16px}.ga-inspector .muted{color:#afbdc1}.ga-inspector .error{color:#ff9b92}.ga-inspector .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ga-inspector .panel{margin:20px 0;border:1px solid #394346;padding:16px;border-radius:8px;overflow:auto}.ga-inspector svg{width:100%;max-width:700px;height:260px}.ga-inspector a{color:#acdcce}@media(max-width:600px){.ga-inspector{padding:12px}.ga-inspector table{font-size:12px}}
 </style><main class="ga-inspector"><h1>Genetic Assembly</h1><p class="muted">Studies · measurements · trade-offs · replay</p><div role="alert" class="error"></div><div class="row"><label>Study <select data-studies></select></label><button data-refresh>Refresh</button><button data-baseline>Run baseline</button><button data-run>Optimize</button></div><p data-description></p><section class="panel"><h2>Experiments</h2><div data-runs></div></section><section class="panel"><h2>Baselines and replay jobs</h2><div data-jobs></div></section><section class="panel"><h2>Measurements</h2><p class="muted">Search and validation use separate seed sets. A missing replay is not missing measurement data.</p><div class="row"><label>Phase <select data-phase><option value="">All phases</option><option>search</option><option>validation</option><option>baseline</option><option>replay</option></select></label><button data-next>Next measurements</button><button data-reset>First page</button><button data-cancel>Cancel selected run</button></div><div data-chart></div><div data-history></div></section><section class="panel"><h2>Selected candidate</h2><div class="row"><button data-preview>Preview in application</button><button data-replay>Generate replay</button><button data-export>Export design and provenance</button></div><div data-comparison></div><pre data-selected>Select a measured candidate.</pre></section><section class="panel"><h2>Fronts and validation</h2><div data-results></div></section><section class="panel"><h2>Stored replay datasets</h2><div data-datasets></div></section></main>`;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    container.querySelector<T>(selector)!;
  function error(e: unknown) {
    if (!disposed) find("[role=alert]").textContent = String(e);
  }
  function button(label: string, action: () => unknown) {
    const element = document.createElement("button");
    element.textContent = label;
    if (label === "Open replay" && api.resourceFetch && !options.onReplay) { element.disabled = true; element.title = "Provide an application replay viewer through onReplay"; }
    element.onclick = () => {
      Promise.resolve().then(action).catch(error);
    };
    return element;
  }
  const text = (element: HTMLElement, value: unknown) => {
    element.textContent =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
  };
  let offset = 0,
    next: number | null = null;
  async function loadStudies() {
    const page = await api.studies();
    if (disposed) return;
    const select = find<HTMLSelectElement>("[data-studies]");
    select.replaceChildren();
    for (const item of page.items) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.spec.name} · ${item.spec.version} · ${item.id.slice(0, 8)}`;
      select.append(option);
    }
    if (!page.items.length) {
      text(
        find("[data-description]"),
        "No studies yet. Run ga up from a project to prepare one.",
      );
      return;
    }
    study = page.items.find((s) => s.id === study?.id) ?? page.items[0];
    select.value = study.id;
    await loadStudy();
  }
  async function loadStudy() {
    if (!study) return;
    text(
      find("[data-description]"),
      `${study.spec.name} · Search seeds: ${study.spec.searchSeeds.join(", ")} · Validation seeds: ${study.spec.validationSeeds.join(", ")}`,
    );
    await refreshRuns();
  }
  async function refreshRuns() {
    if (!study || disposed) return;
    const [runs, jobs] = await Promise.all([
      api.runs(study.id),
      api.jobs(study.id),
    ]);
    if (disposed) return;
    const target = find("[data-runs]");
    target.replaceChildren();
    if (!runs.items.length)
      text(
        target,
        "No optimization runs. Start with a baseline, then optimize.",
      );
    for (const run of runs.items)
      target.append(
        button(
          `${run.status} · generation ${run.current_generation} · ${run.id.slice(0, 8)}`,
          () => inspect(run.id),
        ),
      );
    const jobTarget = find("[data-jobs]");
    jobTarget.replaceChildren();
    if (!jobs.items.length) text(jobTarget, "No baseline or replay jobs yet.");
    for (const job of jobs.items) {
      jobTarget.append(
        button(`${job.kind} · ${job.status} · ${job.id.slice(0, 8)}`, () =>
          inspect(job.id, true),
        ),
      );
      if (job.error) {
        const p = document.createElement("p");
        p.textContent = job.error;
        jobTarget.append(p);
      }
    }
    if (runId) await loadHistory();
    if (!disposed) timer = setTimeout(() => refreshRuns().catch(error), 1500);
  }
  async function inspect(id: string, job = false) {
    runId = id;
    isJob = job;
    offset = 0;
    find("[role=alert]").textContent = "";
    await loadHistory();
    const datasets = await api.datasets(id);
    const target = find("[data-datasets]");
    target.replaceChildren();
    if (!datasets.length)
      text(
        target,
        "Replay unavailable. Select a completed candidate and generate a replay.",
      );
    for (const dataset of datasets) {
      const p = document.createElement("p");
      p.textContent = `Candidate ${dataset.candidateId} · seed ${dataset.seed} · `;
      const a = document.createElement("a");
      a.href = api.datasetUrl(dataset.id) + dataset.manifestKey;
      a.textContent = "Open dataset manifest";
      a.target = "_blank";
      if (api.resourceFetch) {
        a.textContent = "Download dataset manifest";
        a.onclick = event => {
          event.preventDefault();
          api.resourceFetch!(a.href).then(response => response.blob()).then(blob => {
            const url = URL.createObjectURL(blob), download = document.createElement("a");
            download.href = url; download.download = "manifest.json"; download.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }).catch(error);
        };
      }
      p.append(a);
      p.append(
        button("Open replay", async () => {
          if (options.onReplay) return options.onReplay(dataset);
          replayView?.dispose();
          const viewer = document.createElement("div");
          target.append(viewer);
          if (api.resourceFetch) throw Error("Provide onReplay to open this dataset with your application’s replay viewer.");
          const module = await import(
            /* @vite-ignore */ api.baseUrl + "/grabm.js"
          );
          replayView = await module.mountGrabmReplay(
            viewer,
            api.datasetUrl(dataset.id),
            dataset,
            (input: RequestInfo | URL, init: RequestInit = {}) => {
              const headers = new Headers(init.headers);
              if (options.token)
                headers.set("authorization", `Bearer ${options.token}`);
              return (api.resourceFetch ?? fetch)(input, { ...init, headers });
            },
          );
        }),
      );
      target.append(p);
    }
    if (!job) {
      const status = await api.runHandle(id).status();
      if (!["completed", "cancelled"].includes(status.status)) {
        text(
          find("[data-results]"),
          status.status === "failed"
            ? `Run failed: ${status.error ?? "Inspect evaluation failures for details."}`
            : `Run ${status.status}: results will appear after completion.`,
        );
        return;
      }
      const result = await api.runHandle(id).results();
      text(
        find("[data-results]"),
        `Search front: ${((result.search as any).members ?? []).length} candidates. Validated front: ${result.validated.length} candidates. Validation is based only on fully evaluated finalists.`,
      );
    } else
      text(
        find("[data-results]"),
        "Baseline/replay job: use the per-seed measurements above.",
      );
  }
  async function loadHistory() {
    if (!runId) return;
    const phase = find<HTMLSelectElement>("[data-phase]").value;
    const page = await api.history(runId, {
      offset,
      ...(phase ? { phase } : {}),
    });
    next = page.nextOffset;
    find<HTMLButtonElement>("[data-next]").disabled = next === null;
    const host = find("[data-history]");
    host.replaceChildren();
    if (!page.items.length) {
      text(host, "No measurements for this selection yet.");
      find("[data-chart]").replaceChildren();
      return;
    }
    const table = document.createElement("table");
    const header = table.insertRow();
    for (const value of [
      "Candidate",
      "Phase / seed",
      "Status",
      "Measurements",
      "Constraints",
    ]) {
      const th = document.createElement("th");
      th.textContent = value;
      header.append(th);
    }
    for (const row of page.items) {
      const tr = table.insertRow();
      tr.insertCell().append(button(row.candidateId, () => select(row)));
      for (const value of [
        `${row.phase} / ${row.seed}`,
        row.status,
        JSON.stringify(row.metrics),
        JSON.stringify(row.constraints),
      ])
        tr.insertCell().textContent = value;
    }
    host.append(table);
    chart(page.items);
  }
  function select(row: EvaluationRecord) {
    selected = row;
    compare(row).catch(error);
    text(find("[data-selected]"), row);
    find<HTMLButtonElement>("[data-preview]").disabled = !options.onPreview;
  }
  async function allHistory(owner: string, candidateId?: string) {
    let offset = 0;
    const records: EvaluationRecord[] = [];
    for (;;) {
      const page = await api.history(owner, {
        offset,
        ...(candidateId ? { candidateId } : {}),
      });
      records.push(...page.items);
      if (page.nextOffset === null) return records;
      offset = page.nextOffset;
    }
  }
  async function compare(row: EvaluationRecord) {
    if (!study) return;
    const jobs = await api.jobs(study.id);
    const baseline = jobs.items.find(
      (j) => j.kind === "baseline" && j.status === "completed",
    );
    const [candidate, base] = await Promise.all([
      allHistory(row.ownerId, row.candidateId),
      baseline ? allHistory(baseline.id) : Promise.resolve([]),
    ]);
    if (selected !== row) return;
    const host = find("[data-comparison]");
    host.replaceChildren();
    const table = document.createElement("table");
    const header = table.insertRow();
    for (const value of [
      "Metric / direction",
      "Baseline mean ± SD",
      "Selected " + row.phase + " mean ± SD",
    ])
      header.insertCell().textContent = value;
    for (const goal of Object.values(study.spec.objectives)) {
      const summarize = (rows: EvaluationRecord[]) => {
        const values = rows
          .filter((r) => r.status === "completed")
          .map((r) => r.metrics[goal.metric])
          .filter(Number.isFinite);
        if (!values.length) return "Unavailable";
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sd = Math.sqrt(
          values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
        );
        return `${mean.toPrecision(4)} ± ${sd.toPrecision(3)} (n=${values.length})`;
      };
      const tr = table.insertRow();
      tr.insertCell().textContent = `${goal.metric} / ${goal.direction} / ${goal.unit}`;
      tr.insertCell().textContent = summarize(base);
      tr.insertCell().textContent = summarize(
        candidate.filter((r) => r.phase === row.phase),
      );
    }
    host.append(table);
  }
  function chart(records: EvaluationRecord[]) {
    const host = find("[data-chart]");
    host.replaceChildren();
    if (!study) return;
    const goals = Object.values(study.spec.objectives);
    if (goals.length < 2) return;
    const rows = records.filter((r) => r.status === "completed");
    if (!rows.length) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 650 260");
    svg.setAttribute(
      "aria-label",
      "Measured objective trade-offs on this page",
    );
    const ranges = goals.slice(0, 2).map((g) => {
      const values = rows.map((r) => r.metrics[g.metric]);
      return [Math.min(...values), Math.max(...values)];
    });
    for (const row of rows) {
      const point = document.createElementNS(ns, "circle");
      const xy = goals
        .slice(0, 2)
        .map(
          (g, i) =>
            30 +
            ((row.metrics[g.metric] - ranges[i][0]) /
              (ranges[i][1] - ranges[i][0] || 1)) *
              (i === 0 ? 580 : 180),
        );
      point.setAttribute("cx", String(xy[0]));
      point.setAttribute("cy", String(230 - xy[1]));
      point.setAttribute("r", "5");
      point.setAttribute(
        "fill",
        row.phase === "validation"
          ? "#dcb3ff"
          : row.phase === "baseline"
            ? "#ffcf80"
            : "#85d9be",
      );
      point.setAttribute("tabindex", "0");
      point.onclick = () => select(row);
      point.onkeydown = (e) => {
        if (e.key === "Enter") select(row);
      };
      const title = document.createElementNS(ns, "title");
      title.textContent = `${row.candidateId}: ${JSON.stringify(row.metrics)}`;
      point.append(title);
      svg.append(point);
    }
    host.append(svg);
    const p = document.createElement("p");
    p.textContent = `${goals[0].metric} (${goals[0].direction}) × ${goals[1].metric} (${goals[1].direction}). Each point is one seed measurement on this page, not an aggregated Pareto front.`;
    host.append(p);
  }
  function bind(selector: string, action: () => unknown) {
    find(selector).onclick = () => {
      Promise.resolve().then(action).catch(error);
    };
  }
  bind("[data-refresh]", () => {
    clearTimeout(timer);
    return loadStudies();
  });
  find<HTMLSelectElement>("[data-studies]").onchange = async () => {
    try {
      clearTimeout(timer);
      study = await api.study(find<HTMLSelectElement>("[data-studies]").value);
      runId = "";
      selected = undefined;
      replayView?.dispose();
      text(find("[data-selected]"), "Select a measured candidate.");
      find("[data-comparison]").replaceChildren();
      await loadStudy();
    } catch (e) {
      error(e);
    }
  };
  bind("[data-baseline]", async () => {
    if (study) {
      await api.baseline(study.id);
      clearTimeout(timer);
      await refreshRuns();
    }
  });
  bind("[data-run]", async () => {
    if (study) {
      const run = await api.run(study.id, {
        population_size: 24,
        generations: 8,
        seed: 42,
      });
      await inspect(run.id);
    }
  });
  bind("[data-next]", () => {
    if (next !== null) {
      offset = next;
      return loadHistory();
    }
  });
  bind("[data-reset]", () => {
    offset = 0;
    return loadHistory();
  });
  find<HTMLSelectElement>("[data-phase]").onchange = () => {
    offset = 0;
    loadHistory().catch(error);
  };
  bind("[data-cancel]", () =>
    runId
      ? isJob
        ? api.cancelJob(runId)
        : api.runHandle(runId).cancel()
      : undefined,
  );
  bind("[data-preview]", () =>
    selected && study
      ? options.onPreview?.(selected.decisions, study)
      : undefined,
  );
  bind("[data-replay]", async () => {
    if (selected && study) {
      await api.replay(study.id, selected.decisions);
      clearTimeout(timer);
      await refreshRuns();
    }
  });
  bind("[data-export]", () => {
    if (!selected || !study) return;
    const value = { schemaVersion: 2, study, selected };
    options.onExport?.(value);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "genetic-assembly-design.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  if (api.readOnly) for (const selector of ["[data-baseline]", "[data-run]", "[data-replay]", "[data-cancel]"]) {
    find<HTMLButtonElement>(selector).disabled = true;
    find(selector).title = "Read-only archive: original model required";
  }
  loadStudies().catch(error);
  return {
    refresh: loadStudies,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      replayView?.dispose();
      container.replaceChildren();
    },
  };
}
export {openArchive} from '@genetic-assembly/sdk';
