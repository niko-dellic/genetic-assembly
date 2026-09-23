# @genetic-assembly/sdk

Define an optimization study once, then validate, run, compare and export it.

Browser-safe client: `import { StudyClient } from '@genetic-assembly/sdk'`.
Model runtime: `import { defineStudy } from '@genetic-assembly/sdk/node'`.

Install the local SDK and CLI tarballs, run `ga init`, then `ga up`, `ga check`, `ga baseline`, `ga run`, and `ga inspect`.

The companion owns durable history. Full replays are retained for baselines and explicitly selected candidates. npm publication is deferred.
