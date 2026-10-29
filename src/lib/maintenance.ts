// Maintenance mode helper — the platform kill switch.
export function isMaintenanceMode(): boolean { return process.env.MAINTENANCE_MODE === 'true' }

export function maintenanceResponse(): Response {
  return new Response(JSON.stringify({ error: 'maintenance_mode', message: 'Buildr is temporarily in maintenance mode.', retryAfterMs: 60_000 }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '60' } })
}
