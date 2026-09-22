# Maintaining the documentation

```sh
npm run docs:install
npm run docs:dev
npm run docs:test
npm run pack
npm run test:packed
```

Authored pages live in `docs`; generated API pages are rebuilt from the four library entry points. The CLI is documented separately. Adding a public subpath requires updating the API generator's coverage configuration.

Keep executable recipes in `tools/docs/snippets` and include them in Markdown so the displayed code is the tested code. Packed-consumer tests install tarballs outside this checkout and compile those recipes.

Record examples with `npm run docs:record` against a running local companion. Commit the result fixture and its provenance together. Never fabricate optimization history for examples.

The site uses the design tokens and documentation styling adapted from grabm. Genetic Assembly owns its copies; building the site does not require grabm.

## Verify the complete consumer flow

Build the local companion image, then run `npm run test:consumer-companion`. This creates an isolated temporary consumer, installs the tarballs, starts a separate Compose project, exercises both documented and reference adapters, records the example, and removes its containers and volumes. It needs Docker and npm access.

Tag pushes verify and retain tarballs without publishing. A future coordinated release requires an explicit workflow dispatch with `publish` enabled on a matching version tag and registry credentials.

The docs pin Rollup to 4.62.2 for consistent Linux and macOS installations. Revalidate clean installs and production builds when updating this override.
