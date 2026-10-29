// Notifies the local API runtime sidecar (port 3030) to invalidate its file
// cache for a project after files are updated. Best-effort — if the sidecar
// isn't running or is unreachable, the call silently fails (the sidecar's
// 10s TTL cache will eventually refresh anyway).

const SIDECAR_URL = (process.env.SIDECAR_URL || 'http://localhost:3030').replace(/\/$/, '')
const SIDECAR_AUTH_TOKEN = process.env.SIDECAR_AUTH_TOKEN || ''

export async function invalidateRuntimeCache(projectId: string): Promise<void> {
  try {
    if (process.env.NODE_ENV === 'production' && SIDECAR_AUTH_TOKEN.length < 32) return
    const headers: Record<string, string> = {}
    if (SIDECAR_AUTH_TOKEN) headers['x-buildr-auth'] = SIDECAR_AUTH_TOKEN
    await fetch(`${SIDECAR_URL}/__invalidate?pid=${encodeURIComponent(projectId)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // Sidecar not running — preview will still work for client-side code;
    // only API route execution is unavailable. Silent.
  }
}
