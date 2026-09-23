import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, graphDecisions, validateGraph } from "../dist/index.js";
import { checkStudy } from "@genetic-assembly/sdk/node";
import { baselineDecisions, validateStudy } from "@genetic-assembly/sdk";
import model from "./neighborhood.mjs";
const { baseline, space } = model.inputs;
test("moves geometry without changing demand or population", () => {
  const values = baselineDecisions(validateStudy(model));
  const changed = buildGraph(baseline, space, {
    ...values,
    "node.b.x": 150,
    "node.b.y": 0,
  });
  assert.equal(changed.graph.edges[0].lengthM, 150);
  assert.deepEqual(changed.scenario, baseline.scenario);
  assert.equal(baseline.graph.nodes[1].position.xM, 100);
});
test("required connectivity and capacity budgets produce explicit invalidity", () => {
  const changed = structuredClone(baseline);
  changed.graph.edges = [];
  assert.match(validateGraph(changed, space).join(";"), /connection/);
  changed.facilities[0].capacity = 100;
  assert.match(validateGraph(changed, space).join(";"), /budget/);
});
test("optional link activation is bounded and stable", () => {
  const values = baselineDecisions(validateStudy(model));
  const changed = buildGraph(baseline, space, {
    ...values,
    "edge.shortcut.enabled": true,
  });
  assert.equal(changed.graph.edges.length, 2);
  assert.equal(
    graphDecisions(baseline, space)["edge.shortcut.enabled"].baseline,
    false,
  );
});
test("packaged child process produces repeatable authored demand measurements", async () => {
  const checked = await checkStudy(model);
  assert.ok(Number.isFinite(checked.measurement.metrics.service));
  assert.ok(
    checked.measurement.metrics.service > 0 &&
      checked.measurement.metrics.service <= 1,
  );
});
test("program choice changes simulated activities, capacity and classification together", () => {
  const programs = {
    retail: {
      activities: { shopping: 1 },
      capacity: 4,
      classification: { landUseId: "retail", programmeId: "shop" },
    },
    service: {
      activities: { shopping: 0.5, health: 1 },
      capacity: 6,
      classification: { landUseId: "civic", programmeId: "clinic" },
    },
  };
  const custom = {
    facilities: { shop: { programs, baselineProgram: "retail" } },
  };
  const values = Object.fromEntries(
    Object.entries(graphDecisions(baseline, custom)).map(([key, d]) => [
      key,
      d.baseline,
    ]),
  );
  const changed = buildGraph(baseline, custom, {
    ...values,
    "facility.shop.program": "service",
  });
  const facility = changed.facilities.find((f) => f.id === "shop");
  assert.equal(facility.capacity, 6);
  assert.equal(facility.activities.health, 1);
  assert.equal(facility.classification.programmeId, "clinic");
});
test("declared numeric settings change only the selected parameter", () => {
  const custom = {
    settings: {
      speed: {
        path: ["scenario", "mobility", "modes", "walk", "speedMps"],
        lower: 1,
        upper: 2,
      },
    },
  };
  const changed = buildGraph(baseline, custom, { "setting.speed.value": 1.8 });
  assert.equal(changed.scenario.mobility.modes.walk.speedMps, 1.8);
  assert.deepEqual(changed.scenario.population, baseline.scenario.population);
  assert.throws(
    () =>
      graphDecisions(baseline, {
        settings: {
          count: {
            path: ["scenario", "population", "count"],
            lower: 1,
            upper: 3,
          },
        },
      }),
    /path/,
  );
});
test("endpoint choices preserve arbitrary stable identifiers", () => {
  const input = structuredClone(baseline);
  input.graph.nodes[0].id = "a|west";
  input.graph.edges[0].sourceNodeId = "a|west";
  input.facilities[0].accessNodeId = "a|west";
  const custom = {
    edges: {
      edge: {
        endpoints: [
          ["a|west", "b"],
          ["b", "a|west"],
        ],
      },
    },
  };
  const choices = graphDecisions(input, custom);
  const rebuilt = buildGraph(input, custom, {
    "edge.edge.endpoints": choices["edge.edge.endpoints"].baseline,
  });
  assert.equal(rebuilt.graph.edges[0].sourceNodeId, "a|west");
});
