#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  StudyClient,
  validateStudy,
  type Runtime,
  type StudySpec,
} from "@genetic-assembly/sdk";
import { checkStudy } from "@genetic-assembly/sdk/node";
const VERSION = "0.3.0";
const root = process.cwd(),
  directory = join(root, ".genetic-assembly"),
  packageRoot = fileURLToPath(new URL("../", import.meta.url));
interface Config {
  entry: string;
  files: string[];
  project: string;
  port: number;
  baseUrl?: string;
  image?: string;
  token?: string;
}
const args = process.argv.slice(2),
  command = args[0] ?? "help";
function run(executable: string, params: string[], capture = false) {
  const result = spawnSync(executable, params, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${executable} ${params[0]} failed (${result.status})`);
  return result.stdout ?? "";
}
function config(): Config {
  if (!existsSync(join(root, "ga.config.json")))
    throw Error("No ga.config.json. Run ga init from your project.");
  const c = JSON.parse(readFileSync(join(root, "ga.config.json"), "utf8"));
  if (
    !c.entry ||
    !Array.isArray(c.files) ||
    !c.project ||
    !/^[a-z][a-z0-9-]*$/.test(c.project) ||
    !Number.isInteger(c.port) ||
    c.port < 1024 ||
    c.port > 65535
  )
    throw Error(
      "Invalid ga.config.json: entry, files, project slug and port (1024–65535) are required",
    );
  return c;
}
const client = (c: Config) =>
  new StudyClient(
    c.baseUrl ?? `http://127.0.0.1:${c.port}`,
    process.env.GA_API_TOKEN ?? c.token,
  );
function writeNew(path: string, value: string) {
  if (!existsSync(path)) writeFileSync(path, value);
  else console.log(`Kept ${relative(root, path)}`);
}
function compose(c: Config, params: string[]) {
  return run("docker", [
    "compose",
    "-p",
    `ga-${c.project}-v2`,
    "-f",
    join(directory, "compose.json"),
    ...params,
  ]);
}
function safePath(path: string) {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (
    isAbsolute(path) ||
    rel.startsWith("..") ||
    rel
      .split(/[\\/]/)
      .some(
        (p) =>
          ["node_modules", ".git", ".env", ".genetic-assembly"].includes(p) ||
          p.startsWith(".env."),
      )
  )
    throw Error(`Do not include private or external path: ${path}`);
  return full;
}
async function snapshot(
  c: Config,
): Promise<{ spec: StudySpec; runtime: Runtime }> {
  if (c.baseUrl) {
    mkdirSync(directory, { recursive: true });
    const saved = JSON.parse(
      readFileSync(join(directory, "remote-runtime.json"), "utf8"),
    );
    const model = (await import(pathToFileURL(safePath(c.entry)).href)).default;
    return { spec: validateStudy(model), runtime: saved };
  }
  run("docker", ["version"]);
  mkdirSync(directory, { recursive: true });
  const context = join(directory, "build");
  rmSync(context, { recursive: true, force: true });
  mkdirSync(context, { recursive: true });
  const files = new Map<string, Buffer>();
  function collect(path: string) {
    const full = safePath(path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink())
      throw Error(`Snapshot cannot contain symlink: ${path}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(full)) collect(join(path, entry));
    } else files.set(path, readFileSync(full));
  }
  for (const path of new Set([
    c.entry,
    ...c.files,
    "package.json",
    "package-lock.json",
  ]))
    collect(path);
  const manifest = JSON.parse(files.get("package.json")!.toString());
  const lock = JSON.parse(files.get("package-lock.json")!.toString());
  // Vendor local tarballs without copying a host node_modules tree into Linux.
  const replacements = new Map<string, string>();
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ])
    for (const [name, value] of Object.entries(manifest[section] ?? {}))
      if (typeof value === "string" && value.startsWith("file:")) {
        const full = resolve(root, value.slice(5));
        if (!full.endsWith(".tgz") || !lstatSync(full).isFile())
          throw Error(
            `${name}: use a local .tgz package rather than a directory dependency`,
          );
        const bytes = readFileSync(full),
          filename =
            "vendor/" +
            createHash("sha256").update(bytes).digest("hex") +
            ".tgz";
        files.set(filename, bytes);
        replacements.set(value, "file:" + filename);
        manifest[section][name] = "file:" + filename;
      }
  for (const data of Object.values(lock.packages ?? {}) as any[]) {
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ])
      for (const [name, value] of Object.entries(data[section] ?? {}))
        if (replacements.has(String(value)))
          data[section][name] = replacements.get(String(value));
    if (replacements.has(data.resolved))
      data.resolved = replacements.get(data.resolved);
  }
  for (const [path, data] of Object.entries(lock.packages ?? {}) as [
    string,
    any,
  ][]) {
    if (path.startsWith("node_modules/")) {
      const name = path.slice("node_modules/".length);
      const value =
        manifest.dependencies?.[name] ??
        manifest.devDependencies?.[name] ??
        manifest.optionalDependencies?.[name];
      if (typeof value === "string" && value.startsWith("file:vendor/"))
        data.resolved = value;
    }
  }
  files.set("package.json", Buffer.from(JSON.stringify(manifest)));
  files.set("package-lock.json", Buffer.from(JSON.stringify(lock)));
  const base = c.image ?? `genetic-assembly:${VERSION}`;
  if (
    !c.image &&
    spawnSync("docker", ["image", "inspect", base], { stdio: "ignore" })
      .status !== 0
  )
    run("docker", ["build", "-t", base, join(packageRoot, "backend")]);
  const baseIdentity = run(
    "docker",
    ["image", "inspect", base, "--format", "{{.Id}}"],
    true,
  ).trim();
  const digest = createHash("sha256").update(VERSION).update(baseIdentity);
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    digest.update(path).update("\0").update(bytes);
  const identity = digest.digest("hex");
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(context, path)), { recursive: true });
    writeFileSync(join(context, path), bytes);
  }
  writeFileSync(
    join(context, "runner.mjs"),
    `import model from ${JSON.stringify("./" + c.entry.split("\\").join("/"))};\nimport {serveStudy} from '@genetic-assembly/sdk/node';\nawait serveStudy(model);\n`,
  );
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM ${base}\nWORKDIR /opt/project\nCOPY . .\nRUN npm ci --omit=dev --ignore-scripts\n`,
  );
  const image = `ga-${c.project}:${identity}`;
  if (
    spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" })
      .status !== 0
  )
    run("docker", ["build", "-t", image, context]);
  const volume = `ga-${c.project}-snapshots-v2`;
  run("docker", ["volume", "create", volume]);
  run("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "node",
    "-v",
    `${volume}:/snapshots`,
    image,
    "--input-type=module",
    "-e",
    `import {existsSync,cpSync,renameSync,rmSync} from 'node:fs'; const dest='/snapshots/${identity}';if(!existsSync(dest)){rmSync(dest+'.pending',{recursive:true,force:true});cpSync('/opt/project',dest+'.pending',{recursive:true});renameSync(dest+'.pending',dest);}`,
  ]);
  const spec = JSON.parse(
    run(
      "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "node",
        image,
        "--input-type=module",
        "-e",
        `import model from ${JSON.stringify("./" + c.entry.split("\\").join("/"))};import {validateStudy} from '@genetic-assembly/sdk';console.log(JSON.stringify(validateStudy(model)));`,
      ],
      true,
    ),
  );
  writeFileSync(
    join(directory, "compose.json"),
    JSON.stringify(
      {
        services: {
          postgres: {
            image: "postgres:17-alpine",
            environment: {
              POSTGRES_DB: "genetic_assembly",
              POSTGRES_USER: "genetic_assembly",
              POSTGRES_PASSWORD: "local-study",
            },
            volumes: ["database:/var/lib/postgresql/data"],
            healthcheck: {
              test: [
                "CMD-SHELL",
                "pg_isready -U genetic_assembly -d genetic_assembly",
              ],
              interval: "2s",
              timeout: "3s",
              retries: 30,
            },
          },
          companion: {
            image: base,
            environment: {
              DATABASE_URL:
                "postgres://genetic_assembly:local-study@postgres:5432/genetic_assembly",
              GA_BIND: "0.0.0.0:3001",
              GA_ARTIFACT_ROOT: "/var/lib/genetic-assembly",
              ...(c.token ? { GA_API_TOKEN: c.token } : {}),
            },
            ports: [`127.0.0.1:${c.port}:3001`],
            volumes: [
              "artifacts:/var/lib/genetic-assembly",
              `${volume}:/opt/studies:ro`,
            ],
            depends_on: { postgres: { condition: "service_healthy" } },
            healthcheck: {
              test: [
                "CMD",
                "node",
                "-e",
                "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
              ],
              interval: "2s",
              timeout: "3s",
              retries: 30,
            },
          },
        },
        volumes: { database: {}, artifacts: {}, [volume]: { external: true } },
      },
      null,
      2,
    ),
  );
  return {
    spec,
    runtime: {
      command: "node",
      args: [`/opt/studies/${identity}/runner.mjs`],
      workingDirectory: `/opt/studies/${identity}`,
      identity,
      timeoutMs: 300000,
    },
  };
}
async function prepare(c: Config) {
  const prepared = await snapshot(c);
  if (!c.baseUrl) compose(c, ["up", "-d", "--wait"]);
  const study = await client(c).prepare(prepared.spec, prepared.runtime);
  writeFileSync(join(directory, "study.json"), JSON.stringify(study, null, 2));
  return study;
}
async function main() {
  if (command === "init") {
    mkdirSync(directory, { recursive: true });
    writeNew(
      join(root, "ga.config.json"),
      JSON.stringify(
        {
          entry: "study.mjs",
          files: ["study.mjs"],
          project: "my-study",
          port: 3001,
        },
        null,
        2,
      ) + "\n",
    );
    const template = args[args.indexOf("--template") + 1];
    writeNew(
      join(root, "study.mjs"),
      template === "grabm"
        ? readFileSync(join(packageRoot, "templates/grabm.mjs"), "utf8")
        : sample,
    );
    console.log(
      "Created study.mjs and ga.config.json. Run ga check, ga up, ga baseline, ga run, then ga inspect.",
    );
    return;
  }
  if (command === "help") {
    console.log(
      "ga init [--template grabm] | check | up | baseline | run | inspect | status | logs | down | backup <directory> | cleanup\nModels use study.mjs; ga.config.json declares snapshot files. Storage uses a separate v2 namespace.",
    );
    return;
  }
  const c = config();
  if (command === "check") {
    const model = (await import(pathToFileURL(safePath(c.entry)).href)).default;
    console.log(JSON.stringify(await checkStudy(model), null, 2));
    return;
  }
  if (command === "up") {
    console.log(JSON.stringify(await prepare(c), null, 2));
    return;
  }
  if (command === "down" || command === "logs") {
    compose(c, command === "down" ? ["down"] : ["logs", "--tail", "100"]);
    return;
  }
  if (command === "backup") {
    if (!args[1]) throw Error("Specify a new backup directory");
    const destination = resolve(args[1]);
    if (existsSync(destination)) throw Error("Backup directory already exists");
    mkdirSync(destination, { recursive: true });
    const sql = run(
      "docker",
      [
        "compose",
        "-p",
        `ga-${c.project}-v2`,
        "-f",
        join(directory, "compose.json"),
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "-U",
        "genetic_assembly",
        "genetic_assembly",
      ],
      true,
    );
    writeFileSync(join(destination, "database.sql"), sql);
    for (const [name, volume] of [
      ["artifacts", `ga-${c.project}-v2_artifacts`],
      ["snapshots", `ga-${c.project}-snapshots-v2`],
    ])
      run("docker", [
        "run",
        "--rm",
        "--entrypoint",
        "tar",
        "-v",
        `${volume}:/source:ro`,
        "-v",
        `${destination}:/backup`,
        c.image ?? `genetic-assembly:${VERSION}`,
        "-cf",
        `/backup/${name}.tar`,
        "-C",
        "/source",
        ".",
      ]);
    writeFileSync(
      join(destination, "ga.config.json"),
      JSON.stringify(c, null, 2),
    );
    console.log(
      `Backed up metadata, artifacts and snapshots to ${destination}`,
    );
    return;
  }
  if (command === "cleanup") {
    if (!args.includes("--delete-data"))
      throw Error(
        "Cleanup deletes this project’s v2 database, artifacts and snapshots. Add --delete-data to request it explicitly.",
      );
    compose(c, ["down", "--volumes"]);
    run("docker", ["volume", "rm", `ga-${c.project}-snapshots-v2`]);
    return;
  }
  const api = client(c);
  const saved = existsSync(join(directory, "study.json"))
    ? JSON.parse(readFileSync(join(directory, "study.json"), "utf8"))
    : null;
  if (command === "status") {
    console.log(
      JSON.stringify(
        {
          health: await api.request("/health"),
          studies: await api.studies(),
          ...(saved
            ? { runs: await api.runs(saved.id), jobs: await api.jobs(saved.id) }
            : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "inspect") {
    const url = api.baseUrl;
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    try {
      run(opener, process.platform === "win32" ? ["/c", "start", url] : [url]);
    } catch {}
    console.log(url);
    return;
  }
  if (command === "baseline" || command === "run") {
    const study = await prepare(c);
    if (command === "baseline") {
      const job = await api.baseline(study.id);
      console.log(`Baseline ${job.id}`);
      const result = await api.waitJob(job.id);
      if (result.status !== "completed")
        throw Error(result.error ?? result.status);
      console.log(JSON.stringify(result, null, 2));
    } else {
      const value = (flag: string, fallback: number) => {
        const i = args.indexOf(flag);
        return i < 0 ? fallback : Number(args[i + 1]);
      };
      const run = await api.run(study.id, {
        population_size: value("--population", 24),
        generations: value("--generations", 8),
        seed: value("--seed", 42),
      });
      for await (const status of run.progress())
        console.log(
          `${status.status}: generation ${status.current_generation}`,
        );
      const status = await run.status();
      if (status.status !== "completed")
        throw Error(status.error ?? status.status);
      writeFileSync(
        join(directory, `run-${run.id}.json`),
        JSON.stringify(await run.export(), null, 2),
      );
      console.log(
        `Exported run ${run.id}. Open ga inspect to compare designs.`,
      );
    }
    return;
  }
  throw Error("Unknown command: " + command);
}
const sample = `import {defineStudy} from '@genetic-assembly/sdk/node';
export default defineStudy({
 name:'Two targets',version:'1',inputs:{},
 decisions:{x:{kind:'real',lower:0,upper:1,baseline:0.5}},
 objectives:{left:{metric:'left',direction:'minimize'},right:{metric:'right',direction:'minimize'}},
 searchSeeds:[42,43],validationSeeds:[142,143],
 evaluate:({x})=>({metrics:{left:x*x,right:(1-x)*(1-x)}}),
 materialize:decisions=>decisions,
});\n`;
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
