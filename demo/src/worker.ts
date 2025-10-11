// Worker script for running WASM optimization
import init, { solve_json } from "../../pkg/index.js";
import type { OptimizationSpec } from "./types.js";

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

      // Define progress callback that forwards to main thread with worker ID
      const progressCallback = payload.progress_interval
        ? (progressData: any) => {
            // Add workerId to the progress data
            const dataWithWorkerId = {
              ...progressData,
              workerId: workerId,
            };
            self.postMessage({
              type: "PROGRESS",
              workerId: workerId,
              data: dataWithWorkerId,
            });
          }
        : undefined;

      // Call WASM solve_json with progress callback (payload is passed directly as JS object)
      const result = solve_json(payload as OptimizationSpec, progressCallback);
      const endTime = performance.now();

      // Add execution time to result and send
      self.postMessage({
        type: "SOLVE_SUCCESS",
        result: {
          ...result,
          executionTime: Math.round(endTime - startTime),
        },
      });
    } catch (error) {
      self.postMessage({
        type: "ERROR",
        error: `Optimization failed: ${(error as Error).message}`,
      });
    }
  }
};
