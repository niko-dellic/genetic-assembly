import { serveEvaluator } from "../../sdk/dist/index.js";
import model from "./study.mjs";
serveEvaluator(model.evaluate);
