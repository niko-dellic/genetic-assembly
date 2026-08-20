import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const workspaces = [
  "headless-client",
  "adapter-sdk",
  "cli",
  "examples/reference-adapter",
  "client",
  "visualizations",
  "demo",
];

if (await dependenciesNeedSetup()) {
  console.log("Workspace dependencies are missing or stale; installing them now.\n");
  const setupStatus = await run(npm, ["run", "setup"]);
  if (setupStatus !== 0) process.exit(setupStatus);
}

// The reference adapter is executable code launched by the companion, so a
// clean checkout needs these ignored build artifacts before a generic run.
for (const buildScript of ["adapter-sdk:build", "reference:build"]) {
  const buildStatus = await run(npm, ["run", buildScript]);
  if (buildStatus !== 0) process.exit(buildStatus);
}

const backendStatus = await run("docker", [
  "compose", "up", "-d", "--build", "--wait", "postgres", "server",
]);
if (backendStatus !== 0) process.exit(backendStatus);

console.log("\nCompanion API is healthy at http://127.0.0.1:3001");
console.log("Starting the frontend. Ctrl+C stops the UI; `npm run down` stops the backend.\n");

const frontendStatus = await run(npm, [
  "--prefix", "demo", "run", "dev",
]);
process.exitCode = frontendStatus;

async function dependenciesNeedSetup() {
  for (const workspace of workspaces) {
    try {
      const lock = await stat(resolve(root, workspace, "package-lock.json"));
      const installed = await stat(resolve(root, workspace, "node_modules/.package-lock.json"));
      if (lock.mtimeMs > installed.mtimeMs) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function run(command, args) {
  return new Promise((resolveStatus, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal === "SIGINT" || signal === "SIGTERM") resolveStatus(0);
      else resolveStatus(code ?? 1);
    });
  });
}
