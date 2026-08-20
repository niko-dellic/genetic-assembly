import { describe, expect, it } from "vitest";
import { directionalPercentiles, isConstraintFeasible, normalizedLeverValue } from "./normalization.js";
import type { VizCandidate } from "./types.js";

function candidate(id: number, value: number): VizCandidate {
  return {
    individual: {
      id,
      genes: [],
      objectives: [value],
      constraints: [],
      constraint_violation: 0,
      rank: 0,
      crowding_distance: 0,
    },
  };
}

describe("directionalPercentiles", () => {
  it("respects minimize and maximize directions", () => {
    const candidates = [candidate(1, 10), candidate(2, 20), candidate(3, 30)];
    expect(directionalPercentiles(candidates, 0, "minimize").get(1)).toBe(1);
    expect(directionalPercentiles(candidates, 0, "minimize").get(3)).toBe(0);
    expect(directionalPercentiles(candidates, 0, "maximize").get(3)).toBe(1);
  });

  it("uses average ranks for ties and midpoint for constant objectives", () => {
    const tied = [candidate(1, 1), candidate(2, 1), candidate(3, 3)];
    expect(directionalPercentiles(tied, 0, "minimize").get(1)).toBe(0.75);
    const constant = [candidate(1, 2), candidate(2, 2)];
    expect(directionalPercentiles(constant, 0, "minimize").get(1)).toBe(0.5);
  });
});

describe("normalizedLeverValue", () => {
  it("normalizes bounded and binary levers", () => {
    expect(normalizedLeverValue(5, { index: 0, id: "x", kind: "real", lower: 0, upper: 10 })).toBe(0.5);
    expect(normalizedLeverValue(1, { index: 0, id: "on", kind: "binary" })).toBe(1);
  });
});

describe("constraint feasibility", () => {
  it("treats the zero boundary as feasible and rejects non-finite values", () => {
    expect(isConstraintFeasible(-0.01)).toBe(true);
    expect(isConstraintFeasible(0)).toBe(true);
    expect(isConstraintFeasible(Number.NaN)).toBe(false);
    expect(isConstraintFeasible(0.01)).toBe(false);
  });
});
