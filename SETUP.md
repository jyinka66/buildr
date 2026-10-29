# Buildr — Setup Guide

## Quick Start

1. Install dependencies:
   ```bash
   bun install
   ```

2. Set up environment variables in `.env`:
   ```
   NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
   DATABASE_URL=file:./db/custom.db
   ```

3. Run the dev server:
   ```bash
   bun run dev
   ```

4. Start the sidecar services (in separate terminals):
   ```bash
   cd mini-services/api-runtime && bun install && bun run dev
   cd mini-services/collab-service && bun install && bun run dev
   ```

5. Open http://localhost:3000

## Architecture

- **Next.js 16 app** (port 3000) — main app with all features
- **API Runtime sidecar** (port 3030) — executes generated API routes
- **Collab Service** (port 3004) — real-time collaboration (Socket.IO)

## Features

- AI code generation with real-time streaming (z-ai-web-dev-sdk)
- Live preview with sandboxed iframe
- Paystack payment integration
- Social media scheduler + auto-post
- Campaign ROI tracking
- Brand voice training (AI analyzes your content)
- Lead-to-Job pipeline (leads → jobs → payments)
- Sidebar navigation with grouped sections

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| NEXTAUTH_SECRET | Yes (prod) | JWT signing secret |
| DATABASE_URL | Yes | SQLite path |
| PAYSTACK_SECRET_KEY | No (prod) | Paystack API key |
| SUPABASE_URL | No | Supabase URL |
| SUPABASE_ANON_KEY | No | Supabase anon key |
| SIDECAR_AUTH_TOKEN | Yes (prod) | Auth token for API runtime |
| SANDBOX_RUNNER_TOKEN | Yes (prod) | Independent 32+ character token for the disposable generated-code sandbox |
| ALLOWED_ORIGINS | Yes (prod) | CORS origins for collab |
| ALLOWED_FRAME_ANCESTORS | Yes (prod) | CSP frame-ancestors |
| ENCRYPTION_KEY | Yes (prod) | 64-char hex for secret encryption |

> **Production sandbox:** generated API route handlers run through the internal `sandbox-runner` in a fresh, restricted, network-isolated container per request. Configure `SANDBOX_RUNNER_TOKEN` independently from `SIDECAR_AUTH_TOKEN`, then deploy with `docker compose up -d --build`. Run `npm run test:sandbox` for static checks; set `SANDBOX_TEST_URL` and `SANDBOX_RUNNER_TOKEN` to enable Docker integration checks. The runner requires Docker daemon access, which is host-privileged; for higher-assurance production, deploy it on a dedicated isolated worker VM/host.
