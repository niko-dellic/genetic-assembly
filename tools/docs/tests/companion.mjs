import { copyNeighborhood } from "./copy-neighborhood.mjs";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = realpathSync(mkdtempSync(join(tmpdir(), "ga-companion-")));
const project = `acceptance-${process.pid}`;
const port = Number(process.env.GA_TEST_PORT ?? 43171);
const run = (command, args, timeout = 300000) =>
  execFileSync(command, args, {
    cwd: directory,
    stdio: "inherit",
    timeout,
  });
try {
  const artifacts = JSON.parse(
    readFileSync(resolve(root, "artifacts/manifest.json")),
  );
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...artifacts
      .filter((a) =>
        ["@genetic-assembly/sdk", "@genetic-assembly/cli"].includes(a.name),
      )
      .map((a) => resolve(root, "artifacts", a.filename)),
    resolve(root, "examples/neighborhood/vendor/grabm-abm-0.1.0.tgz"),
  ]);
  run("npx", ["--no-install", "ga", "init"]);
  copyNeighborhood(root, directory);
  writeFileSync(
    join(directory, "ga.config.json"),
    JSON.stringify({
      entry: "study.mjs",
      files: ["study.mjs", "example"],
      project,
      port,
    }),
  );
  run("npx", ["--no-install", "ga", "check"]);
  run("npx", ["--no-install", "ga", "up"]);
  cpSync(
    resolve(root, "tools/docs/tests/study-acceptance.mjs"),
    join(directory, "acceptance.mjs"),
  );
  // Includes the crash-recovery lease wait as well as all normal run checks.
  run("node", ["acceptance.mjs", String(port)], 600000);
  cpSync(
    resolve(root, "tools/docs/tests/failure-acceptance.mjs"),
    join(directory, "failure.mjs"),
  );
  run("node", ["failure.mjs", String(port)]);
  console.log(
    "Docker consumer passed baseline, optimization, replay, history integrity, cache, determinism, cancellation and restart.",
  );
} finally {
  try {
    run("npx", ["--no-install", "ga", "cleanup", "--delete-data"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
