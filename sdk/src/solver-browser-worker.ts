import { errorDetail, OptimizationError } from "./errors.js";
import { instantiateSolver } from "./wasm-runtime.js";
const asset = new URL("./solver.wasm", import.meta.url);
let runtime:
  | Promise<
      ReturnType<typeof instantiateSolver> extends Promise<infer T> ? T : never
    >
  | undefined;
function load() {
  return (runtime ??= (async () => {
    try {
      const response = await fetch(asset);
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return await instantiateSolver(await response.arrayBuffer());
    } catch (error) {
      throw new OptimizationError(
        errorDetail(error, "wasm-loading", {
          code: "WASM_LOAD",
          asset: asset.href,
        }),
      );
    }
  })());
}
self.onmessage = async ({ data: { id, command } }: MessageEvent) => {
  try {
    self.postMessage({ id, value: (await load())(command) });
  } catch (error) {
    self.postMessage({ id, error: errorDetail(error, "solver") });
  }
};
