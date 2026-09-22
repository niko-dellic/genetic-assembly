<script setup>
import RecordedRun from './.vitepress/components/RecordedRun.vue'
</script>

# Recorded optimization examples

This is a recorded run of the [two-target quickstart](./quickstart.md), produced by the Rust companion with population 32, 12 generations, and seed 42. The recording process repeats the run to check deterministic results and verifies cancellation separately.

## Explore the trade-off

Minimize both distance penalties: `x²` and `(1−x)²`. No single position minimizes both. Select a point to highlight one candidate on the final Pareto front. The history chart shows population objective statistics over generations.

<ClientOnly><RecordedRun /></ClientOnly>

The charts run in your browser using the visualization package. They do not submit jobs to a hosted optimizer. Run the quickstart against your own local companion to change the model or seed.

[Download the recorded data and provenance](./examples/two-targets.json)

## Implement your own model

Follow [the adapter guide](./integrating-another-repository.md) for multi-objective models, constraints, domain operators, validation, and materialization. The repository also contains a [delivery-network reference adapter](https://github.com/niko-dellic/genetic-assembly/tree/main/examples/reference-adapter).
