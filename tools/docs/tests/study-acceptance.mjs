import { StudyClient, openArchive } from "@genetic-assembly/sdk";
import { openGrabmReplay } from "./example/browser.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const api = new StudyClient(`http://127.0.0.1:${process.argv[2]}`);
const study = JSON.parse(readFileSync(".genetic-assembly/study.json"));
const timeout = () => AbortSignal.timeout(120000);
const baseline = await api.baseline(study.id);
const baselineStatus = await api.waitJob(baseline.id, timeout());
assert.equal(
  baselineStatus.status,
  "completed",
  JSON.stringify(baselineStatus),
);
const base = (await api.history(baseline.id)).items;
assert.equal(base.length, 2);
assert.ok(base[0].metrics.service > 0);
const datasets = await api.datasets(baseline.id);
assert.equal(datasets.length, 2);
async function reopen() {
  const source = await openGrabmReplay(
    api.datasetUrl(datasets[0].id),
    datasets[0],
  );
  try {
    assert.equal(source.summary.counts.agents, 8);
    assert.ok((await source.window(10)).trips.length);
    assert.ok(await source.input());
  } finally {
    source.dispose();
  }
}
await reopen();
async function all(owner) {
  let offset = 0;
  const rows = [];
  for (;;) {
    const page = await api.history(owner, { offset });
    rows.push(...page.items);
    if (page.nextOffset === null) return rows;
    offset = page.nextOffset;
  }
}
const run = await api.run(study.id, {
  population_size: 8,
  generations: 2,
  seed: 42,
  threads: 1,
});
assert.equal((await run.wait(timeout())).status, "completed");
const rows = await all(run.id);
assert.ok(rows.some((r) => r.phase === "validation"));
const result = await run.results();
assert.ok(result.search.members.length);
assert.ok(result.validated.length);
assert.ok(
  rows
    .filter((r) => r.phase === "validation")
    .every((r) => study.spec.validationSeeds.includes(r.seed)),
);
const record = rows.find((r) => r.status === "completed");
await api.request("/v2/evaluations", {
  method: "POST",
  body: JSON.stringify(record),
});
assert.equal((await all(run.id)).length, rows.length);
await assert.rejects(
  api.request("/v2/evaluations", {
    method: "POST",
    body: JSON.stringify({
      ...record,
      metrics: { ...record.metrics, cost: record.metrics.cost + 1 },
    }),
  }),
);
const repeat = await api.run(study.id, {
  population_size: 8,
  generations: 2,
  seed: 42,
  threads: 2,
});
assert.equal((await repeat.wait(timeout())).status, "completed");
const repeated = await all(repeat.id);
const normalize = (values) =>
  values
    .map((r) => ({
      candidate: r.candidateId,
      phase: r.phase,
      seed: r.seed,
      decisions: r.decisions,
      metrics: r.metrics,
      status: r.status,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
assert.deepEqual(normalize(repeated), normalize(rows));
assert.ok(repeated.some((r) => r.cached));
const replay = await api.replay(study.id, record.decisions);
assert.equal((await api.waitJob(replay.id, timeout())).status, "completed");
assert.equal((await api.datasets(replay.id)).length, 2);
const cancel = await api.run(study.id, {
  population_size: 24,
  generations: 100,
  seed: 5,
});
await cancel.cancel();
assert.equal((await cancel.wait(timeout())).status, "cancelled");
execFileSync(
  "docker",
  [
    "compose",
    "-p",
    `ga-${JSON.parse(readFileSync("ga.config.json")).project}-v4`,
    "-f",
    ".genetic-assembly/compose.json",
    "restart",
    "companion",
  ],
  { stdio: "inherit" },
);
for (let i = 0; ; i++) {
  try {
    await api.request("/health");
    break;
  } catch (e) {
    if (i > 100) throw e;
    await new Promise((r) => setTimeout(r, 100));
  }
}
await reopen();
const portable = await openArchive(await run.archive());
assert.equal(portable.snapshot().provenance.execution, "service");
assert.ok(portable.history(baseline.id).length);
assert.equal(
  portable.dataset(datasets[0].id).manifestKey,
  datasets[0].manifestKey,
);
assert.ok(
  !JSON.stringify(portable.snapshot().provenance).includes("GA_API_TOKEN"),
);

assert.equal((await all(run.id)).length, rows.length);
assert.equal((await run.status()).status, "completed");
assert.equal((await run.export()).evaluations.length, rows.length);
console.log("Verified", rows.length, "seed evaluations and durable datasets");

const recovery = await api.run(study.id, {
  population_size: 8,
  generations: 3,
  seed: 987,
});
for (let i = 0; ; i++) {
  const records = await all(recovery.id);
  if (records.length > 0) break;
  if (i > 200) throw Error("Recovery run never evaluated");
  await new Promise((r) => setTimeout(r, 50));
}
execFileSync(
  "docker",
  [
    "compose",
    "-p",
    `ga-${JSON.parse(readFileSync("ga.config.json")).project}-v4`,
    "-f",
    ".genetic-assembly/compose.json",
    "restart",
    "companion",
  ],
  { stdio: "inherit" },
);
for (let i = 0; ; i++) {
  try {
    await api.request("/health");
    break;
  } catch (e) {
    if (i > 100) throw e;
    await new Promise((r) => setTimeout(r, 100));
  }
}
// A crashed executor retains its two-minute lease (executor.rs). Recovery must
// allow that lease to expire before spending the normal execution budget.
const recoveryTimeout = AbortSignal.timeout(120000 + 120000);
console.log("Waiting for the executor lease to expire and the run to recover");
assert.equal((await recovery.wait(recoveryTimeout)).status, "completed");
const recovered = await all(recovery.id);
assert.equal(new Set(recovered.map((r) => r.id)).size, recovered.length);
const control = await api.run(study.id, {
  population_size: 8,
  generations: 3,
  seed: 987,
  threads: 2,
});
assert.equal((await control.wait(timeout())).status, "completed");
assert.deepEqual(normalize(await all(control.id)), normalize(recovered));
console.log(
  "Compatible running-job recovery reproduced measurements without duplicate identities",
);
