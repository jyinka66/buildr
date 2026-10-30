# Buildr free launch mode (no Docker)

This deployment profile is for launching the product without paying for a server. It uses the existing Next.js app and the Supabase project you already configured. Provider free tiers can change and may sleep, enforce usage limits, or restrict commercial use; check the current terms before launch. This profile is an MVP, not a full-stack execution platform.

## What works

- Sign-in and project persistence, once Supabase and auth environment variables are configured.
- AI generation/editing, if the chosen model provider's API is configured and you have available credits/free quota.
- Code editing, file management, ZIP export, and GitHub sync when the user supplies the required credentials.
- Browser-based UI previews for supported web projects.

## What is intentionally unavailable

- Executing generated Node/Python/API routes on Buildr servers.
- Installing arbitrary packages or running user-defined build commands.
- Persistent WebSocket collaboration unless its service is deployed separately.
- Real API/database operations from previewed apps. Relative API calls return a mock response and external network requests are blocked by the preview policy.

Do not turn these features on by pointing generated code at the main Next.js server. The existing sandbox path must continue to fail closed until a separately isolated runner is available.

## Deploy the web app

1. In Vercel, import `jyinka66/buildr` from GitHub and keep the repository's existing `vercel.json` build settings.
2. Add the environment variables below in Vercel Project Settings. Do not commit them or paste secrets into chat:
   - `NEXTAUTH_URL`: the exact deployed production URL.
   - `NEXTAUTH_SECRET`: a newly generated random secret.
   - `SUPABASE_URL`: your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: server-side only; never use a `NEXT_PUBLIC_` prefix.
   - `SUPABASE_ANON_KEY`: if a feature requires the public anon key.
   - `ENCRYPTION_KEY`: 64 hexadecimal characters, generated fresh; keep stable after storing encrypted data.
   - `ALLOWED_ORIGINS`: the exact production origin.
   - AI provider credentials required by the generator, if configured in this codebase.
3. Set `NODE_ENV=production` if the host does not set it automatically.
4. Deploy and check the build logs. Then sign in, create a test project, generate a small page, refresh it, and export a ZIP.
5. Leave `SIDECAR_URL`, `SIDECAR_AUTH_TOKEN`, and sandbox-runner settings unset in this profile. Features that require the sidecar should return an unavailable error, not execute code in-process.

## Safe preview contract

The preview is a browser-only rendering aid, not a secure runtime for production workloads. It uses an opaque-origin iframe and a Content Security Policy that blocks network connections, form submissions, nested frames, external images/fonts, and arbitrary script sources (the React/Babel/Tailwind renderer CDNs are allowlisted). Previewed relative API requests are mocked. Never put provider secrets into preview HTML or generated client code.

## Later: enable full-stack execution

When funding is available, deploy a dedicated execution service using a strong isolation boundary (for example, a separately managed sandbox runtime with per-job CPU/memory/time limits, no host credentials, restricted egress, and short-lived workspaces). Keep it separate from the Next.js app and Supabase service-role credentials. Re-enable generated API execution only after authentication, quota reservation, abuse controls, and live isolation tests pass. Docker is one possible implementation, not a requirement for the web app itself.
