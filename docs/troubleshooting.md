# Troubleshooting

| Symptom | Action |
| --- | --- |
| npm cannot find a package version | Use the local tarballs; registry publication is deferred |
| Container image cannot be pulled | Build the local image and set `GA_IMAGE` explicitly |
| Connection refused | Run `ga doctor`, inspect Compose logs, and check the client's URL and mapped port |
| Adapter module not found | Bundle dependencies and verify paths inside `/workspace` |
| Native dependency fails in Docker | Build dependencies for the container OS and architecture |
| Adapter version mismatch | Make the launch's `adapter_version` match the initialized adapter version |
| Invalid evaluation | Return finite values in declared order and one result per candidate |
| NDJSON parsing fails | Send logs to stderr; stdout contains only protocol messages |
| Charts are blank | Give containers explicit height, validate the dataset, and inspect available history |
| SSE stops in a proxy | Check streaming support, buffering, and connection timeouts |
| Different seeded results | Check model randomness, immutable inputs, adapter version, and stable ordering |

Use `docker compose -f .genetic-assembly/compose.yml logs companion` in your consumer repository to inspect runtime errors. Include the run ID, configuration, and relevant adapter version when reporting a failure.
