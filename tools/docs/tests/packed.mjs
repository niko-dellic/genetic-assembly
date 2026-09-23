import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = realpathSync(mkdtempSync(join(tmpdir(), "ga-consumer-")));
const run = (command, args) =>
  execFileSync(command, args, { cwd: directory, stdio: "inherit" });
try {
  const artifacts = JSON.parse(
    readFileSync(resolve(root, "artifacts/manifest.json")),
  );
  const paths = (names) =>
    artifacts
      .filter((a) => names.includes(a.name))
      .map((a) => resolve(root, "artifacts", a.filename));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...paths(["@genetic-assembly/sdk", "@genetic-assembly/cli"]),
  ]);
  assert(!existsSync(join(directory, "node_modules/three")));
  for (const schema of ["study", "decision", "measurement", "evaluation"])
    assert(
      JSON.parse(
        readFileSync(
          join(
            directory,
            `node_modules/@genetic-assembly/sdk/schemas/${schema}.schema.json`,
          ),
        ),
      ).$schema,
    );
  assert(
    existsSync(
      join(
        directory,
        "node_modules/@genetic-assembly/cli/backend/crates/genetic-assembly-server/src/main.rs",
      ),
    ),
  );
  run("npx", ["--no-install", "ga", "init"]);
  const before = readFileSync(join(directory, "study.mjs"), "utf8");
  run("npx", ["--no-install", "ga", "init"]);
  assert.equal(readFileSync(join(directory, "study.mjs"), "utf8"), before);
  run("npx", ["--no-install", "ga", "check"]);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...paths([
      "@genetic-assembly/grabm",
      "@genetic-assembly/inspector",
      "@genetic-assembly/three",
      "@genetic-assembly/visualizations",
    ]),
    resolve(root, "vendor/grabm-abm-0.1.0.tgz"),
    "three@0.185.1",
    "@types/three@0.185.1",
    "typescript@5.9.3",
    "@types/node@24",
    "esbuild",
  ]);
  assert(
    existsSync(join(directory, "node_modules/@grabm/abm/dist/node/child.js")),
  );
  for (const file of ["study.ts", "three.ts", "visualizations.ts"])
    cpSync(resolve(root, "tools/docs/snippets", file), join(directory, file));
  writeFileSync(
    join(directory, "browser.ts"),
    "export {StudyClient} from '@genetic-assembly/sdk';export {mountInspector} from '@genetic-assembly/inspector';export {openGrabmReplay} from '@genetic-assembly/grabm/browser';",
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
      },
      include: ["*.ts"],
    }),
  );
  run("npx", ["--no-install", "tsc"]);
  run("npx", [
    "--no-install",
    "esbuild",
    "browser.ts",
    "three.ts",
    "visualizations.ts",
    "--bundle",
    "--platform=browser",
    "--format=esm",
    "--outdir=build",
  ]);
  console.log(
    "Independent tarballs passed: headless dependencies, schemas, backend source, CLI, declarations, browser builds and grabm child asset.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
