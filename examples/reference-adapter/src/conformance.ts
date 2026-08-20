import { readFile } from "node:fs/promises";
import { runConformanceSuite, type ProblemBundle } from "@genetic-assembly/adapter-sdk";
import { referenceAdapter } from "./model.js";

const problem = JSON.parse(
  await readFile(new URL("../problem.json", import.meta.url), "utf8"),
) as ProblemBundle;
await runConformanceSuite(referenceAdapter, problem);
process.stdout.write("Reference adapter conforms to genetic-assembly-adapter-v1.\n");
