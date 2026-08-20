import { serveAdapter } from "@genetic-assembly/adapter-sdk";
import { referenceAdapter } from "./model.js";

await serveAdapter(referenceAdapter);
