import { defineGrabmStudy } from "@genetic-assembly/grabm";
/** One person leaves home at minute 10 to visit a shop over a 100-metre walking edge. */
const input = {
  graph: {
    nodes: [
      { id: "a", position: { xM: 0, yM: 0, zM: 0 }, kind: "place" },
      { id: "b", position: { xM: 100, yM: 0, zM: 0 }, kind: "place" },
    ],
    edges: [
      {
        id: "edge",
        sourceNodeId: "a",
        targetNodeId: "b",
        direction: "both",
        modes: ["walk"],
        lengthM: 100,
        capacityPersonsPerHour: 1000,
      },
    ],
  },
  facilities: [
    {
      id: "home",
      name: "Home",
      accessNodeId: "a",
      capacity: 8,
      availability: [{ startMinute: 0, endMinute: 120 }],
      attractiveness: 1,
      activities: { home: 1 },
      tags: ["home"],
    },
    {
      id: "shop",
      name: "Shop",
      accessNodeId: "b",
      capacity: 4,
      availability: [{ startMinute: 0, endMinute: 120 }],
      attractiveness: 1,
      activities: { shopping: 1 },
      tags: ["shopping"],
    },
  ],
  scenario: {
    profiles: [
      {
        id: "resident",
        demographics: { lifeStage: "adult" },
        preferences: { shopping: 1 },
        availableModes: ["walk"],
        decisionTemplates: [
          {
            id: "shopping",
            minute: { kind: "fixed", value: 10 },
            dwellMinutes: { kind: "fixed", value: 20 },
            activityIds: ["shopping"],
          },
        ],
      },
    ],
    population: {
      explicitAgents: Array.from({ length: 8 }, (_, i) => ({
        id: "person-" + i,
        cohortId: "resident",
        profileId: "resident",
        homeFacilityId: "home",
        needs: [
          {
            id: "shopping",
            activityId: "shopping",
            minute: 10,
            scope: "person",
            fulfillment: "pending",
          },
        ],
      })),
    },
    mobility: {
      modes: { walk: { enabled: true, speedMps: 1.4 } },
      congestion: { modes: [] },
    },
    behavior: {
      anchorAssignment: {},
      choice: { stayProbability: 0 },
      defaultDwellMinutes: { kind: "fixed", value: 30 },
      dwellMinutesByActivity: { shopping: { kind: "fixed", value: 20 } },
    },
  },
  run: {
    seed: 42,
    startMinute: 0,
    durationMinutes: 120,
    observationIntervalMinutes: 5,
  },
};

export default defineGrabmStudy({
  name: "Neighborhood services",
  version: "1",
  baseline: input,
  space: {
    nodes: { b: { x: [40, 180], y: [-40, 40] } },
    edges: {
      shortcut: {
        optional: true,
        template: {
          id: "shortcut",
          sourceNodeId: "a",
          targetNodeId: "b",
          direction: "both",
          modes: ["walk"],
          lengthM: 100,
          capacityPersonsPerHour: 1000,
        },
      },
    },
    facilities: { shop: { capacity: [2, 12] } },
    requiredConnections: [{ from: "a", to: "b", mode: "walk" }],
    requiredActivities: ["shopping"],
    limits: { maxCapacity: 20, maxEdgeLength: 400 },
  },
  searchSeeds: [42, 43],
  validationSeeds: [142, 143],
});
