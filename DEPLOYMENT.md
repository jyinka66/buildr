# Buildr production deployment (no local terminal required)

> **No budget yet?** Start with the [free launch profile](FREE-LAUNCH.md): one Next.js web app, Supabase free tier, code generation/editing/export, and sandboxed browser previews. The full-stack Render blueprint below uses paid services and a separately hosted execution runner; it is not required for the first MVP.

## Recommended: Render for the full stack

Render is the simplest target for this repository because the product includes a Next.js server, an API runtime, a WebSocket collaboration service, and an isolated generated-code execution service. The checked-in `render.yaml` defines the services and the Docker build contexts.

### Before deploying

1. Put this repository in a GitHub repository and make sure the `main` branch contains the project.
2. In Render, create a Blueprint and select that GitHub repository. Render reads `render.yaml` and creates the services.
3. Add real secret values when Render asks for variables marked `sync: false`. Never use the CI-only sample values.
4. Use the same `SIDECAR_AUTH_TOKEN` for `buildr-web` and `buildr-api-runtime`. Use the same independent `SANDBOX_RUNNER_TOKEN` for `buildr-api-runtime` and `buildr-sandbox-runner`. Both tokens must be at least 32 random characters.
5. Set `SANDBOX_IMAGE` on `buildr-sandbox-runner` to the published worker image `ghcr.io/OWNER/REPOSITORY-sandbox-worker:latest`. The GitHub Actions workflow publishes it on pushes to `main`. If the GHCR package is private, set `SANDBOX_REGISTRY_USERNAME` and `SANDBOX_REGISTRY_TOKEN` on the runner; otherwise make the package public so the remote Docker host can pull it.
6. Provide a dedicated Docker host that supports remote Docker API over mutual TLS, then set `DOCKER_HOST` (for example `tcp://your-docker-host:2376`) and the CA/client certificate/private key PEM values in the runner's secret environment variables. Do not expose an unauthenticated Docker API to the internet.
7. Set `ALLOWED_ORIGINS` to the actual browser-facing app origin (and include any additional intended origins as a comma-separated list if the service supports it). Set `NEXTAUTH_URL` to the deployed app URL.
8. Add valid Supabase, encryption, OAuth, email, and payment secrets only if those integrations are enabled. Confirm the health checks and logs in Render after deployment.

**Important sandbox dependency:** Render runs Docker images, but it does not automatically provide a host Docker socket to a service. The generated-code sandbox fails closed until a dedicated Docker host is reachable with mutual TLS and the worker image can be pulled. The app must not be considered fully production-ready before this is configured and the live sandbox integration tests pass.

## Vercel for the Next.js app + Render for backend services

Vercel can build and host the Next.js app from the repository. The API runtime and collaboration service still need to be deployed separately; the sandbox runner additionally needs the Docker host described above.

1. Import this GitHub repository into Vercel as a Next.js project. `vercel.json` selects the Bun lockfile install and production build commands.
2. Set the same web-app secrets in Vercel's Project Settings → Environment Variables: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (if used), `ENCRYPTION_KEY`, `SIDECAR_URL` (the public HTTPS URL of the Render `buildr-api-runtime` service), `SIDECAR_AUTH_TOKEN`, `ALLOWED_ORIGINS` (your Vercel production and preview origins as appropriate), and any OAuth/payment/email secrets you actually use.
3. Set `SIDECAR_AUTH_TOKEN` on Render's API runtime to the exact same value as Vercel. Keep the API runtime's non-health routes token-authenticated; do not remove its auth middleware just because its service has a public Render URL.
4. Deploy the collaboration WebSocket service on Render and configure any client-facing collaboration URL in the app if that feature is enabled. Vercel Functions are not a replacement for a persistent WebSocket server.
5. Configure the sandbox runner and dedicated Docker host as above. Vercel cannot run the existing `docker-compose.yml` as a single deployment.

## Build and validation

- `bun run build` builds Next.js and prepares `.next/standalone` for the Docker/Render Node server.
- `bun run typecheck` performs TypeScript checking.
- `npm run test:security` runs security smoke tests.
- `npm run test:sandbox` runs sandbox static tests and runs live Docker integration tests only when the test URL and token are configured.
- `.github/workflows/production-build.yml` runs the build/type/security checks and builds all three Docker images on GitHub Actions. It also publishes the sandbox worker image from `main`.

No deployment platform can be activated on your behalf without access to the GitHub, Vercel/Render, Supabase, and any required provider accounts. This repository is configured for deployment, but successful cloud deployment and live integration are only confirmed after the platform build logs and service health checks pass.
