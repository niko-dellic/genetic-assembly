import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** Copy example-owned code into a consumer; it is not an installable GA package. */
export function copyNeighborhood(root, destination) {
  cpSync(
    join(root, "examples/neighborhood/dist"),
    join(destination, "example"),
    { recursive: true },
  );
  const study = readFileSync(
    join(root, "examples/neighborhood/study.mjs"),
    "utf8",
  );
  writeFileSync(
    join(destination, "study.mjs"),
    study.replace("./dist/index.js", "./example/index.js"),
  );
}
