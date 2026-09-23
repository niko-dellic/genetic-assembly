import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
export const packages = [
  "sdk",
  "grabm-integration",
  "inspector",
  "cli",
  "client",
  "visualizations",
];
const mode = process.argv[2] ?? "check";
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const output = join(root, "artifacts");
mkdirSync(output, { recursive: true });
const artifacts = [];
for (const folder of packages) {
  const directory = join(root, folder),
    manifest = JSON.parse(readFileSync(join(directory, "package.json")));
  if (manifest.version !== version) throw Error(`Version mismatch: ${folder}`);
  execFileSync(process.execPath, ["scripts/prepare-package.mjs", folder], {
    cwd: root,
    stdio: "inherit",
  });
  if (folder === "sdk")
    execFileSync(process.execPath, ["scripts/schemas.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
  if (folder === "cli") {
    const backend = join(directory, "backend");
    rmSync(backend, { recursive: true, force: true });
    mkdirSync(backend, { recursive: true });
    for (const path of [
      "Cargo.toml",
      "Cargo.lock",
      "Dockerfile",
      "crates",
      "inspector/public",
    ])
      cpSync(join(root, path), join(backend, path), { recursive: true });
  }
  if (mode === "build") continue;
  const stage = mkdtempSync(join(tmpdir(), "ga-package-"));
  try {
    for (const path of [...manifest.files, "README.md", "LICENSE"])
      cpSync(join(directory, path), join(stage, path), { recursive: true });
    for (const section of ["dependencies", "optionalDependencies"])
      for (const name of Object.keys(manifest[section] ?? {}))
        if (name.startsWith("@genetic-assembly/"))
          manifest[section][name] = version;
    delete manifest.devDependencies;
    delete manifest.scripts;
    writeFileSync(
      join(stage, "package.json"),
      JSON.stringify(manifest, null, 2),
    );
    const args = [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      output,
    ];
    if (mode === "check") args.push("--dry-run");
    const [packed] = JSON.parse(
      execFileSync("npm", args, { cwd: stage, encoding: "utf8" }),
    );
    for (const path of [
      "package.json",
      "README.md",
      "LICENSE",
      folder === "cli" ? "dist/cli.js" : "dist/index.js",
    ])
      if (!packed.files.some((f) => f.path === path))
        throw Error(`${manifest.name} missing ${path}`);
    if (
      packed.files.some((f) =>
        /^(dist\/.*\.(test|spec)\.|node_modules\/)/.test(f.path),
      )
    )
      throw Error("Development output in package");
    artifacts.push({
      name: manifest.name,
      version,
      filename: packed.filename,
      integrity: packed.integrity,
    });
    console.log(`${manifest.name}: ${packed.files.length} files`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
if (mode === "pack")
  writeFileSync(
    join(output, "manifest.json"),
    JSON.stringify(artifacts, null, 2) + "\n",
  );
