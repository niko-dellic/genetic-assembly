import { createInterface } from "node:readline";

const protocol = "genetic-assembly-adapter-v1";
const mode = process.env.GA_ADAPTER_FIXTURE_MODE ?? "normal";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  const base = { protocol_version: protocol, request_id: request.request_id };
  if (request.type === "initialize") {
    process.stdout.write(`${JSON.stringify({ ...base, type: "initialized", adapter_version: "fixture-v1", capabilities: { operator_mode: "adapter", max_concurrency: 2, validate_front: false, materialize: true } })}\n`);
  } else if (request.type === "seed_population") {
    const genes = request.request.seeds.map((seed) => [Number(BigInt(seed) % 101n) / 100]);
    process.stdout.write(`${JSON.stringify({ ...base, type: "population_seeded", genes })}\n`);
  } else if (request.type === "make_offspring") {
    const candidates = request.requests.map((item) => ({ id: item.id, genes: [(item.left_genes[0] + item.right_genes[0]) / 2] }));
    process.stdout.write(`${JSON.stringify({ ...base, type: "offspring_created", candidates })}\n`);
  } else if (request.type === "evaluate_batch") {
    if (mode === "timeout") continue;
    if (mode === "malformed") {
      process.stdout.write("not-json\n");
      continue;
    }
    const candidates = request.candidates.map((candidate) => ({ id: candidate.id, genes: candidate.genes, evaluation: { objectives: [candidate.genes[0]], constraints: [], evidence: { metadata: { fixture: "true" } } } }));
    process.stdout.write(`${JSON.stringify({ ...base, type: "batch_evaluated", candidates })}\n`);
  } else if (request.type === "materialize") {
    const candidates = request.candidates.map((candidate) => ({ id: candidate.id, media_type: "application/json", data: { value: candidate.genes[0] } }));
    process.stdout.write(`${JSON.stringify({ ...base, type: "materialized", candidates })}\n`);
  } else if (request.type === "shutdown") {
    process.stdout.write(`${JSON.stringify({ ...base, type: "shutdown" })}\n`);
    break;
  }
}
