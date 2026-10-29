# Buildr remediation and deployment status

## Implemented in source

- Hardened generated API execution: production runtime sends generated route source to a separate authenticated sandbox runner and fails closed when the runner is not configured or unavailable.
- Added disposable Docker worker execution with no network, read-only root filesystem, non-root worker, dropped Linux capabilities, memory/CPU/PID/file limits, bounded I/O, and timeout cleanup.
- Added a remote Docker API option for hosted deployment using mutual TLS PEM secret environment variables; local Docker Compose continues to use a mounted socket. Never expose an unauthenticated Docker API.
- Fixed the local Compose sandbox health check to target port 3031.
- Added a standalone Next.js production post-build step and changed the start command to use Node.js directly.
- Added Vercel configuration, a Render Blueprint for web/API/sandbox/collaboration services, a deployment guide, deployment-config smoke tests, and GitHub Actions for build/type/security checks plus Docker image builds and sandbox image publication.
- Kept environment secrets out of deployment files; `.env.example` contains placeholders only.

## Validation completed in this environment

- `node --experimental-strip-types --check` passed for the API runtime, sandbox runner, and sandbox worker TypeScript files.
- `npm run test:security`: 3 passed.
- `npm run test:sandbox`: 3 static checks passed; 3 live Docker integration tests skipped because no Docker-capable runner URL/token was available.
- `npm run test:deployment`: 5 passed.
- `render.yaml`, `docker-compose.yml`, `package.json`, and `vercel.json` parsed successfully.

## Not yet verified

- A full Next.js production build and TypeScript project check could not run here: project dependencies are not installed, npm registry access failed with DNS `EAI_AGAIN`, and Bun is unavailable.
- Docker image builds and real container execution could not run here because Docker/Podman are unavailable.
- Cloud deployment, real Supabase/OAuth/payment/email integration, and live sandbox timeout/network-isolation tests have not been performed.
- Render requires a separate Docker-capable host for sandbox executions. Its normal service container does not provide the host Docker daemon socket. Configure `DOCKER_HOST` plus the three mutual-TLS PEM secrets, and configure the published worker image before enabling production generated-code execution.

This project is deployment-configured, not yet certified production-ready. The GitHub Actions pipeline is included to run the full build and Docker checks in a capable cloud CI environment; fix any failures it reports before release.
