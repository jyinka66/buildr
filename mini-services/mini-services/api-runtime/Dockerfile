# Shared immutable image: runtime service and sandbox orchestrator. Generated
# source is run only in fresh containers created by the orchestrator.
FROM oven/bun:1.3.4-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN chmod 755 /app/entrypoint.sh && apk add --no-cache curl docker-cli && \
    addgroup --system --gid 1001 bunjs && \
    adduser --system --uid 1001 -G bunjs bunuser && \
    chown -R bunuser:bunjs /app
USER bunuser
ENV PORT=3030
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD curl -f http://localhost:${PORT}/__health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["bun", "run", "index.ts"]
