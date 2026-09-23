import { defineConfig } from "vitepress";
import { fileURLToPath } from "node:url";
const group = (text: string, items: [string, string][]) => ({
  text,
  items: items.map(([text, link]) => ({
    text,
    link: link === "/" ? "/docs/" : `/docs${link}`,
  })),
});
export default defineConfig({
  markdown: { theme: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' } },
  title: "Genetic Assembly",
  description:
    "Optimization for your application. Setup, integration guides, and complete public API reference.",
  base: "/",
  rewrites: (id) =>
    id === "index.md"
      ? id
      : id === "overview.md"
        ? "docs/index.md"
        : `docs/${id}`,
  cleanUrls: false,
  outDir: "dist",
  lastUpdated: true,
  vite: {
    server: { host: "127.0.0.1", port: 4176, strictPort: true },
    worker: { format: "es" },
    resolve: {
      alias: {
        "@genetic-assembly/sdk": fileURLToPath(
          new URL("../../sdk/dist/index.js", import.meta.url),
        ),
        "@genetic-assembly/visualizations": fileURLToPath(
          new URL("../../visualizations/dist/index.js", import.meta.url),
        ),
      },
    },
  },
  themeConfig: {
    logo: { src: "/android-chrome-192x192.png", alt: "", width: 24, height: 24 },
    nav: [
      { text: "Home", link: "/" },
      { text: "Docs", link: "/docs/" },
      { text: "API", link: "/docs/api-reference/" },
      { text: "Examples", link: "/docs/examples" },
    ],
    search: { provider: "local" },
    outline: [2, 3],
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/niko-dellic/genetic-assembly",
      },
    ],
    sidebar: {
      "/docs/": [
        group("Start here", [
          ["Overview", "/"],
          ["Installation", "/installation"],
          ["First baseline and run", "/quickstart"],
          ["Local execution", "/local"],
        ]),
        group("Foundations", [
          ["Core concepts", "/concepts"],
          ["Author a study", "/integrating-another-repository"],
          ["Backend setup", "/backend"],
          ["Goals and seeds", "/goals"],
          ["Run lifecycle", "/runs"],
          ["Compare results", "/results"],
          ["Replay and storage", "/replay"],
        ]),
        group("Integrations", [
          ["Python", "/python"],
          ["Three.js", "/three"],
          ["Visualizations", "/visualizations"],
          ["Examples dashboard", "/examples"],
          ["Deployment", "/deployment"],
        ]),
        group("Library exports", [
          ["All functions", "/api-reference/functions"],
          ["Study SDK", "/api-reference/sdk/"],
          ["Node model helpers", "/api-reference/node/"],
          ["Inspector", "/api-reference/inspector/"],
          ["Three.js integration", "/api-reference/three/"],
          ["Visualization exports", "/api-reference/visualizations/"],
        ]),
        group("Reference", [
          ["CLI commands", "/cli"],
          ["JSON schemas", "/schemas"],
          ["HTTP API", "/http-api"],
          ["Adapter protocol", "/adapter-protocol"],
          ["Evaluator context", "/evaluator-context"],
          ["Usage guide", "/usage-guide"],
          ["Troubleshooting", "/troubleshooting"],
          ["Maintaining the docs", "/contributing"],
        ]),
      ],
    },
    footer: {
      message: "Genetic Assembly · Deterministic NSGA-II optimization",
      copyright: "MIT licensed",
    },
  },
  head: [
    ["link", { rel: "icon", href: "/favicon.ico", sizes: "any" }],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
    ],
    [
      "link",
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
    ],
    ["link", { rel: "manifest", href: "/site.webmanifest" }],
    ['script', {}, `(() => {
      const root = document.documentElement;
      root.dataset.palette = 'neutral';
      const sync = () => {
        root.dataset.theme = root.classList.contains('dark') ? 'dark' : 'light';
        document.dispatchEvent(new CustomEvent("genetic-assembly:themechange", { detail: { theme: root.dataset.theme, palette: 'neutral' } }));
      };
      new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
      sync();
    })();`],
  ],
});
