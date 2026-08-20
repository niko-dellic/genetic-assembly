import { describe, expect, it } from "vitest";
import { validateDataset } from "./dataset.js";
import type { OptimizationDataset } from "./types.js";

const valid: OptimizationDataset = {
  objectives: [{ index: 0, name: "Cost", direction: "minimize" }],
  levers: [{ index: 0, id: "x", kind: "real", lower: 0, upper: 1 }],
  constraints: [{ index: 0, name: "Budget", feasible_when: "lte_zero" }],
  candidates: [{ individual: { id: 1, genes: [0.5], objectives: [2], constraints: [0], constraint_violation: 0, rank: 0, crowding_distance: 1 } }],
  generations: [], history_complete: false,
};

describe("validateDataset", () => {
  it("accepts dimensionally consistent finite data", () => expect(() => validateDataset(valid)).not.toThrow());
  it("rejects mismatched dimensions and non-finite values", () => {
    expect(() => validateDataset({ ...valid, candidates: [{ individual: { ...valid.candidates[0].individual, objectives: [] } }] })).toThrow(/objectives length/);
    expect(() => validateDataset({ ...valid, candidates: [{ individual: { ...valid.candidates[0].individual, genes: [Number.NaN] } }] })).toThrow(/non-finite/);
  });
});
