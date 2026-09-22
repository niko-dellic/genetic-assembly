# Deployment

## Local companion

Use the [local image and tarball workflow](./installation.md). The CLI Compose stack runs Postgres and the Rust server, retains data in named volumes, and mounts your project at `/workspace` read-only. Bundle JavaScript adapters so they run with the container's dependencies. Other adapter languages require a companion image containing the relevant runtime or a native deployment.

## Native development

From the checkout:

```sh
docker compose up -d postgres
DATABASE_URL=postgres://genetic_assembly:genetic_assembly@127.0.0.1:55433/genetic_assembly cargo run -p genetic-assembly-server
```

See [the usage guide](./usage-guide.md) for lifecycle commands. Postgres migrations run on startup. `GA_ARTIFACT_ROOT` selects local artifact storage; `GA_S3_BUCKET` enables the configured S3-compatible backend. Preserve artifacts alongside database backups.

## Team deployments

Use authentication and a controlled network for trusted users. `GA_API_TOKEN` enables the server's static bearer token; clients accept a token as their second constructor argument. Configure HTTPS and proxy support for long-lived SSE connections. Browser applications need an accessible API endpoint and appropriate cross-origin behavior. Never include private server credentials in a public documentation build.

Adapters are trusted executable code. This service is not designed as a public arbitrary-code execution endpoint.

## Documentation hosting

`npm run docs:build` writes a static site to `docs/dist`. The root Vercel configuration installs package and docs dependencies and builds that output. Vercel hosts only the guide and recorded examples; visitors run their own companion.

## Future releases

The release workflow verifies packages before publishing matching container and npm versions. Registry publication is currently deferred. Local tarballs remain usable independently of that workflow.
