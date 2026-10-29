# Buildr — Production Deployment Guide

Buildr is a full-stack application that runs **3 services**:

| Service | Port | Purpose |
|---|---|---|
| **Web app** | 3000 | Next.js frontend + API routes |
| **API Runtime** | 3030 | Executes generated API route handlers |
| **Collab Service** | 3004 | WebSocket server for real-time collaboration |

## Prerequisites

1. **Supabase project** — create one at [supabase.com](https://supabase.com)
2. **Environment variables** — see `.env.production`

## Quick Start (Docker Compose)

```bash
# 1. Copy env template and fill in values
cp .env.production .env
# Edit .env with your Supabase URL, service role key, NextAuth secret, encryption key

# 2. Run the Supabase schema
# Go to your Supabase dashboard → SQL Editor
# Paste the contents of supabase/schema.sql and run it

# 3. Deploy
./deploy.sh
# Or manually:
docker compose up -d --build
```

## Deployment Options

### Option 1: Docker Compose (self-hosted)

```bash
docker compose up -d --build
```

- All 3 services run in containers
- Health checks on all services
- Non-root users for security
- Auto-restart on failure (`unless-stopped`)

### Option 2: Vercel (web app only)

Vercel deploys the Next.js app as serverless functions. The API runtime and collab service must be deployed separately (Docker on another host).

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Or connect the repo in the [Vercel dashboard](https://vercel.com/new).

**Note:** Set the same environment variables in Vercel's project settings. The API runtime (port 3030) and collab service (port 3004) need to be deployed separately — Vercel doesn't support persistent WebSocket or long-running processes. Use Render, Railway, or Fly.io for those.

### Option 3: Netlify (web app only)

```bash
npm i -g netlify-cli
netlify deploy --prod
```

Or connect the repo in the [Netlify dashboard](https://app.netlify.com/start).

**Note:** Same limitation as Vercel — the API runtime and collab service need separate hosting.

### Option 4: Render (all 3 services)

Render supports Docker-based web services. The `render.yaml` blueprint defines all 3 services:

```bash
# Install Render CLI
npm i -g @render-ai/cli

# Deploy using the blueprint
render deploy --blueprint render.yaml
```

Or connect the repo in the [Render dashboard](https://render.com) and the blueprint will be auto-detected.

### Option 5: Railway / Fly.io (Docker)

```bash
# Railway
railway up

# Fly.io
fly deploy
```

Both support Dockerfiles. Deploy each service separately:
- Main app: use the root `Dockerfile`
- API runtime: use `mini-services/api-runtime/Dockerfile`
- Collab service: use `mini-services/collab-service/Dockerfile`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (NOT anon) |
| `NEXTAUTH_URL` | ✅ | Your deployment URL (e.g. `https://buildr.example.com`) |
| `NEXTAUTH_SECRET` | ✅ | NextAuth JWT secret (`openssl rand -base64 32`) |
| `SIDECAR_AUTH_TOKEN` | ✅ | Random internal API-runtime token (at least 32 characters) |
| `SANDBOX_RUNNER_TOKEN` | ✅ | Independent random token for the internal generated-code sandbox (at least 32 characters) |
| `ALLOWED_ORIGINS` | ✅ | Exact public app origin(s), comma-separated |
| `PAYSTACK_SECRET_KEY` | Required for payments | Live Paystack secret key in production (`sk_live_...`) |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex key for API key encryption (`openssl rand -hex 32`) |
| `RESEND_API_KEY` | Optional | For email verification + password reset |
| `EMAIL_FROM` | Optional | From address for transactional emails |
| `GITHUB_CLIENT_ID` | Optional | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | Optional | GitHub OAuth |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth |

## Generated-code sandbox

Production generated API routes run in a disposable, network-isolated container via `sandbox-runner`; the API runtime no longer evaluates generated code in its own process in production. Configure an independent `SANDBOX_RUNNER_TOKEN`, then run `docker compose up -d --build`. Verify `docker compose ps` and `docker compose logs sandbox-runner api-runtime`. Run `SANDBOX_TEST_URL=http://localhost:3031 SANDBOX_RUNNER_TOKEN=<same-token> npm run test:sandbox` to run the Docker integration tests (in addition to the always-on static tests).

**Host isolation warning:** `sandbox-runner` requires Docker daemon access to create per-request containers. Docker daemon access is host-privileged. For multi-tenant production, place the runner on a dedicated worker VM/host with no production data disks or credentials; do not share the Docker socket with `web`, `api-runtime`, or generated-code containers. Containers share the host kernel and do not protect against host-kernel/container-runtime vulnerabilities.

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → **New Query**
3. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql)
4. Click **Run**
5. Go to **Project Settings → API**
6. Copy the **Project URL** and **service_role** key to your `.env`

## Architecture

```
                    ┌──────────────────┐
                    │   Caddy Gateway   │
                    │   (port 81)       │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐ ┌──────────────┐ ┌────────────┐
     │  Web App   │ │  API Runtime │ │   Collab   │
     │  (Next.js)  │ │   (Bun)     │ │  (Socket)  │
     │  port 3000  │ │  port 3030   │ │ port 3004  │
     └────────────┘ └──────────────┘ └────────────┘
              │              │
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │   Supabase   │
              │  (Postgres)   │
              └──────────────┘
```

## Logs

```bash
# All services
docker compose logs -f

# Individual service
docker compose logs -f web
docker compose logs -f api-runtime
docker compose logs -f collab-service
```

## Health Checks

```bash
curl http://localhost:3000/api/health   # Web app
# API runtime is internal-only; check from the web container: curl http://api-runtime:3030/__health
curl http://localhost:3004/              # Collab service
```

> **Production security gate:** generated API route execution is intentionally disabled in production until the isolated sandbox runner is deployed. The current development evaluator uses in-process JavaScript execution and is not a security boundary. Do not remove this gate or enable in-process execution for production workloads.
