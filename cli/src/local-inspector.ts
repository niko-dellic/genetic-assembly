import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Optimizer, openArchive, type StudyModel } from "@genetic-assembly/sdk";
/** Temporary loopback inspector. Closing it never creates durable background services. */
export async function serveLocalInspector(options: {
  assets: string;
  optimizer?: Optimizer;
  model?: StudyModel;
  archive?: Uint8Array;
  port?: number;
}) {
  if (options.archive) await openArchive(options.archive);
  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin)
      ) {
        response.writeHead(403).end();
        return;
      }
      const path = new URL(request.url ?? "/", origin).pathname;
      response.setHeader("cache-control", "no-store");
      if (request.method === "GET" && path === "/archive") {
        response.setHeader("content-type", "application/json");
        response.end(options.archive ?? (await options.optimizer!.export()));
        return;
      }
      if (
        request.method === "GET" &&
        ["/inspector.js", "/grabm.js"].includes(path)
      ) {
        response.setHeader("content-type", "text/javascript");
        response.end(readFileSync(join(options.assets, path.slice(1))));
        return;
      }
      if (
        request.method === "POST" &&
        path === "/action" &&
        options.optimizer &&
        options.model
      ) {
        if (request.headers["content-type"] !== "application/json") {
          response.writeHead(415).end();
          return;
        }
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 65536) throw Error("Request too large");
        }
        const action = JSON.parse(body);
        let result: unknown;
        if (action.op === "baseline")
          result = await options.optimizer.baseline(options.model);
        else if (action.op === "replay")
          result = await options.optimizer.replay(
            options.model,
            action.decisions,
          );
        else if (action.op === "run")
          result = {
            id: options.optimizer.run(options.model, {
              populationSize: 24,
              generations: 8,
              seed: 42,
            }).id,
          };
        else if (action.op === "cancel")
          result = options.optimizer.runHandle(action.id).cancel();
        else throw Error("Unknown action");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(result ?? null));
        return;
      }
      if (request.method === "GET" && path === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genetic Assembly inspector</title></head><body><div id="app"></div><div id="replay"></div><script type="module">
import {mountInspector,ArchiveInspectorProvider,openArchive} from '/inspector.js';
import {mountGrabmReplay} from '/grabm.js';
const provider=new ArchiveInspectorProvider(async()=>openArchive(new Uint8Array(await (await fetch('/archive')).arrayBuffer())));
const live=${Boolean(options.optimizer)};
async function action(value){const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
if(live){Object.defineProperty(provider,'readOnly',{value:false});provider.baseline=()=>action({op:'baseline'});provider.run=()=>action({op:'run'});provider.replay=(_,decisions)=>action({op:'replay',decisions});const original=provider.runHandle.bind(provider);provider.runHandle=id=>({...original(id),cancel:()=>action({op:'cancel',id})});}
let replay;
mountInspector(document.querySelector('#app'),{provider,onReplay:async dataset=>{replay?.dispose();replay=await mountGrabmReplay(document.querySelector('#replay'),provider.datasetUrl(dataset.id),dataset,provider.resourceFetch);document.querySelector('#replay').scrollIntoView();}});
</script></body></html>`);
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      response
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
