import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const server = createServer(async (req, res) => {
  try {
    res.setHeader(
      "content-type",
      req.url.endsWith(".js") ? "text/javascript" : "text/html",
    );
    res.end(
      await readFile(
        new URL(
          "../../../inspector/public/" +
            (req.url === "/" ? "index.html" : req.url.slice(1)),
          import.meta.url,
        ),
      ),
    );
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  let empty = true;
  const statuses = ["running", "failed", "cancelled", "completed"];
  const study = {
    id: "study",
    spec: {
      name: "Inspector example",
      version: "1",
      objectives: {
        cost: { metric: "cost", direction: "minimize", unit: "units" },
        service: { metric: "service", direction: "maximize", unit: "fraction" },
      },
      searchSeeds: [1],
      validationSeeds: [2],
    },
  };
  await page.route("**/v3/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let value = { items: [], nextOffset: null };
    if (path === "/v3/studies")
      value = { items: empty ? [] : [study], nextOffset: null };
    else if (path.endsWith("/runs") && route.request().method() === "GET")
      value = {
        items: statuses.map((status) => ({
          id: status,
          status,
          current_generation: 1,
        })),
        nextOffset: null,
      };
    else if (path.startsWith("/v3/runs/") && path.endsWith("/results"))
      value = { search: { pareto_front: [] }, validated: [], validatedFront: [] };
    else if (path.startsWith("/v3/runs/")) {
      const status = path.split("/")[3];
      value = {
        id: status,
        status,
        current_generation: 1,
        error: status === "failed" ? "Deliberate model error" : null,
      };
    } else if (path.startsWith("/v3/history/"))
      value = {
        items: [
          {
            id: "evaluation",
            ownerId: path.split("/")[3],
            candidateId: "candidate",
            phase: "search",
            seed: 1,
            status: "completed",
            metrics: { cost: 3, service: 0.5 },
            constraints: { domain_validity: 0 },
            decisions: { x: 1 },
            warnings: [],
            repairs: [],
          },
        ],
        nextOffset: null,
      };
    else if (path === "/v3/datasets") value = [];
    return route.fulfill({ json: value });
  });
  await page.goto(base);
  await page.getByText("No studies yet.", { exact: false }).waitFor();
  empty = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: /running · generation/ }).click();
  await page
    .getByText("Run running: results will appear after completion.")
    .waitFor();
  await page.getByRole("button", { name: /failed · generation/ }).click();
  await page.getByText("Run failed: Deliberate model error").waitFor();
  await page.getByRole("button", { name: /cancelled · generation/ }).click();
  await page.getByText(/Run cancelled: completed generation history remains available/).waitFor();
  await page.getByRole("button", { name: /completed · generation/ }).click();
  await page.getByRole("button", { name: "candidate", exact: true }).click();
  await page.getByText("Selected search mean ± SD", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/genetic-assembly-inspector.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Inspector empty/running/failed/cancelled/completed states and comparison passed.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
