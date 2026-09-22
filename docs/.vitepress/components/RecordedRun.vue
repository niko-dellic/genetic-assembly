<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { withBase } from 'vitepress'
const scatterElement = ref<HTMLElement>()
const historyElement = ref<HTMLElement>()
const selected = ref<number>()
const error = ref('')
let destroy: (() => void) | undefined
let disposed = false
onMounted(async () => {
  try {
    const { createParetoScatter, createConvergenceHistory, validateDataset } = await import('@genetic-assembly/visualizations')
    const response = await fetch(withBase('/examples/two-targets.json'))
    if (!response.ok) throw new Error('Recorded results could not be loaded.')
    const { dataset } = await response.json()
    if (disposed) return
    validateDataset(dataset)
    const selection = { pinnedIds: [], activeId: undefined as number | undefined }
    const scatter = createParetoScatter(scatterElement.value!, { onSelect(id: number) { selected.value = id; selection.activeId = id; update() } })
    const history = createConvergenceHistory(historyElement.value!)
    const update = () => { scatter.update({dataset,selection}); history.update({dataset,selection}) }
    const observer = new ResizeObserver(() => { scatter.resize(); history.resize() })
    observer.observe(scatterElement.value!); observer.observe(historyElement.value!); update()
    destroy = () => { observer.disconnect(); scatter.destroy(); history.destroy() }
  } catch (cause) { error.value = String(cause) }
})
onBeforeUnmount(() => { disposed = true; destroy?.() })
</script>
<template>
  <p v-if="error" role="alert">{{ error }}</p>
  <div ref="scatterElement" class="recorded-chart" />
  <p aria-live="polite">{{ selected === undefined ? 'Select a point to inspect a candidate.' : `Selected candidate ${selected}` }}</p>
  <div ref="historyElement" class="recorded-chart" />
</template>
<style scoped>
.recorded-chart { height: 320px; width: 100%; border: 1px solid var(--line); border-radius: 8px; margin: 16px 0; background: var(--panel); }
.recorded-chart :deep(text) { fill: var(--ink); font-family: inherit; font-size: 11px; }
</style>
