<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
const population = ref(16),
  generations = ref(6),
  seed = ref(42);
const state = ref("Ready"),
  error = ref(""),
  busy = ref(false),
  results = ref<any[]>([]),
  selected = ref<any>();
let optimizer: any,
  run: any,
  stopped = false;
async function start() {
  busy.value = true;
  stopped = false;
  error.value = "";
  results.value = [];
  selected.value = undefined;
  optimizer?.dispose();
  run = undefined;
  try {
    const [{ Optimizer }, { default: study }] = await Promise.all([
      import("../../sdk/dist/index.js"),
      import("./study.mjs"),
    ]);
    if (stopped) return;
    optimizer = new Optimizer();
    state.value = "Evaluating baseline";
    await optimizer.baseline(study);
    run = optimizer.run(study, {
      populationSize: population.value,
      generations: generations.value,
      seed: seed.value,
    });
    const unsubscribe = run.subscribe((s: any) => {
      state.value = `${s.status} · generation ${s.progress?.generation ?? 0}`;
    });
    try {
      const status = await run.wait();
      if (status.status === "completed")
        results.value = run.results().validatedFront;
    } finally {
      unsubscribe();
    }
  } catch (e) {
    if (!stopped) {
      error.value = String(e);
      state.value = "Failed";
    }
  } finally {
    busy.value = false;
    if (stopped) state.value = "Cancelled";
  }
}
function cancel() {
  stopped = true;
  if (run) run.cancel();
  else optimizer?.dispose();
}
async function download() {
  const url = URL.createObjectURL(
    new Blob([await optimizer.export()], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "two-targets.ga.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onBeforeUnmount(() => {
  cancel();
  optimizer?.dispose();
});
</script>
<template>
  <section class="numerical-example" aria-label="Two targets optimization">
    <p>
      Choose a position between two targets. Minimize both x² and (1−x)²;
      improving one distance worsens the other. The baseline is x = 0.5, with
      both penalties equal to 0.25.
    </p>
    <fieldset :disabled="busy">
      <legend>Experiment settings</legend>
      <label
        >Population
        <select v-model.number="population">
          <option>8</option>
          <option>16</option>
          <option>32</option>
        </select></label
      >
      <label
        >Generations
        <select v-model.number="generations">
          <option>2</option>
          <option>6</option>
          <option>12</option>
        </select></label
      >
      <label
        >Solver seed
        <select v-model.number="seed">
          <option>42</option>
          <option>43</option>
          <option>44</option>
        </select></label
      >
    </fieldset>
    <button :disabled="busy" @click="start">Run numerical study</button>
    <button :disabled="!busy" @click="cancel">Cancel</button>
    <button :disabled="busy || !results.length" @click="download">
      Export numerical session
    </button>
    <p role="status" aria-live="polite">{{ state }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <svg
      v-if="results.length"
      viewBox="0 0 480 270"
      role="img"
      aria-label="Validated Pareto front: left penalty against right penalty"
    >
      <path d="M40 10V230H460" fill="none" stroke="currentColor" />
      <text x="160" y="260" fill="currentColor">Left penalty (minimize)</text>
      <text x="48" y="22" fill="currentColor">Right penalty (minimize)</text>
      <g
        v-for="c in results"
        :key="c.candidateId"
        role="button"
        tabindex="0"
        :aria-label="`Inspect position ${c.decisions.x.toFixed(3)}`"
        @click="selected = c"
        @keydown.enter="selected = c"
        @keydown.space.prevent="selected = c"
      >
        <circle
          :cx="40 + c.metrics.left * 410"
          :cy="230 - c.metrics.right * 200"
          r="6"
          :fill="selected === c ? 'var(--vp-c-brand-1)' : '#54b998'"
        />
      </g>
    </svg>
    <p v-if="selected">
      Position {{ selected.decisions.x.toFixed(4) }} · left
      {{ selected.metrics.left.toFixed(4) }} · right
      {{ selected.metrics.right.toFixed(4) }}
    </p>
    <p v-if="results.length">
      {{ results.length }} validated candidates. Select a point to compare its
      measurements. These are live results computed in your browser; exporting
      preserves this session.
    </p>
  </section>
</template>
<style scoped>
fieldset {
  border: 1px solid var(--vp-c-divider);
  padding: 12px;
  border-radius: 8px;
  margin: 16px 0;
}
label {
  display: inline-flex;
  gap: 8px;
  margin: 8px;
}
select,
button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 6px 10px;
  margin: 4px;
}
button,
select,
[role="button"] {
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
svg {
  width: 100%;
  max-width: 680px;
}
[role="alert"] {
  color: var(--vp-c-danger-1);
}
</style>
