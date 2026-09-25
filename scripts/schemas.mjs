import {operationEventSchema,generationSnapshotSchema,candidateResultSchema,errorDetailSchema} from "../sdk/dist/observation.js";
import {archiveSchema} from "../sdk/dist/archive.js";
import { z } from "../sdk/node_modules/zod/index.js";
import {
  studySpecSchema,
  evaluationSchema,
  measurementSchema,
  decisionSchema,
} from "../sdk/dist/contracts.js";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("sdk/schemas", { recursive: true });
for (const [name, schema] of Object.entries({
  archive: archiveSchema,
  event: operationEventSchema,
  generation: generationSnapshotSchema,
  candidate: candidateResultSchema,
  error: errorDetailSchema,
  study: studySpecSchema,
  evaluation: evaluationSchema,
  measurement: measurementSchema,
  decision: decisionSchema,
}))
  writeFileSync(
    `sdk/schemas/${name}.schema.json`,
    JSON.stringify(
      z.toJSONSchema(schema, { unrepresentable: "any" }),
      null,
      2,
    ) + "\n",
  );
