import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { Optimizer, openArchive } from "../../../sdk/dist/index.js";
import study from "../../../examples/neighborhood/study.mjs";
const optimizer = new Optimizer();
const started = performance.now();
try {
  await (await optimizer.baseline(study)).completed();
  const run = (await optimizer.run(study, {
    populationSize: 8,
    generations: 2,
    seed: 42,
  }));
  await run.wait();
  const expected = optimizer
    .history()
    .filter((r) => r.phase !== "replay")
    .map(
      ({
        candidateId,
        phase,
        seed,
        metrics,
        constraints,
        decisions,
        status,
      }) => ({
        candidateId,
        phase,
        seed,
        metrics,
        constraints,
        decisions,
        status,
      }),
    )
    .sort((a, b) =>
      `${a.phase}:${a.candidateId}:${a.seed}`.localeCompare(
        `${b.phase}:${b.candidateId}:${b.seed}`,
      ),
    );
  for (const browser of ["chromium", "firefox", "webkit"]) {
    const archive = await openArchive(
      readFileSync(`/tmp/ga-browser-neighborhood-${browser}.ga.json`),
    );
    const actual = archive
      .history()
      .filter((r) => r.phase !== "replay")
      .map(
        ({
          candidateId,
          phase,
          seed,
          metrics,
          constraints,
          decisions,
          status,
        }) => ({
          candidateId,
          phase,
          seed,
          metrics,
          constraints,
          decisions,
          status,
        }),
      )
      .sort((a, b) =>
        `${a.phase}:${a.candidateId}:${a.seed}`.localeCompare(
          `${b.phase}:${b.candidateId}:${b.seed}`,
        ),
      );
    function compare(a, b, path = browser) {
      if (typeof b === "number") {
        assert.ok(
          typeof a === "number" &&
            Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)),
          `${path}: ${a} differs from ${b}`,
        );
        return;
      }
      if (b === null || typeof b !== "object") {
        assert.equal(a, b, path);
        return;
      }
      assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
      for (const key of Object.keys(b))
        compare(a[key], b[key], `${path}.${key}`);
    }
    compare(actual, expected);
  }
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/grabm-benchmark.json",
    JSON.stringify(
      {
        model: study.name,
        nodeWasmMs: performance.now() - started,
        measurements: expected.length,
        population: 8,
        generations: 2,
        searchSeeds: study.searchSeeds,
        validationSeeds: study.validationSeeds,
        browserParity: ["chromium", "firefox", "webkit"],
        tolerance: 1e-12,
        note: "Includes Node child-process simulation startup, baseline replay retention and validation; not a native solver comparison.",
      },
      null,
      2,
    ),
  );
  console.log(
    `Node/browser grabm parity passed for ${expected.length} baseline, search and validation measurements in all three browsers.`,
  );
} finally {
  optimizer.dispose();
}
