# Buildr

Buildr is a Next.js application for generating, previewing, and deploying projects, with a separate API-route runtime, collaboration service, and isolated execution environment for generated server code.

## Requirements

- Bun 1.3.4 (web app and service development)
- Node.js 22 (container build stage and tooling)
- Docker Engine + Docker Compose for local full-stack and sandbox integration
- Supabase project for persistent application data
- Provider credentials only for features you intend to use (for example Paystack, OAuth, or email)

## Local setup

1. Install dependencies:

   ```sh
   bun install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and replace placeholders with local credentials. Do not commit `.env` or paste production secrets into issues or logs.

3. Start the web app for UI development:

   ```sh
   bun run dev
   ```

   The web app listens on port 3000. The API runtime and collaboration service are separate processes; use Docker Compose for the full stack.

4. Start the containerized stack after configuring the required variables in `.env`:

   ```sh
   docker compose up --build
   ```

   - Web app: http://localhost:3000
   - API runtime health: internal port 3030 at `/__health`
   - Sandbox runner health: internal port 3031 at `/__health`
   - Collaboration service: port 3004

The local Compose sandbox runner mounts the Docker socket and therefore has host-level Docker-daemon privileges. Use it only on a trusted development machine. Production deployments should isolate the runner on a dedicated Docker host and connect using mutual TLS; do not expose the Docker daemon to the public internet.

## Validation

Run the checks used by CI:

```sh
bun run build
bun run typecheck
npm run test:security
npm run test:sandbox
npm run test:deployment
```

The sandbox integration tests use real Docker containers when `SANDBOX_TEST_URL` and a 32-character-or-longer `SANDBOX_RUNNER_TOKEN` are set. Without those variables, the live integration tests are skipped; the static checks still run.

GitHub Actions runs the web build, typecheck, security and deployment tests, live sandbox integration tests, and builds the web, API-runtime, and collaboration Docker images. The sandbox worker image is published to GitHub Container Registry after those jobs succeed.

## Production configuration

The Render blueprint is in `render.yaml`. Configure its `sync: false` environment variables in the hosting dashboard before deploying. Required values include:

- Public app URL and a strong `NEXTAUTH_SECRET`
- Supabase URL and the appropriate server-only or anon key for each service
- A 64-character hexadecimal `ENCRYPTION_KEY`
- Independent, random `SIDECAR_AUTH_TOKEN` and `SANDBOX_RUNNER_TOKEN` values (at least 32 characters)
- Allowed origins and any provider credentials used by the enabled features
- `TRUST_PROXY_HEADERS=true` only when the hosting proxy overwrites incoming forwarding headers and direct app access is blocked; otherwise leave it false. Account-based limits still apply when a trusted client IP is unavailable.

### Paystack test mode

For test transactions, set `PAYSTACK_MODE=test` and configure a Paystack **test secret key** (`sk_test_...`) in the server environment. The application rejects a key whose prefix does not match the configured mode. For live transactions, set `PAYSTACK_MODE=live` and use an `sk_live_...` key. Never put either secret key in a `NEXT_PUBLIC_*` variable or commit it to the repository. Test-mode payments do not represent real customer charges.
- A dedicated Docker host for the sandbox runner, configured with `DOCKER_HOST`, `DOCKER_CA_PEM`, `DOCKER_CLIENT_CERT_PEM`, and `DOCKER_CLIENT_KEY_PEM`
- `SANDBOX_IMAGE` set to the published worker image, plus registry credentials only if the image package is private

The API runtime deliberately receives the Supabase anon key rather than the service-role key. Production generated route code is sent to the isolated runner and the request fails closed when the runner is not configured. Do not place service-role keys, payment secrets, or application auth tokens inside the sandbox worker image.

CI passing proves the checked-in code builds and the automated tests pass; it does not prove that external Supabase, payment, OAuth, email, registry permissions, or hosting secrets are correctly configured. Verify those integrations in the target environment before enabling production traffic.

## Repository map

- `src/` — Next.js application, API routes, and shared libraries
- `mini-services/api-runtime/` — sidecar and isolated sandbox orchestrator/worker
- `mini-services/collab-service/` — real-time collaboration service
- `tests/` — security, sandbox, and deployment configuration checks
- `.github/workflows/production-build.yml` — CI, container builds, and sandbox worker publishing
- `render.yaml` / `vercel.json` — deployment configuration
