// Worker script for running WASM optimization
import init, { solve_json } from "../../pkg/genetic_assembly.js";

let isInitialized = false;
let workerId = 0;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === "INIT") {
    try {
      await init();
      isInitialized = true;
      workerId = e.data.workerId || 0;
      console.log(`Worker ${workerId} initialized`);
      self.postMessage({ type: "INIT_SUCCESS" });
    } catch (error) {
      self.postMessage({
        type: "ERROR",
        error: `Initialization failed: ${(error as Error).message}`,
      });
    }
    return;
  }

  if (type === "SOLVE") {
    if (!isInitialized) {
      self.postMessage({
        type: "ERROR",
        error: "Worker not initialized",
      });
      return;
    }

    try {
      const startTime = performance.now();
      const resultJson = solve_json(JSON.stringify(payload));
      const endTime = performance.now();

      const result = JSON.parse(resultJson);
      result.executionTime = Math.round(endTime - startTime);

      self.postMessage({
        type: "SOLVE_SUCCESS",
        result,
      });
    } catch (error) {
      self.postMessage({
        type: "ERROR",
        error: `Optimization failed: ${(error as Error).message}`,
      });
    }
  }
};
