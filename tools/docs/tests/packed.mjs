import { copyNeighborhood } from "./copy-neighborhood.mjs";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { extname } from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
  assert.equal(artifacts.length, 5);
  assert(!artifacts.some((a) => a.name.includes("grabm")));
  const paths = (names) =>
    artifacts
      .filter((a) => names.includes(a.name))
      .map((a) => resolve(root, "artifacts", a.filename));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      scripts: {
        "ga:run": "echo existing-command",
        test: "echo existing-test",
      },
    }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...paths(["@genetic-assembly/sdk", "@genetic-assembly/cli"]),
  ]);
  assert(!existsSync(join(directory, "node_modules/three")));
  assert(
    !existsSync(
      join(
        directory,
        "node_modules/@genetic-assembly/cli/backend/inspector/public/grabm.js",
      ),
    ),
  );
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
  const manifestBefore = readFileSync(join(directory, "package.json"), "utf8");
  const scripts = JSON.parse(manifestBefore).scripts;
  assert.equal(scripts["ga:run"], "echo existing-command");
  assert.equal(scripts.test, "echo existing-test");
  assert.equal(scripts["ga:check"], "ga check");
  run("npx", ["--no-install", "ga", "init"]);
  assert.equal(readFileSync(join(directory, "study.mjs"), "utf8"), before);
  assert.equal(
    readFileSync(join(directory, "package.json"), "utf8"),
    manifestBefore,
  );
  run("npm", ["run", "ga:check"]);
  run("node", [
    "node_modules/@genetic-assembly/cli/dist/cli.js",
    "run",
    "--population",
    "4",
    "--generations",
    "1",
    "--export",
    "local.ga.json",
  ]);
  assert(
    existsSync(
      join(directory, "node_modules/@genetic-assembly/sdk/dist/solver.wasm"),
    ),
  );
  writeFileSync(
    join(directory, "verify-local.mjs"),
    `import {readFileSync} from 'node:fs'; import {openArchive} from '@genetic-assembly/sdk'; const archive=await openArchive(readFileSync('local.ga.json')); if(archive.snapshot().runs[0].status!=='completed'||!archive.history().length)throw Error('Local archive acceptance failed');`,
  );
  run("node", ["verify-local.mjs"]);
  const inspectorProcess = spawn(
    process.execPath,
    [
      "node_modules/@genetic-assembly/cli/dist/cli.js",
      "inspect",
      "local.ga.json",
    ],
    { cwd: directory, stdio: ["ignore", "pipe", "pipe"] },
  );
  let inspectorBrowser;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(Error("Inspector startup timeout")),
        10000,
      );
      inspectorProcess.once("exit", (code) => {
        clearTimeout(timeout);
        reject(Error(`Inspector exited ${code}`));
      });
      inspectorProcess.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
    });
    inspectorBrowser = await chromium.launch({ headless: true });
    const page = await inspectorBrowser.newPage();
    await page.goto(url);
    await page
      .locator("[data-runs] button")
      .filter({ hasText: "completed" })
      .waitFor();
    assert.equal(await page.locator("[data-run]").isDisabled(), true);
    assert.equal(await page.locator("[data-replay]").isDisabled(), true);
    await page.locator("[data-runs] button").first().click();
    await page.locator("[data-history] table").waitFor();
  } finally {
    await inspectorBrowser?.close();
    inspectorProcess.kill("SIGTERM");
  }

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...paths([
      "@genetic-assembly/inspector",
      "@genetic-assembly/three",
      "@genetic-assembly/visualizations",
    ]),
    resolve(root, "examples/neighborhood/vendor/grabm-abm-0.1.0.tgz"),
    "three@0.185.1",
    "@types/three@0.185.1",
    "typescript@5.9.3",
    "@types/node@24",
    "esbuild",
    "vite@5.4.21",
  ]);
  assert(
    existsSync(join(directory, "node_modules/@grabm/abm/dist/node/child.js")),
  );
  for (const file of ["study.ts", "three.ts", "visualizations.ts"])
    cpSync(resolve(root, "tools/docs/snippets", file), join(directory, file));
  writeFileSync(
    join(directory, "browser.ts"),
    "export {StudyClient} from '@genetic-assembly/sdk';export {mountInspector} from '@genetic-assembly/inspector';",
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
  copyNeighborhood(root, directory);
  writeFileSync(
    join(directory, "index.html"),
    '<div id="status">Running</div><script type="module" src="/main.mjs"></script>',
  );
  writeFileSync(
    join(directory, "vite.config.mjs"),
    'export default {worker:{format:"es"},build:{outDir:"site",target:"esnext"}}',
  );
  writeFileSync(
    join(directory, "main.mjs"),
    `import {Optimizer,openArchive} from '@genetic-assembly/sdk'; import study from './study.mjs';
    const optimizer=new Optimizer(); try{await optimizer.baseline(study);const run=optimizer.run(study,{populationSize:4,generations:1,seed:42});await run.wait();const selected=run.results().validatedFront[0];await optimizer.replay(study,selected.decisions);const archive=await openArchive(await optimizer.export());window.acceptance={records:archive.history().length,datasets:Object.keys(archive.snapshot().datasets).length};}catch(error){window.acceptance={error:String(error)}}finally{optimizer.dispose()}`,
  );
  run("npx", ["--no-install", "vite", "build"]);
  const server = createServer((req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = join(directory, "site", path === "/" ? "index.html" : path);
      res.setHeader(
        "content-type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".wasm": "application/wasm",
        }[extname(file)] ?? "application/octet-stream",
      );
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.acceptance, {}, { timeout: 60000 });
    const result = await page.evaluate(() => window.acceptance);
    assert(!result.error, result.error);
    assert(result.records > 0);
    assert.equal(result.datasets, 4);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(
    "Independent tarballs passed: headless dependencies, schemas, backend source, CLI, declarations, browser builds and grabm child asset.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
