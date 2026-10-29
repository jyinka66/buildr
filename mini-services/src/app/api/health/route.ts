// GET /api/health — returns the Supabase connection status so the frontend
// can show a helpful "configure Supabase" message instead of generic errors.
import { NextResponse } from 'next/server'
import { checkSupabase } from '@/lib/supabase-server'

export async function GET() {
  const status = await checkSupabase()
  return NextResponse.json(status, { status: status.ok ? 200 : 503 })
}
