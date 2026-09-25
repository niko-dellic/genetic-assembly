/** Use with Vite's mergeConfig; supported for dev prebundling and production builds. */
export function geneticAssemblyVite() {
  return { optimizeDeps: { exclude: ["@genetic-assembly/sdk"] } };
}
