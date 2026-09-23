import { defineStudy } from "@genetic-assembly/sdk";
/** Two competing distances with a known Pareto front, useful for learning the API. */
export default defineStudy({
  name: "Two targets",
  version: "1",
  inputs: {},
  decisions: { x: { kind: "real", lower: 0, upper: 1, baseline: 0.5 } },
  objectives: {
    left: { metric: "left", direction: "minimize" },
    right: { metric: "right", direction: "minimize" },
  },
  searchSeeds: [42],
  validationSeeds: [142],
  evaluate: ({ x }) => ({ metrics: { left: x * x, right: (1 - x) ** 2 } }),
  materialize: (decisions) => decisions,
});
