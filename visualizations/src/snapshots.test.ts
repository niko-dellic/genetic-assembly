import { test, expect } from "vitest";
import {
  Optimizer,
  defineStudy,
  collectPages,
  validateStudy,
} from "@genetic-assembly/sdk";
import { fromGenerationSnapshots } from "./snapshots.js";
import { validateDataset } from "./dataset.js";
test("charts use the actual survivors and generation-specific Pareto membership", async () => {
  const study = defineStudy({
    name: "Charts",
    version: "1",
    inputs: {},
    decisions: { x: { kind: "real", lower: 0, upper: 1, baseline: 0.5 } },
    objectives: { cost: { metric: "cost", direction: "minimize" } },
    evaluate: ({ x }) => ({ metrics: { cost: Number(x) } }),
  });
  const optimizer = new Optimizer();
  try {
    const run = await optimizer.run(study, {
      populationSize: 4,
      generations: 2,
    });
    await run.wait();
    const snapshots = await collectPages((o) => run.generations(o));
    const candidates = await collectPages((o) => run.candidates(o));
    const data = fromGenerationSnapshots(
      validateStudy(study),
      snapshots,
      candidates,
    );
    validateDataset(data);
    expect(data.generations).toHaveLength(3);
    expect(data.candidates.map((c) => String(c.individual.id))).toEqual(
      snapshots.at(-1)!.population.map((c) => c.candidateId),
    );
    for (const generation of data.generations)
      expect(generation.sampled_front.map((c) => String(c.id))).toEqual(
        snapshots.find((s) => s.generation === generation.generation)!
          .paretoCandidateIds,
      );
    expect(() =>
      fromGenerationSnapshots(validateStudy(study), snapshots, []),
    ).toThrow("Missing evidence");
  } finally {
    optimizer.dispose();
  }
});
