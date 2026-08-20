# @genetic-assembly/cli

Scaffold and operate a Genetic Assembly companion from another repository.

```bash
npm install --save-dev @genetic-assembly/cli
npx ga init
npx ga test-adapter
npx ga up
```

Commands:

- `ga init` creates a non-overwriting `.genetic-assembly` starter.
- `ga test-adapter` exercises initialization, evaluation, and shutdown.
- `ga up` starts the companion and Postgres.
- `ga doctor` checks Docker, the API, and scaffold files.
- `ga down` stops the local stack without deleting named volumes.

See [Integrating Genetic Assembly into another repository](https://github.com/niko-dellic/genetic-assembly/blob/main/docs/integrating-another-repository.md).
