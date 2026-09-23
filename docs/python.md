# Python and other runtimes

The solver adapter protocol is language-neutral JSON messages over standard input/output. The executable [`examples/python/adapter.py`](https://github.com/niko-dellic/genetic-assembly/blob/main/examples/python/adapter.py) implements v2 initialization, evaluation, finalist validation, materialization and shutdown with Python's standard library. It records each seed measurement through `/v2/evaluations`.

The example optimizes one real decision `x` against two targets, `left=x²` and `right=(1-x)²`. Register the same named study with `StudyClient.prepare`, using a runtime whose command is `python3` and args point to the provisioned immutable `adapter.py`. Its objective ordering comes from the compiled problem, not dictionary order.

For a managed custom image:

```dockerfile
FROM genetic-assembly:0.3.0
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
```

Provision that adapter and its locked dependencies in the companion runtime directory. Use [existing companion setup](./backend.md) for the explicit runtime identity and paths. The Python example demonstrates the protocol; the managed `ga init` study lifecycle uses the Node SDK. For mixed models, a Node study can invoke a packaged Python executable and return its named measurements while the SDK manages persistence, baseline and replay jobs.

Keep diagnostic output on stderr. Emit exactly one response per request on stdout. Preserve decimal-string solver seeds without converting them to floating point. Use the declared simulation seed sets when evaluating the model. Configuration/runtime exceptions are errors, while declared domain invalidity is a constraint violation.

[Adapter protocol](./adapter-protocol.md) · [Shared schemas](./schemas.md)
