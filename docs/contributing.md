# Maintaining the documentation

```sh
npm run docs:install
npm run setup
npm run examples:install
npm run docs:dev
npm run docs:test
npm run pack
npm run test:packed
```

Authored pages live in `docs`; generated API pages are rebuilt from the supported library entry points. The CLI is documented separately. Adding a public subpath requires updating the API generator's coverage configuration.

Keep executable recipes in `tools/docs/snippets` and include them in Markdown so the displayed code is the tested code. Packed-consumer tests install tarballs outside this checkout and compile those recipes.

Record examples with `npm run docs:record` against a running local companion. Commit the result fixture and its provenance together. Never fabricate optimization history for examples.

The site uses the design tokens and documentation styling adapted from grabm. Genetic Assembly owns its copies; building the site does not require the grabm repository. Its neighborhood example uses the vendored public grabm tarball. Run `npm run examples:install` before building the docs.

## Verify the complete consumer flow

Build the local companion image, then run `npm run test:consumer-companion`. This creates an isolated temporary consumer, installs the tarballs, starts a separate Compose project, exercises both documented and reference adapters, records the example, and removes its containers and volumes. It needs Docker and npm access.

Tag pushes verify and retain tarballs without publishing. A future coordinated release requires an explicit workflow dispatch with `publish` enabled on a matching version tag and registry credentials.

The docs pin Rollup to 4.62.2 for consistent Linux and macOS installations. Revalidate clean installs and production builds when updating this override.

## Website routes

The brief library introduction lives at `https://genetic-assembly.vercel.app/`. The full guide begins at `/docs/`; VitePress rewrites authored pages and generated references into this section. `docs/overview.md` becomes `/docs/index.html`, while `docs/index.md` stays the homepage. Public documentation downloads belong in `docs/public/docs/`. The old documentation domain permanently redirects to the new docs section.

## Publish static documentation

`npm run docs:deploy` builds the site and validates a separate public-only deployment directory before publishing it to the configured Vercel project. It resolves source paths relative to the script, so the calling directory cannot change the payload. Missing pages, hidden files and symlinks stop publication. Use `node tools/docs/deploy-static.mjs --prepare-only` to inspect the staged output without publishing.

## Shared documentation style

This site uses VitePress 1.6.4's default theme, native light/dark mode, and the
CSS-only `@nikodellic/publisher-docs` package in `tools/docs/vendor/`. The sibling
`publisher-docs` repository owns the stylesheet and a minimal starter. Update its
archive and lockfile together across Genetic Assembly, grabm, and Quilt.
Embedded-example tokens remain local and do not control the documentation shell.
