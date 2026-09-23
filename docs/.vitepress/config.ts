import { defineConfig } from 'vitepress'
import { fileURLToPath } from 'node:url'
import { syntaxTheme } from './syntax-theme'
const group = (text: string, items: [string, string][]) => ({ text, items: items.map(([text, link]) => ({ text, link })) })
export default defineConfig({
  title: 'Genetic Assembly', description: 'Optimization for your application. Setup, integration guides, and complete public API reference.',
  base: process.env.DOCS_BASE ?? '/', cleanUrls: false, outDir: 'dist', lastUpdated: true,
  markdown: { theme: syntaxTheme },
  vite: {
    server: { host: '127.0.0.1', port: 4176, strictPort: true },
    resolve: { alias: { '@genetic-assembly/visualizations': fileURLToPath(new URL('../../visualizations/dist/index.js', import.meta.url)) } }
  },
  themeConfig: {
    nav: [{ text: 'Guide', link: '/' }, { text: 'API', link: '/api-reference/' }, { text: 'Examples', link: '/examples' }],
    search: { provider: 'local' }, outline: [2, 3],
    socialLinks: [{ icon: 'github', link: 'https://github.com/niko-dellic/genetic-assembly' }],
    sidebar: [
      group('Start here', [['Overview', '/'], ['Installation', '/installation'], ['First baseline and run', '/quickstart']]),
      group('Foundations', [['Core concepts', '/concepts'], ['Author a study', '/integrating-another-repository'], ['Backend setup', '/backend'], ['Goals and seeds', '/goals'], ['Run lifecycle', '/runs'], ['Compare results', '/results'], ['Replay and storage', '/replay']]),
      group('Integrations', [['grabm neighborhood', '/grabm'], ['Python', '/python'], ['Three.js', '/three'], ['Visualizations', '/visualizations'], ['Recorded examples', '/examples'], ['Deployment', '/deployment']]),
      group('Library exports', [['All functions', '/api-reference/functions'], ['Study SDK', '/api-reference/sdk/'], ['Node model helpers', '/api-reference/node/'], ['grabm integration', '/api-reference/grabm/'], ['Inspector', '/api-reference/inspector/'], ['Three.js integration', '/api-reference/three/'], ['Visualization exports', '/api-reference/visualizations/']]),
      group('Reference', [['CLI commands', '/cli'], ['JSON schemas', '/schemas'], ['HTTP API', '/http-api'], ['Adapter protocol', '/adapter-protocol'], ['Evaluator context', '/evaluator-context'], ['Usage guide', '/usage-guide'], ['Troubleshooting', '/troubleshooting'], ['Maintaining the docs', '/contributing']]),
    ],
    footer: { message: 'Genetic Assembly · Deterministic NSGA-II optimization', copyright: 'MIT licensed' }
  },
  head: [['script', {}, `(() => {
    const root = document.documentElement;
    const restore = value => root.dataset.palette = ['neutral','green','blue','violet'].includes(value) ? value : 'neutral';
    try { restore(localStorage.getItem('genetic-assembly-palette')); } catch { restore(null); }
    window.addEventListener('storage', event => { if(event.key === 'genetic-assembly-palette' || event.key === null) restore(event.newValue); });
    const sync = () => { const theme = root.classList.contains('dark') ? 'dark' : 'light'; root.dataset.theme = theme; root.style.colorScheme = theme; document.dispatchEvent(new CustomEvent('genetic-assembly:themechange', {detail:{theme,palette:root.dataset.palette}})); };
    new MutationObserver(sync).observe(root, {attributes:true,attributeFilter:['class','data-palette']}); sync();
  })();`]]
})
