# grabm reference package

`grabm-abm-0.1.0.tgz` is the public package artifact packed from the user's read-only grabm checkout with `npm pack --ignore-scripts`. It is included for reproducible local integration tests because this private development package is not published to npm. It preserves the package's compiled public entry points, schemas, license and Node child-process asset. Genetic Assembly does not modify grabm.

Use a newly reviewed grabm tarball and update the lockfile and acceptance tests together when upgrading. npm publication of Genetic Assembly remains deferred.
391ddb458d56ea32c88472595257134f5973d5ec0f296aeb9f4c89fcfdd1b591 examples/neighborhood/vendor/grabm-abm-0.1.0.tgz
