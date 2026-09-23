import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateStudy,
  encodeDecisions,
  decodeDecisions,
  compileStudy,
  baselineDecisions,
} from "../dist/index.js";
import { defineStudy, checkStudy } from "../dist/node/index.js";
const input = {
  name: "Mapping",
  version: "1",
  inputs: {},
  decisions: {
    z: {
      kind: "categorical",
      choices: ["park", "shop", "school"],
      baseline: "shop",
    },
    a: { kind: "integer", lower: 1, upper: 9, step: 2, baseline: 3 },
    b: { kind: "boolean", baseline: false },
  },
  objectives: { benefit: { metric: "benefit", direction: "maximize" } },
  searchSeeds: [1],
  validationSeeds: [2],
};
test("named mapping round trips categories and stepped integers", () => {
  const spec = validateStudy(input);
  assert.deepEqual(
    decodeDecisions(spec, encodeDecisions(spec, baselineDecisions(spec))),
    { z: "shop", a: 3, b: false },
  );
  assert.equal(compileStudy(spec).problem.variables[2].kind, "categorical");
  assert.throws(() => decodeDecisions(spec, [3, 0, 1.5]));
  assert.throws(() => encodeDecisions(spec, { z: "park", a: 2, b: false }));
  assert.throws(() => decodeDecisions(spec, [3, 0.5, 1]));
});
test("rejects missing metrics and nondeterministic baselines", async () => {
  await assert.rejects(
    checkStudy(
      defineStudy({ ...input, evaluate: () => ({ metrics: { wrong: 1 } }) }),
    ),
    /missing/,
  );
  let n = 0;
  await assert.rejects(
    checkStudy(
      defineStudy({
        ...input,
        evaluate: () => ({ metrics: { benefit: n++ } }),
      }),
    ),
    /differ/,
  );
});
test("deterministic repair runs before actual baseline validation", async () => {
  const model = defineStudy({
    ...input,
    repair: (d) => ({
      decisions: { ...d, a: 5 },
      repairs: ["capacity raised"],
    }),
    validate: (d) => (d.a === 5 ? [] : ["wrong"]),
    evaluate: (d) => ({ metrics: { benefit: Number(d.a) } }),
  });
  assert.equal((await checkStudy(model)).measurement.metrics.benefit, 5);
});
test("seed sets are disjoint and unique", () => {
  assert.throws(
    () => validateStudy({ ...input, validationSeeds: [1] }),
    /disjoint/,
  );
});
test("repair determinism is checked even when metrics are constant", async () => {
  let index = 0;
  const model = defineStudy({
    ...input,
    repair: (d) => ({ decisions: { ...d, a: index++ ? 5 : 3 }, repairs: [] }),
    evaluate: () => ({ metrics: { benefit: 1 } }),
  });
  await assert.rejects(checkStudy(model), /repairs differ/);
});
test("category values are strings and domain validity is reserved", () => {
  const spec = validateStudy({
    ...input,
    decisions: {
      choice: { kind: "categorical", choices: ["1", "2"], baseline: "1" },
    },
  });
  assert.throws(() => encodeDecisions(spec, { choice: 1 }), /string/);
  assert.throws(
    () =>
      validateStudy({
        ...input,
        constraints: {
          domain_validity: { metric: "benefit", operator: "<=", bound: 0 },
        },
      }),
    /reserved/,
  );
});
