#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const command = process.argv[2] ?? "help";
const projectRoot = resolve(process.cwd());
const companionDirectory = join(projectRoot, ".genetic-assembly");

async function main(): Promise<void> {
  switch (command) {
    case "init":
      await initialize();
      break;
    case "up":
      await compose(["up", "-d", "--wait"]);
      break;
    case "down":
      await compose(["down"]);
      break;
    case "doctor":
      await doctor();
      break;
    case "test-adapter":
      await testAdapter();
      break;
    default:
      process.stdout.write(`Genetic Assembly local companion

Usage: ga <command>
  init          Scaffold .genetic-assembly without overwriting files
  up            Start the companion and Postgres
  down          Stop the local stack
  doctor        Check Docker and companion health
  test-adapter  Exercise initialize/evaluate/shutdown over NDJSON
`);
  }
}

async function initialize(): Promise<void> {
  await mkdir(companionDirectory, { recursive: true });
  await writeNew(join(companionDirectory, "compose.yml"), composeTemplate);
  await writeNew(join(companionDirectory, "problem.json"), problemTemplate);
  await writeNew(join(companionDirectory, "adapter.json"), adapterManifestTemplate);
  await writeNew(join(companionDirectory, "adapter.mjs"), adapterTemplate);
  await writeNew(join(companionDirectory, ".env"), "PROJECT_ROOT=..\nGA_SERVER_PORT=3001\nGA_POSTGRES_PORT=55433\n");
  process.stdout.write(`Created ${companionDirectory}\nRun "ga test-adapter", then "ga up".\n`);
}

async function writeNew(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    process.stdout.write(`Kept existing ${path}\n`);
  }
}

async function compose(args: string[]): Promise<void> {
  await requireFile(join(companionDirectory, "compose.yml"));
  const child = spawn("docker", ["compose", "--env-file", join(companionDirectory, ".env"),
    "-f", join(companionDirectory, "compose.yml"), ...args], {
    cwd: companionDirectory,
    stdio: "inherit",
  });
  const status = await new Promise<number>((resolveStatus) =>
    child.once("exit", (code) => resolveStatus(code ?? 1)));
  if (status !== 0) process.exitCode = status;
}

async function doctor(): Promise<void> {
  const docker = spawnSync("docker", ["version"], { stdio: "ignore" });
  process.stdout.write(`Docker: ${docker.status === 0 ? "available" : "unavailable"}\n`);
  const baseUrl = process.env.GA_SERVER_URL ?? "http://127.0.0.1:3001";
  try {
    const response = await fetch(`${baseUrl}/health`);
    process.stdout.write(`Companion: ${response.ok ? "healthy" : `HTTP ${response.status}`}\n`);
  } catch {
    process.stdout.write("Companion: not reachable (run ga up)\n");
  }
  await requireFile(join(companionDirectory, "problem.json"));
  await requireFile(join(companionDirectory, "adapter.mjs"));
  await requireFile(join(companionDirectory, "adapter.json"));
  process.stdout.write("Project scaffold: present\n");
}

async function testAdapter(): Promise<void> {
  const adapterPath = join(companionDirectory, "adapter.mjs");
  const problemPath = join(companionDirectory, "problem.json");
  await requireFile(adapterPath);
  await requireFile(problemPath);
  const problem = JSON.parse(await readFile(problemPath, "utf8")) as Record<string, unknown>;
  const child = spawn(process.execPath, [adapterPath], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const responses: unknown[] = [];
  lines.on("line", (line) => responses.push(JSON.parse(line)));
  const send = (value: unknown): void => {
    child.stdin.write(`${JSON.stringify(value)}\n`);
  };
  send({
    protocol_version: "genetic-assembly-adapter-v1",
    request_id: 1,
    type: "initialize",
    run_id: "cli-conformance",
    problem,
  });
  send({
    protocol_version: "genetic-assembly-adapter-v1",
    request_id: 2,
    type: "evaluate_batch",
    phase: "conformance",
    candidates: [{ id: 1, genes: [0] }],
  });
  send({ protocol_version: "genetic-assembly-adapter-v1", request_id: 3, type: "shutdown" });
  child.stdin.end();
  const status = await new Promise<number>((resolveStatus) =>
    child.once("exit", (code) => resolveStatus(code ?? 1)));
  if (status !== 0 || responses.length !== 3 ||
      (responses as { type?: string }[]).some((response) => response.type === "error"))
    throw new Error(`Adapter conformance failed: ${JSON.stringify(responses)}`);
  process.stdout.write("Adapter completed initialize, evaluate_batch, and shutdown.\n");
}

async function requireFile(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${path}; run ga init first.`);
  }
}

const composeTemplate = `services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: genetic_assembly
      POSTGRES_USER: genetic_assembly
      POSTGRES_PASSWORD: genetic_assembly
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U genetic_assembly -d genetic_assembly"]
      interval: 2s
      timeout: 3s
      retries: 20
    ports: ["\${GA_POSTGRES_PORT:-55433}:5432"]
    volumes: ["ga-postgres:/var/lib/postgresql/data"]
  companion:
    image: \${GA_IMAGE:-ghcr.io/niko-dellic/genetic-assembly:0.2.0}
    environment:
      DATABASE_URL: postgres://genetic_assembly:genetic_assembly@postgres:5432/genetic_assembly
      GA_BIND: 0.0.0.0:3001
      GA_ARTIFACT_ROOT: /var/lib/genetic-assembly/artifacts
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 2s
      timeout: 3s
      retries: 20
    ports: ["\${GA_SERVER_PORT:-3001}:3001"]
    volumes:
      - ga-artifacts:/var/lib/genetic-assembly/artifacts
      - \${PROJECT_ROOT:-..}:/workspace:ro
volumes:
  ga-postgres:
  ga-artifacts:
`;

const problemTemplate = `${JSON.stringify({
  schema_version: 1,
  name: "Starter problem",
  variable_ids: ["decision"],
  problem: {
    variables: [{ kind: "real", lower: 0, upper: 1 }],
    objectives: [{ name: "Decision", direction: "minimize" }],
  },
  constraints: [],
  artifacts: [],
  metadata: {},
}, null, 2)}\n`;

const adapterManifestTemplate = `${JSON.stringify({
  name: "starter-adapter",
  adapter_version: "starter-v1",
  protocol_version: "genetic-assembly-adapter-v1",
  command: "node",
  args: ["/workspace/.genetic-assembly/adapter.mjs"],
  working_directory: "/workspace",
  environment: {},
  timeout_ms: 300000,
  retry_limit: 1,
}, null, 2)}\n`;

const adapterTemplate = `import { createInterface } from "node:readline";
const protocol = "genetic-assembly-adapter-v1";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  const base = { protocol_version: protocol, request_id: request.request_id };
  let response;
  if (request.type === "initialize") response = { type: "initialized", adapter_version: "starter-v1", capabilities: { operator_mode: "builtin", max_concurrency: 1, validate_front: false, materialize: true } };
  else if (request.type === "evaluate_batch") response = { type: "batch_evaluated", candidates: request.candidates.map((candidate) => ({ id: candidate.id, genes: candidate.genes, evaluation: { objectives: [candidate.genes[0]], constraints: [] } })) };
  else if (request.type === "materialize") response = { type: "materialized", candidates: request.candidates.map((candidate) => ({ id: candidate.id, media_type: "application/json", data: { decision: candidate.genes[0] } })) };
  else if (request.type === "shutdown") response = { type: "shutdown" };
  else if (request.type === "cancel") response = { type: "cancelled" };
  else response = { type: "error", retryable: false, message: \`Unsupported request \${request.type}\` };
  process.stdout.write(JSON.stringify({ ...base, ...response }) + "\\n");
  if (request.type === "shutdown") break;
}
lines.close();
`;

await main();
