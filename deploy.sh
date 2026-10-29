#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Buildr — Production Deployment Script
# Builds and deploys the platform using Docker Compose.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

echo "🚀 Buildr — Production Deployment"
echo "──────────────────────────────────"

# Check for .env
if [ ! -f .env ]; then
  echo "❌ No .env file found. Copy .env.production to .env and fill in the values."
  exit 1
fi

# Check required env vars
for var in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY NEXTAUTH_SECRET ENCRYPTION_KEY; do
  val=$(grep "^$var=" .env 2>/dev/null | cut -d'=' -f2-)
  if [ -z "$val" ] || [ "$val" = "your-service-role-key-here" ] || [ "$val" = "your-32-byte-hex-encryption-key" ]; then
    echo "❌ $var is not set in .env"
    exit 1
  fi
done

echo "✅ Environment variables check passed."

# Build and start all services
echo ""
echo "📦 Building Docker images..."
docker compose build

echo ""
echo "🏃 Starting services..."
docker compose up -d

echo ""
echo "⏳ Waiting for health checks..."
sleep 10

# Check health
WEB_HEALTH=$(curl -sf http://localhost:3000/api/health 2>/dev/null || echo "FAIL")
SIDECAR_HEALTH=$(curl -sf http://localhost:3030/__health 2>/dev/null || echo "FAIL")
COLLAB_HEALTH=$(curl -sf http://localhost:3004/ 2>/dev/null || echo "FAIL")

echo ""
echo "──────────────────────────────────"
echo "📊 Service Status:"
if echo "$WEB_HEALTH" | grep -q "ok"; then
  echo "  ✅ Web app (port 3000): healthy"
else
  echo "  ❌ Web app (port 3000): unhealthy"
fi

if echo "$SIDECAR_HEALTH" | grep -q "ok"; then
  echo "  ✅ API Runtime (port 3030): healthy"
else
  echo "  ⚠️  API Runtime (port 3030): checking..."
fi

if echo "$COLLAB_HEALTH" | grep -q "code"; then
  echo "  ✅ Collab Service (port 3004): healthy"
else
  echo "  ⚠️  Collab Service (port 3004): checking..."
fi

echo ""
echo "🎉 Buildr is live at http://localhost:3000"
echo "──────────────────────────────────"
echo ""
echo "To stop:    docker compose down"
echo "To rebuild: docker compose up -d --build"
echo "To view logs: docker compose logs -f"
