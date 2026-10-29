// POST /api/jobs/[id]/invoice — generates an invoice (text, not PDF yet).
// Line items based on the task breakdown + estimated hours.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const { id } = await ctx.params
  const { data: job, error } = await db.from('jobs').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const hourlyRate = body.hourlyRate || 75
  const taxRate = body.taxRate || 0

  let scope: Record<string, unknown> = {}
  try { scope = JSON.parse(job.scope || '{}') } catch { scope = {} }

  let tasks: Record<string, unknown>[] = []
  try { tasks = JSON.parse(job.tasks || '[]') } catch { tasks = [] }

  // Build line items from tasks
  const lineItems = tasks.map((t, i) => ({
    description: String(t.name || `Task ${i + 1}`),
    hours: Math.ceil((t.estimatedMinutes as number || 60) / 60),
    rate: hourlyRate,
    amount: Math.ceil((t.estimatedMinutes as number || 60) / 60) * hourlyRate,
  }))

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100
  const total = subtotal + tax

  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`
  const invoiceDate = new Date().toISOString()
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // Net 14

  return NextResponse.json({
    ok: true,
    invoice: {
      invoiceNumber,
      invoiceDate,
      dueDate,
      from: {
        name: user.name || user.email,
        email: user.email,
      },
      to: {
        name: job.client_name || 'Client',
        email: job.client_email || null,
      },
      lineItems,
      subtotal,
      taxRate,
      tax,
      total,
      notes: 'Payment due within 14 days. Late payments subject to 1.5% monthly interest.',
    },
  })
}
