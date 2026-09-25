import { test } from "node:test";
import assert from "node:assert/strict";
import { Optimizer, defineStudy, collectPages } from "../dist/index.js";
const study = defineStudy({
  name: "contract",
  version: "1",
  inputs: {},
  decisions: { x: { kind: "real", lower: 0, upper: 1, baseline: 0.5 } },
  objectives: { value: { metric: "value", direction: "minimize" } },
  searchSeeds: [1, 2],
  validationSeeds: [3],
  evaluate(d) {
    return { metrics: { value: d.x } };
  },
});
test("local common contract: validation, filters, pagination, cancellation status and observation abort", async () => {
  const optimizer = new Optimizer();
  try {
    const run = await optimizer.run(study, {
      populationSize: 4,
      generations: 1,
      validate: false,
    });
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(run.wait(abort.signal), { name: "AbortError" });
    const status = await run.wait();
    assert.equal(status.status, "completed");
    assert.equal(status.progress.generation, 1);
    assert.deepEqual(await run.cancel(), status);
    assert.equal((await run.results()).validated.length, 0);
    assert.equal((await run.history({ phase: "validation" })).items.length, 0);
    const one = await run.history({
      phase: "search",
      status: "completed",
      limit: 1,
    });
    assert.equal(one.items.length, 1);
    assert.equal(one.nextOffset, 1);
    assert.equal(
      (await run.history({ candidateId: one.items[0].candidateId })).items
        .length,
      2,
    );
    assert.equal(
      (await run.generations({ offset: 1, limit: 1 })).nextOffset,
      null,
    );
    assert.equal(
      (await collectPages((o) => run.history({ ...o, limit: 3 }))).length,
      16,
    );
    const baseline = await optimizer.baseline(study);
    await baseline.wait();
    assert.deepEqual(Object.keys(await baseline.status()).sort(), [
      "id",
      "status",
    ]);
  } finally {
    optimizer.dispose();
  }
});
test("service shares defaults, run overrides and option validation before submission", async () => {
  const original = globalThis.fetch;
  const configs = [];
  globalThis.fetch = async (url, init) => {
    configs.push(JSON.parse(init.body));
    return Response.json({ id: "remote" });
  };
  try {
    const optimizer = new Optimizer({
      execution: "service",
      url: "http://example.invalid",
      evaluationConcurrency: 3,
    });
    await optimizer.run(
      { id: "study" },
      { validate: false, evaluationConcurrency: 2 },
    );
    await optimizer.run({ id: "study" }, {});
    assert.deepEqual(configs, [
      {
        population_size: 32,
        generations: 20,
        seed: 42,
        threads: 2,
        validate: false,
      },
      {
        population_size: 32,
        generations: 20,
        seed: 42,
        threads: 3,
        validate: true,
      },
    ]);
    for (const options of [
      { evaluationConcurrency: 0 },
      { seed: -1 },
      { populationSize: 1 },
      { generations: 1.5 },
      { validate: "false" },
    ])
      await assert.rejects(optimizer.run({ id: "study" }, options));
    assert.equal(configs.length, 2);
    assert.equal(optimizer.runHandle("remote").id, "remote");
    optimizer.dispose();
  } finally {
    globalThis.fetch = original;
  }
});

test("queued cancellation resolves without waiting for an unrelated operation; aborting a live observer preserves execution", async () => {
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const blocked = defineStudy({
    ...study,
    name: "blocked",
    evaluate: async (d) => {
      started();
      await gate;
      return { metrics: { value: d.x } };
    },
  });
  const optimizer = new Optimizer();
  try {
    const first = await optimizer.baseline(blocked);
    await ready;
    const observer = new AbortController();
    const waiting = first.wait(observer.signal);
    observer.abort();
    await assert.rejects(waiting, { name: "AbortError" });
    const queued = await optimizer.baseline(study);
    assert.equal((await queued.cancel()).status, "cancelled");
    assert.equal(
      (await queued.wait(AbortSignal.timeout(1000))).status,
      "cancelled",
    );
    assert.equal((await first.status()).status, "running");
    release();
    assert.equal((await first.wait()).status, "completed");
  } finally {
    release();
    optimizer.dispose();
  }
});
