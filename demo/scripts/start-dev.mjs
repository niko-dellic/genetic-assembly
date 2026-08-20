import { createServer as createNetServer } from "node:net";
import { createServer as createViteServer } from "vite";

const host = "127.0.0.1";
const preferredPort = 3333;
const reservedPorts = new Set([3001]); // Native Rust API.

async function isAvailable(port) {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findPort() {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (reservedPorts.has(port)) continue;
    if (await isAvailable(port)) return port;
  }
  throw new Error(`No available demo port found between ${preferredPort} and ${preferredPort + 99}.`);
}

const port = await findPort();
if (port !== preferredPort) {
  console.warn(`Port ${preferredPort} is busy; using port ${port} for the Three.js demo.`);
}

const vite = await createViteServer({
  server: { host, port, strictPort: true },
});
await vite.listen();
vite.printUrls();
console.log(`Open the solver UI at http://${host}:${port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await vite.close();
    process.exit(0);
  });
}
