import { Optimizer } from "../../dist/optimizer.js";
import type { PreparedStudy } from "../../dist/contracts.js";
export function verifyApi(study: PreparedStudy) {
  const service = new Optimizer({
    execution: "service",
    url: "http://127.0.0.1:3001",
  });
  return service.run(study, { populationSize: 4 });
}

import type {
  OperationHandle,
  OptimizationHandle,
  OptimizationResults,
  CandidateResult,
  StudyModel,
} from "../../dist/index.js";
export async function portableContract(
  study: PreparedStudy,
  model: StudyModel,
) {
  const service = new Optimizer({
    execution: "service",
    url: "http://127.0.0.1:3001",
    evaluationConcurrency: 2,
  });
  const local = new Optimizer();
  const searches: OptimizationHandle[] = [
    await local.run(model),
    await service.run(study),
  ];
  const jobs: OperationHandle<CandidateResult>[] = [
    await local.baseline(model),
    await service.baseline(study),
    await local.replay(model, {}),
    await service.replay(study, {}),
  ];
  for (const operation of [...searches, ...jobs]) {
    await operation.history({
      limit: 1,
      phase: "search",
      candidateId: "1",
      status: "completed",
    });
    await operation.wait(new AbortController().signal);
    (await operation.cancel()).status;
  }
}
