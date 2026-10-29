// GET /api/status — public platform status (no auth required)
import { NextResponse } from 'next/server'
import { isMaintenanceMode } from '@/lib/maintenance'

export async function GET() {
  return NextResponse.json({
    status: isMaintenanceMode() ? 'maintenance' : 'operational',
    maintenance: isMaintenanceMode(),
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: { api: 'ok', auth: 'ok', codeGeneration: 'ok', billing: 'ok', webhooks: 'ok' },
  })
}
