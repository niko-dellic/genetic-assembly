<script setup>
import RecordedRun from '../examples/recorded/RecordedExample.vue'
</script>

# Recorded optimization examples

This is a recorded run of the [two-target quickstart](./quickstart.md), produced by the Rust companion with population 32, 12 generations, and seed 42. The recording process repeats the run to check deterministic results and verifies cancellation separately.

## Explore the trade-off

Minimize both distance penalties: `x²` and `(1−x)²`. No single position minimizes both. Select a point to highlight one candidate on the final Pareto front. The history chart shows population objective statistics over generations.

<ClientOnly><RecordedRun /></ClientOnly>

The charts run in your browser using the visualization package. They do not submit jobs to a hosted optimizer. Run the quickstart against your own local companion to change the model or seed.

[Download the recorded data and provenance](./examples/two-targets.json)

## Implement your own model

Follow [the adapter guide](./integrating-another-repository.md) for multi-objective models, constraints, domain operators, validation, and materialization. Explore the [examples dashboard](./examples.md) for executable numerical and simulation models.

## Reproduce a study recording

Initialize the numerical quickstart in an independent consumer, run `ga up`, then set `GA_STUDY_FILE` to that consumer's `.genetic-assembly/study.json` and `GA_SERVER_URL` to its companion URL before running `npm run docs:record` in the documentation checkout. The recording script repeats the experiment with the same solver seed and compares fronts before writing the chart data.
