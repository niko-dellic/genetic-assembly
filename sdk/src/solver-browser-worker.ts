import { instantiateSolver } from "./wasm-runtime.js";
const runtime = fetch(new URL("./solver.wasm", import.meta.url)).then(
  async (response) => {
    if (!response.ok)
      throw Error(`Cannot load solver WASM: ${response.status}`);
    return instantiateSolver(await response.arrayBuffer());
  },
);
self.onmessage = async ({ data: { id, command } }: MessageEvent) => {
  try {
    self.postMessage({ id, value: (await runtime)(command) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
