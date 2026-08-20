import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter, runConformanceSuite } from "./index.js";

test("conformance accepts a deterministic built-in-operator adapter", async () => {
  const adapter = defineAdapter({
    version: "test-v1",
    initialize: () => ({ materialize: true }),
    evaluateBatch: (candidates) => candidates.map((candidate) => ({
      ...candidate,
      evaluation: { objectives: [candidate.genes[0] ?? 0], constraints: [] },
    })),
    materialize: (candidates) => candidates.map((candidate) => ({
      id: candidate.id,
      data: { value: candidate.genes[0] },
    })),
  });
  await runConformanceSuite(adapter, {
    name: "fixture",
    problem: {
      variables: [{ kind: "real", lower: 0, upper: 1 }],
      objectives: [{ name: "value", direction: "minimize" }],
    },
  });
  assert.ok(true);
});
