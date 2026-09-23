import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { instantiateSolver } from "./wasm-runtime.js";
const execute = await instantiateSolver(
  await readFile(new URL("./solver.wasm", import.meta.url)),
);
parentPort!.on("message", ({ id, command }) => {
  try {
    parentPort!.postMessage({ id, value: execute(command) });
  } catch (error) {
    parentPort!.postMessage({ id, error: String(error) });
  }
});
