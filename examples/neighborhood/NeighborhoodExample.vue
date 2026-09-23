<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
const state = ref("Ready"),
  error = ref(""),
  running = ref(false),
  cancelled = ref(false),
  canExport = ref(false),
  baseline = ref<any>(),
  candidates = ref<any[]>([]),
  selected = ref<any>(),
  generationDetail = ref<any>(),
  progress = ref<
    {
      generation: number;
      pareto_size: number;
      objective_stats: { min: number; max: number }[];
    }[]
  >([]);
const inspectorHost = ref<HTMLElement>(),
  replayHost = ref<HTMLElement>();
let optimizer: any,
  model: any,
  run: any,
  inspector: any,
  replay: any,
  provider: any;
async function start() {
  running.value = true;
  cancelled.value = false;
  canExport.value = false;
  error.value = "";
  candidates.value = [];
  progress.value = [];
  selected.value = undefined;
  inspector?.dispose();
  replay?.dispose();
  optimizer?.dispose();
  run = undefined;
  try {
    const [
      { Optimizer },
      { default: study },
      { mountInspector, LocalInspectorProvider },
    ] = await Promise.all([
      import("../../sdk/dist/index.js"),
      import("./study.mjs"),
      import("../../inspector/dist/index.js"),
    ]);
    if (cancelled.value) throw new DOMException("Cancelled", "AbortError");
    optimizer = new Optimizer({ memoryLimitBytes: 64 * 1024 * 1024 });
    model = study;
    state.value = "Evaluating baseline (2 simulation seeds)…";
    baseline.value = await optimizer.baseline(model);
    canExport.value = true;
    provider = new LocalInspectorProvider(optimizer, [model]);
    inspector = mountInspector(inspectorHost.value!, {
      provider,
      onReplay: openReplay,
    });
    run = optimizer.run(model, { populationSize: 8, generations: 2, seed: 42 });
    const unsubscribe = run.subscribe((status: any) => {
      state.value = `${status.status} · generation ${status.progress?.generation ?? 0}`;
      if (
        status.progress &&
        !progress.value.some((p) => p.generation === status.progress.generation)
      )
        progress.value.push(status.progress);
    });
    const status = await run.wait();
    unsubscribe();
    if (status.status === "completed")
      candidates.value = run.results().validatedFront;
    await inspector.refresh();
  } catch (e) {
    error.value = cancelled.value ? "" : String(e);
    state.value = cancelled.value ? "Cancelled" : "Failed";
  } finally {
    running.value = false;
  }
}
function cancel() {
  cancelled.value = true;
  if (run) run.cancel();
  else optimizer?.dispose();
}
async function openReplay(dataset: any) {
  const { mountGrabmReplay } = await import("./dist/browser.js");
  replay?.dispose();
  replay = await mountGrabmReplay(
    replayHost.value!,
    provider.datasetUrl(dataset.id),
    dataset,
    provider.resourceFetch,
  );
}
async function replaySelected() {
  if (!selected.value) return;
  try {
    state.value = "Generating selected replay…";
    await optimizer.replay(model, selected.value.decisions);
    await inspector.refresh();
    state.value = "Replay ready — select its job in the inspector";
  } catch (e) {
    error.value = String(e);
  }
}
async function download() {
  const bytes = await optimizer.export();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "neighborhood.ga.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onBeforeUnmount(() => {
  cancelled.value = true;
  run?.cancel();
  optimizer?.dispose();
  inspector?.dispose();
  replay?.dispose();
});
</script>
<template>
  <div class="live-study">
    <p>
      <strong>Live browser optimization.</strong> These results are computed on
      your device, not loaded from a recording. Eight residents and their
      authored demand stay fixed. The search changes shop position, capacity,
      and one optional link.
    </p>
    <button :disabled="running" @click="start">Run neighborhood study</button>
    <button :disabled="!running" @click="cancel">Cancel</button>
    <button :disabled="!canExport || running" @click="download">
      Export session
    </button>
    <p role="status">{{ state }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="baseline">
      Baseline: service {{ baseline.metrics.service }}, access
      {{ baseline.metrics.access }}, cost {{ baseline.metrics.cost }}. Search
      seeds 42/43; validation seeds 142/143.
    </p>
    <svg
      v-if="candidates.length"
      viewBox="0 0 500 210"
      role="img"
      aria-label="Validated candidates: cost horizontally, service vertically"
    >
      <path d="M40 10V180H480" fill="none" stroke="currentColor" />
      <text x="200" y="205" fill="currentColor">Design cost (proxy units)</text>
      <g
        v-for="(candidate, index) in candidates"
        :key="candidate.candidateId"
        role="button"
        tabindex="0"
        :aria-label="`Select candidate ${candidate.candidateId}`"
        @click="selected = candidate"
        @keydown.enter="selected = candidate"
      >
        <circle
          :cx="40 + (candidate.metrics.cost / 100) * 400"
          :cy="180 - candidate.metrics.service * 160"
          r="7"
          :fill="selected === candidate ? '#ec9150' : '#54b998'"
        />
        <title>{{ JSON.stringify(candidate.metrics) }}</title>
      </g>
    </svg>
    <svg
      v-if="progress.length"
      viewBox="0 0 500 210"
      role="img"
      aria-label="Convergence: minimum design cost by generation"
    >
      <path d="M40 10V180H480" fill="none" stroke="currentColor" />
      <text x="160" y="205" fill="currentColor">Generation · minimum cost</text>
      <polyline
        :points="
          progress
            .map(
              (p) =>
                `${40 + p.generation * 200},${180 - p.objective_stats[1].min * 1.6}`,
            )
            .join(' ')
        "
        fill="none"
        stroke="#54b998"
        stroke-width="2"
      />
      <g
        v-for="point in progress"
        :key="point.generation"
        role="button"
        tabindex="0"
        :aria-label="`Inspect generation ${point.generation}`"
        @click="generationDetail = point"
        @keydown.enter="generationDetail = point"
      >
        <circle
          :cx="40 + point.generation * 200"
          :cy="180 - point.objective_stats[1].min * 1.6"
          r="6"
          fill="#54b998"
        />
        <title>
          Generation {{ point.generation }}: minimum cost
          {{ point.objective_stats[1].min }}
        </title>
      </g>
    </svg>
    <p v-if="generationDetail">
      Generation {{ generationDetail.generation }}: minimum cost
      {{ generationDetail.objective_stats[1].min }}, search-front size
      {{ generationDetail.pareto_size }}.
    </p>
    <div v-if="selected">
      <pre>{{ JSON.stringify(selected, null, 2) }}</pre>
      <button @click="replaySelected">Generate selected replay</button>
    </div>
    <div ref="replayHost" />
    <div ref="inspectorHost" />
    <p>
      Memory retention is capped at 64 MiB for this example. Closing the page
      discards this session unless you export it. Service is fulfilled authored
      demand; access is coverage within 15 minutes; cost is a declared design
      proxy, not a monetary estimate.
    </p>
  </div>
</template>
<style scoped>
.live-study button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 8px 12px;
  margin: 4px;
  cursor: pointer;
}
.live-study button:disabled {
  opacity: 0.4;
  cursor: default;
}
.live-study svg {
  width: 100%;
  max-width: 600px;
}
.live-study [role="alert"] {
  color: #d44;
}
.live-study pre {
  max-height: 300px;
  overflow: auto;
}
.live-study [role="button"] {
  cursor: pointer;
}
</style>
