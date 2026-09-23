import {
  createHttpReader,
  openRunDataset,
  type DatasetReference,
} from "@grabm/abm/datasets";
/** Open the same immutable resources produced by grabm's Node dataset writer. Caller owns disposal. */
export function openGrabmReplay(
  baseUrl: string,
  reference: DatasetReference,
  fetcher?: typeof fetch,
) {
  return openRunDataset(createHttpReader(baseUrl, fetcher), reference);
}
/** Mount an inspectable graph and timeline from a retained grabm dataset. */
export async function mountGrabmReplay(
  container: HTMLElement,
  baseUrl: string,
  reference: DatasetReference,
  fetcher?: typeof fetch,
) {
  const source = await openGrabmReplay(baseUrl, reference, fetcher);
  let disposed = false;
  let revision = 0;
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Recorded grabm replay";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(source.scene.startMinute);
  slider.max = String(source.scene.endMinute);
  slider.step = "1";
  slider.value = slider.min;
  slider.setAttribute("aria-label", "Replay minute");
  const summary = document.createElement("pre");
  const host = document.createElement("div");
  container.append(heading, slider, host, summary);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 640 320");
  svg.style.width = "100%";
  host.append(svg);
  const nodes = source.scene.graph.nodes;
  const xs = nodes.map((n) => n.position.xM),
    ys = nodes.map((n) => n.position.yM);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    dx = Math.max(...xs) - minX || 1,
    dy = Math.max(...ys) - minY || 1;
  const point = (id: string) => {
    const n = nodes.find((n) => n.id === id)!;
    return [
      40 + (560 * (n.position.xM - minX)) / dx,
      40 + (240 * (n.position.yM - minY)) / dy,
    ];
  };
  for (const edge of source.scene.graph.edges) {
    if (edge.enabled === false) continue;
    const [x1, y1] = point(edge.sourceNodeId),
      [x2, y2] = point(edge.targetNodeId);
    const line = document.createElementNS(ns, "line");
    for (const [k, v] of Object.entries({
      x1,
      y1,
      x2,
      y2,
      stroke: "#709997",
      "stroke-width": 3,
    }))
      line.setAttribute(k, String(v));
    svg.append(line);
  }
  for (const node of nodes) {
    const [x, y] = point(node.id);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", "7");
    circle.setAttribute("fill", "#9be2cb");
    svg.append(circle);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(y - 12));
    label.setAttribute("fill", "currentColor");
    label.textContent = node.id;
    svg.append(label);
  }
  async function show() {
    const current = ++revision;
    const minute = Number(slider.value);
    const window = await source.window(minute);
    if (disposed || current !== revision) return;
    summary.textContent = JSON.stringify(
      {
        minute,
        locations: window.locations,
        trips: window.trips,
        programs: source.scene.facilities.map((f) => ({
          id: f.id,
          site: f.accessNodeId,
          capacity: f.capacity,
          activities: f.activities,
          classification: f.classification,
        })),
      },
      null,
      2,
    );
  }
  slider.oninput = () => {
    show().catch((error) => {
      summary.textContent = String(error);
    });
  };
  await show();
  return {
    source,
    dispose() {
      disposed = true;
      source.dispose();
      container.replaceChildren();
    },
  };
}
