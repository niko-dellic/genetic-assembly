import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.GA_SERVER_URL ?? "http://127.0.0.1:3001";
const adapterCommand = process.env.GA_ADAPTER_COMMAND ?? "node";
const adapterPath = process.env.GA_ADAPTER_PATH ??
  resolve("examples/reference-adapter/dist/adapter.js");
const adapterWorkingDirectory = process.env.GA_ADAPTER_WORKDIR ?? process.cwd();
const bundle = JSON.parse(await readFile("examples/reference-adapter/problem.json", "utf8"));

async function call(path, init = {}) {
  const response = await fetch(baseUrl + path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return JSON.parse(text);
}

const json = (value) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

const artifactBody = new TextEncoder().encode("companion-artifact-fixture");
const artifactFirst = await call("/v1/artifacts", {
  method: "POST",
  headers: { "content-type": "text/plain" },
  body: artifactBody,
});
const artifactSecond = await call("/v1/artifacts", {
  method: "POST",
  headers: { "content-type": "text/plain" },
  body: artifactBody,
});
if (artifactFirst.id !== artifactSecond.id || artifactFirst.content_hash !== artifactSecond.content_hash)
  throw new Error("Content-addressed artifact upload is not idempotent");
const downloaded = await (await fetch(`${baseUrl}/v1/artifacts/${artifactFirst.id}`)).text();
if (downloaded !== "companion-artifact-fixture") throw new Error("Artifact download did not round-trip");

const problem = await call("/v1/problems", json({ bundle }));
const adapter = await call("/v1/adapters", json({ launch: {
  name: "delivery-network-reference",
  adapter_version: "delivery-network-v1",
  protocol_version: "genetic-assembly-adapter-v1",
  command: adapterCommand,
  args: [adapterPath],
  working_directory: adapterWorkingDirectory,
  environment: {},
  timeout_ms: 10_000,
  retry_limit: 1,
} }));

async function execute() {
  const run = await call("/v1/runs", json({
    problem_revision_id: problem.id,
    adapter_revision_id: adapter.id,
    config: { population_size: 16, generations: 3, seed: 42 },
  }));
  let status = run;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (["completed", "failed", "cancelled"].includes(status.status)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    status = await call(`/v1/runs/${run.id}`);
  }
  if (status.status !== "completed") throw new Error(`Run ended as ${status.status}: ${status.error ?? ""}`);
  const results = await call(`/v1/runs/${run.id}/results`);
  const analytics = await call(`/v1/runs/${run.id}/analytics`);
  if (results.members.length === 0 || results.members.some((member) => member.materialization === undefined))
    throw new Error("Final front is missing project materializations");
  if (!analytics.history_complete || analytics.generations.length !== 3)
    throw new Error("Generation analytics are incomplete");
  return { run, results };
}

const first = await execute();
const second = await execute();
const signature = (result) => JSON.stringify(result.results.members.map((member) => ({
  genes: member.individual.genes,
  objectives: member.individual.objectives,
})));
if (signature(first) !== signature(second))
  throw new Error("Fixed-seed companion runs were not deterministic");

process.stdout.write(`Companion integration passed; run ${first.run.id}, ${first.results.members.length} Pareto members.\n`);
