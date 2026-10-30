# Generated API sandbox architecture

## Production execution path

`api-runtime` authenticates the gateway request, loads the project code, and sends a bounded execution payload to the internal `sandbox-runner`. The runner validates its shared token and starts a **new container per request** using the fixed `buildr-sandbox:local` image and a fixed command. The generated code never runs inside either long-lived service process.

Each execution container has:

- no network (`--network=none`), no host mounts, and no Docker socket;
- a read-only root filesystem and a small no-exec `/tmp` tmpfs;
- a non-root UID, dropped Linux capabilities, default seccomp, and no-new-privileges;
- 256 MiB memory, 0.5 CPU, 32 process limit, bounded file descriptors/output, and a 12-second orchestration deadline;
- no application, Supabase, payment, email, OAuth, or runner secrets. Integrations are explicit non-networking mocks that fail closed for external side effects.

The orchestrator accepts only `/execute` JSON payloads. Callers cannot choose the image, command, mounts, environment, network, or Docker flags. It is not exposed on a host port.

## Deployment

1. Generate independent random values for `SIDECAR_AUTH_TOKEN` and `SANDBOX_RUNNER_TOKEN` (at least 32 characters each).
2. Build and start using `docker compose up -d --build`.
3. Check `docker compose ps` and `docker compose logs sandbox-runner api-runtime`.
4. Run the sandbox regression test from the project root: `npm run test:sandbox` (requires Docker daemon access and the `buildr-sandbox:local` image built by Compose).
5. Verify preview route behavior in staging, including timeout, payload limit, import denial, and no-network tests.

## Security boundary and operational caveat

Disposable containers provide a substantially stronger boundary than `new Function` in the application process, but Linux containers share the host kernel. The runner also needs Docker daemon access to create containers; Docker daemon access is host-privileged. For higher-assurance multi-tenant production, run `sandbox-runner` on a **dedicated isolated worker host/VM** (or a managed sandbox platform), with no app data disks or production credentials, and use a narrowly authenticated private connection from the API runtime. Do not mount the Docker socket into `api-runtime`, the web service, or any generated-code container. Keep the worker host patched and apply host firewall rules in addition to `--network=none`.

This implementation is not a claim of immunity to kernel/container-runtime zero-days. Production acceptance still requires the staging integration tests and full application build.
