# ─────────────────────────────────────────────────────────────────
# Buildr — Collaboration Service Dockerfile (port 3004)
# WebSocket server for real-time collaboration.
# ─────────────────────────────────────────────────────────────────

FROM oven/bun:1.3.4-alpine

WORKDIR /app

# Copy package files.
COPY package.json bun.lock* ./

# Install dependencies.
RUN bun install --frozen-lockfile

# Copy source.
COPY . .

# Security: non-root user.
RUN addgroup --system --gid 1001 bunjs && \
    adduser --system --uid 1001 -G bunjs bunuser

RUN apk add --no-cache wget

USER bunuser

ENV PORT=3004

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3004/ || exit 1

CMD ["bun", "run", "index.ts"]
