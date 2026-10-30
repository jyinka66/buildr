// Webhook helper — emits outgoing webhooks with HMAC-SHA256 signing + retry.
import { createHmac, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { safeFetch } from '@/lib/ssrf'

async function readBoundedResponse(response: Response, limit = 2048): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < limit) {
      const item = await reader.read()
      if (item.done) break
      const count = Math.min(item.value.byteLength, limit - size)
      chunks.push(item.value.slice(0, count))
      size += count
      if (count < item.value.byteLength || size === limit) {
        await reader.cancel().catch(() => {})
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}

export function generateWebhookSecret(): string { return randomBytes(16).toString('hex') }

export function signPayload(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

const MAX_ATTEMPTS = 4
const RETRY_DELAYS_MS = [0, 30_000, 300_000, 3_600_000]

export async function emitWebhook(userId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const { data: webhooks } = await db.from('webhooks').select('id, url, secret, events').eq('owner_id', userId).eq('enabled', true)
    const matching = (webhooks ?? []).filter((w: { events: string[] }) => {
      const events = w.events || []
      return events.includes('*') || events.includes(eventType)
    })
    if (matching.length === 0) return
    await Promise.allSettled(matching.map((wh: { id: string; url: string; secret: string }) => deliverWebhook(wh.id, wh.url, wh.secret, userId, eventType, payload)))
  } catch (err) {
    console.error('[Buildr] emitWebhook failed:', err instanceof Error ? err.message : err)
  }
}

async function deliverWebhook(webhookId: string, url: string, secret: string, ownerId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const payloadStr = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), data: payload })
  const signature = signPayload(payloadStr, secret)
  const { data: delivery } = await db.from('webhook_deliveries').insert({ owner_id: ownerId, webhook_id: webhookId, event_type: eventType, payload: JSON.parse(payloadStr), status: 'pending', attempt: 0 }).select('id').single()
  if (delivery) void executeDelivery(delivery.id, webhookId, url, signature, payloadStr, ownerId, 0)
}

async function executeDelivery(deliveryId: string, webhookId: string, url: string, signature: string, payloadStr: string, ownerId: string, attempt: number): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-buildr-signature': signature, 'user-agent': 'Buildr-Webhook/1.0' }, body: payloadStr, signal: controller.signal })
    const responseBody = await readBoundedResponse(res).catch(() => '')
    if (res.ok) {
      await db.from('webhook_deliveries').update({ status: 'success', status_code: res.status, response_body: responseBody.slice(0, 2048), delivered_at: new Date().toISOString(), attempt: attempt + 1 }).eq('id', deliveryId)
      await db.from('webhooks').update({ last_triggered_at: new Date().toISOString(), last_status: 'success', last_status_code: res.status, delivery_count: (await getDeliveryCount(webhookId)) + 1 }).eq('id', webhookId)
    } else {
      await handleFailure(deliveryId, webhookId, url, signature, payloadStr, ownerId, attempt, res.status, responseBody)
    }
  } catch (err) {
    await handleFailure(deliveryId, webhookId, url, signature, payloadStr, ownerId, attempt, 0, err instanceof Error ? err.message : 'network_error')
  } finally { clearTimeout(timeout) }
}

async function handleFailure(deliveryId: string, webhookId: string, url: string, signature: string, payloadStr: string, ownerId: string, attempt: number, statusCode: number, responseBody: string): Promise<void> {
  const nextAttempt = attempt + 1
  const willRetry = nextAttempt < MAX_ATTEMPTS
  await db.from('webhook_deliveries').update({ status: willRetry ? 'retrying' : 'failed', status_code: statusCode || null, response_body: responseBody.slice(0, 2048), attempt: nextAttempt, next_retry_at: willRetry ? new Date(Date.now() + RETRY_DELAYS_MS[nextAttempt]).toISOString() : null }).eq('id', deliveryId)
  await db.from('webhooks').update({ last_triggered_at: new Date().toISOString(), last_status: willRetry ? 'retrying' : 'failed', last_status_code: statusCode || null, fail_count: (await getFailCount(webhookId)) + 1 }).eq('id', webhookId)
  if (willRetry) setTimeout(() => void executeDelivery(deliveryId, webhookId, url, signature, payloadStr, ownerId, nextAttempt), RETRY_DELAYS_MS[nextAttempt])
}

async function getDeliveryCount(webhookId: string): Promise<number> {
  const { data } = await db.from('webhooks').select('delivery_count').eq('id', webhookId).maybeSingle()
  return (data?.delivery_count as number) || 0
}

async function getFailCount(webhookId: string): Promise<number> {
  const { data } = await db.from('webhooks').select('fail_count').eq('id', webhookId).maybeSingle()
  return (data?.fail_count as number) || 0
}
