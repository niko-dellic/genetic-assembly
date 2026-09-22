<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const palette = ref('neutral')
function sync() {
  palette.value = document.documentElement.dataset['palette'] ?? 'neutral'
}
function select(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  document.documentElement.dataset['palette'] = value
  try {
    localStorage.setItem('genetic-assembly-palette', value)
  } catch {
    // The selected palette still applies when browser storage is unavailable.
  }
}
onMounted(() => {
  sync()
  document.addEventListener('genetic-assembly:themechange', sync)
})
onBeforeUnmount(() => document.removeEventListener('genetic-assembly:themechange', sync))
</script>

<template>
  <label class="docs-theme-picker">
    <span>Theme</span>
    <select aria-label="Color palette" :value="palette" @change="select">
      <option value="neutral">Neutral</option>
      <option value="green">Green</option>
      <option value="blue">Blue</option>
      <option value="violet">Violet</option>
    </select>
  </label>
</template>

<style>
.docs-theme-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--ink);
}
.docs-theme-picker select {
  appearance: auto;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 4px 8px;
  color: var(--control-foreground);
  background: var(--control-background);
  cursor: pointer;
}
.docs-theme-picker select:focus-visible {
  outline: 2px solid var(--acid);
  outline-offset: 3px;
}
.VPNavBar .docs-theme-picker {
  display: none;
}
.VPNavScreen .docs-theme-picker {
  padding: 16px 0;
  justify-content: space-between;
}
@media (min-width: 768px) {
  .VPNavBar .docs-theme-picker {
    display: flex;
  }
}
</style>
