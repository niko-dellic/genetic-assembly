import type {
  AdapterLaunch,
  ArtifactResponse,
  Nsga2Config,
  ProblemBundle,
  Revision,
  RunAnalytics,
  RunEvent,
  RunResults,
  RunStatus,
} from "./types.js";

export * from "./types.js";

export class GeneticAssemblyApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "GeneticAssemblyApiError";
  }
}

export class CompanionClient {
  public constructor(
    public readonly baseUrl = "http://127.0.0.1:3001",
    private readonly token?: string,
  ) {}

  public uploadArtifact(data: BodyInit, mediaType = "application/octet-stream"): Promise<ArtifactResponse> {
    return this.request("/v1/artifacts", {
      method: "POST",
      headers: { "content-type": mediaType },
      body: data,
    });
  }

  public createProblem(bundle: ProblemBundle): Promise<Revision> {
    return this.request("/v1/problems", this.jsonBody({ bundle }));
  }

  public createAdapter(launch: AdapterLaunch): Promise<Revision> {
    return this.request("/v1/adapters", this.jsonBody({ launch }));
  }

  public startRun(
    problemRevisionId: string,
    adapterRevisionId: string,
    config: Nsga2Config = {},
  ): Promise<RunStatus> {
    return this.request("/v1/runs", this.jsonBody({
      problem_revision_id: problemRevisionId,
      adapter_revision_id: adapterRevisionId,
      config,
    }));
  }

  public getRun(id: string): Promise<RunStatus> { return this.request(`/v1/runs/${id}`); }
  public getResults(id: string): Promise<RunResults> { return this.request(`/v1/runs/${id}/results`); }
  public getAnalytics(id: string): Promise<RunAnalytics> { return this.request(`/v1/runs/${id}/analytics`); }
  public cancel(id: string): Promise<RunStatus> { return this.request(`/v1/runs/${id}/cancel`, { method: "POST" }); }

  public async subscribe(
    id: string,
    onEvent: (event: RunEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let lastEventId: string | undefined;
    const seenEventIds = new Set<string>();
    while (!signal?.aborted) {
      const headers = new Headers(this.authHeaders());
      if (lastEventId !== undefined) headers.set("last-event-id", lastEventId);
      const response = await fetch(`${this.baseUrl}/v1/runs/${id}/events`, { headers, signal });
      if (!response.ok || response.body === null)
        throw new Error((await response.text()) || `SSE failed: ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (!signal?.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split("\n");
          const eventId = lines.find((line) => line.startsWith("id:"))?.slice(3).trimStart();
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data !== "" && (eventId === undefined || !seenEventIds.has(eventId))) {
            const event = JSON.parse(data) as RunEvent;
            onEvent(event);
            if (
              event.type === "completed" || event.type === "failed" ||
              (event.type === "status" && ["completed", "failed", "cancelled"].includes(event.status))
            ) return;
          }
          if (eventId !== undefined) {
            seenEventIds.add(eventId);
            lastEventId = eventId;
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      await abortableDelay(750, signal);
    }
  }

  protected jsonBody(value: unknown): RequestInit {
    return {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    };
  }

  protected authHeaders(): HeadersInit {
    return this.token === undefined ? {} : { authorization: `Bearer ${this.token}` };
  }

  protected async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(this.authHeaders())) headers.set(key, value);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const text = await response.text();
      let body: unknown = text;
      let message = text || `${response.status} ${response.statusText}`;
      try {
        body = JSON.parse(text) as unknown;
        if (typeof body === "object" && body !== null && "error" in body)
          message = String((body as { error: unknown }).error);
      } catch {
        // Keep plain-text response.
      }
      throw new GeneticAssemblyApiError(message, response.status, body);
    }
    return response.json() as Promise<T>;
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const aborted = (): void => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}
