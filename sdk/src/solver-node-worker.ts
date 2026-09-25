import { errorDetail, OptimizationError } from "./errors.js";
import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { instantiateSolver } from "./wasm-runtime.js";
const asset = new URL("./solver.wasm", import.meta.url);
let runtime: ReturnType<typeof instantiateSolver> | undefined;
parentPort!.on("message", async ({ id, command }) => {
  try {
    runtime ??= readFile(asset)
      .then((bytes) => instantiateSolver(bytes))
      .catch((error) => {
        throw new OptimizationError(
          errorDetail(error, "wasm-loading", {
            code: "WASM_LOAD",
            asset: asset.href,
          }),
        );
      });
    parentPort!.postMessage({ id, value: (await runtime)(command) });
  } catch (error) {
    parentPort!.postMessage({ id, error: errorDetail(error, "solver") });
  }
});
