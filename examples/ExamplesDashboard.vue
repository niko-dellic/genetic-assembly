<script setup lang="ts">
import { ref, defineAsyncComponent } from "vue";
const selected = ref("numerical");
const examples = [
  {
    id: "numerical",
    title: "Two competing targets",
    kind: "01 · Learn the optimizer",
    description:
      "A small numerical model with two objectives. Change the search settings and explore the Pareto front.",
    mode: "Live · Rust/WASM · no backend",
    guide: "/docs/local.html",
    source: "numerical/study.mjs",
  },
  {
    id: "neighborhood",
    title: "Neighborhood services",
    kind: "02 · Connect a simulation",
    description:
      "Use grabm as an application model. Adjust bounded graph decisions, compare service and cost, and replay a selected design.",
    mode: "Live · grabm simulation · browser workers",
    guide: "/docs/grabm.html",
    source: "neighborhood/study.mjs",
  },
  {
    id: "recorded",
    title: "Recorded search history",
    kind: "03 · Compare results",
    description:
      "Explore saved Pareto and convergence charts without starting an optimization.",
    mode: "Recorded · fixed dataset",
    guide: "/docs/recorded-examples.html",
    source: "recorded/RecordedExample.vue",
  },
];
const components = {
  numerical: defineAsyncComponent(
    () => import("./numerical/NumericalExample.vue"),
  ),
  neighborhood: defineAsyncComponent(
    () => import("./neighborhood/NeighborhoodExample.vue"),
  ),
  recorded: defineAsyncComponent(
    () => import("./recorded/RecordedExample.vue"),
  ),
};
</script>
<template>
  <div class="examples-dashboard">
    <div class="example-grid" aria-label="Choose an example">
      <button
        v-for="example in examples"
        :key="example.id"
        class="example-card"
        :aria-pressed="selected === example.id"
        :aria-controls="'example-workspace'"
        @click="selected = example.id"
      >
        <span class="kicker">{{ example.kind }}</span
        ><strong>{{ example.title }}</strong
        ><span>{{ example.description }}</span
        ><small>{{ example.mode }}</small>
      </button>
    </div>
    <section id="example-workspace" aria-label="Selected example">
      <template v-for="example in examples" :key="example.id">
        <template v-if="selected === example.id">
          <h2>{{ example.title }}</h2>
          <p>
            <a :href="example.guide">Walkthrough</a> ·
            <a
              :href="`https://github.com/niko-dellic/genetic-assembly/tree/main/examples/${example.source}`"
              >Example source</a
            >
          </p>
        </template>
      </template>
      <component
        :is="components[selected as keyof typeof components]"
        :key="selected"
      />
    </section>
    <p class="example-note">
      Switching examples closes the active session. Export results first if you
      want to keep them. Each example owns its application-specific code; the
      SDK remains independent of grabm.
    </p>
  </div>
</template>
<style scoped>
.example-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 28px 0;
}
.example-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 22px;
  background: var(--vp-c-bg-soft);
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.example-card:hover,
.example-card[aria-pressed="true"] {
  border-color: var(--vp-c-brand-1);
}
.example-card[aria-pressed="true"] {
  background: var(--vp-c-brand-soft);
}
.example-card strong {
  font-size: 21px;
  line-height: 1.3;
}
.example-card span:not(.kicker) {
  font-size: 14px;
  line-height: 1.6;
}
.kicker {
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
}
.example-card small {
  margin-top: auto;
  color: var(--vp-c-text-2);
}
#example-workspace {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
}
#example-workspace h2 {
  margin-top: 0;
  border-top: 0;
  padding-top: 0;
}
.example-note {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
@media (max-width: 760px) {
  .example-grid {
    grid-template-columns: 1fr;
  }
  .example-card {
    padding: 16px;
  }
  #example-workspace {
    padding: 14px;
  }
}
</style>
