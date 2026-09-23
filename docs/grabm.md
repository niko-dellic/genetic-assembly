# Optimize a grabm neighborhood

Install the optional grabm integration alongside the SDK, CLI and grabm public tarball. Run `ga init --template grabm` in a fresh consumer project, then `ga check`, `ga baseline`, `ga run`, and `ga inspect`.

The executable template creates a synthetic neighborhood with eight fixed residents and eight authored shopping needs. A home and shop are connected by a walking edge. The study moves the shop access node within bounds, changes capacity, and optionally activates a declared parallel link. Population and authored demand remain fixed.

## Goals

- **Service** maximizes the fraction of authored needs whose outcome is not `unmet`. It requires authored needs; there is no trip-completion fallback.
- **Access** maximizes grabm analysis `accessibility.coverage15`.
- **Cost** minimizes a deliberately simple design proxy: sum of facility capacities, plus 10 per facility, plus 0.01 per metre of active edge. These are comparison units, not a financial estimate.

In this tiny neighborhood, all feasible layouts remain within a 15-minute walk, so `coverage15` stays at 1. The visible trade-off is fulfillment versus cost. For a distance-sensitive goal, supply custom measurements from grabm’s accessibility groups (for example `meanNearestMinutes`) and declare the corresponding direction and units.

Search seeds are 42 and 43; validation uses 142 and 143. Capacity and total link-length budgets constrain the search. The home-to-shop walking connection and shopping service remain required.

## Reuse the graph adapter

`defineGrabmStudy` accepts a baseline `SimulationInputData`, a bounded `space`, and optional objective/constraint mappings, custom measurements, deterministic repair and route-update hooks.

Declare stable slots for movable or optional nodes, optional links, allowed endpoint pairs, facility sites, program presets and capacities. Arbitrary graph invention is outside this interface. Required structures are preserved by leaving them outside optional slots and declaring connectivity/services.

Program presets change activities, capacity settings and classification together. A display label alone does not alter program behavior. Moving endpoints recomputes straight-line geometry. Curved routes or explicit travel-time overrides require an `updateRoute` rule before changing their endpoints.

In Node, each seed executes through grabm's public batch API with one child worker. In the browser it uses `Simulation` with an owned module worker; cancellation terminates that worker. Try the [live study](./live-neighborhood). Package assets, including the child entry point, remain in the immutable installed runtime. Baselines and selected replays use grabm's dataset writer, so they reopen through its public readers and playback tools.

[Full integration API](./api-reference/grabm/index.md) · [Replay](./replay.md)
