// Notification helper — the unified event-emitter for the entire platform.
import { db } from '@/lib/db'

export type NotificationSource =
  | 'cron' | 'monitoring' | 'heal' | 'support' | 'jobs'
  | 'godmode' | 'marketing' | 'business' | 'deployment' | 'system'

export interface NotifyInput {
  ownerId: string
  source: NotificationSource
  severity?: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  linkType?: string
  linkId?: string
  actionUrl?: string
  metadata?: Record<string, unknown>
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    await db.from('notifications').insert({
      owner_id: input.ownerId,
      source: input.source,
      severity: input.severity || 'info',
      title: input.title,
      message: input.message || '',
      link_type: input.linkType || null,
      link_id: input.linkId || null,
      action_url: input.actionUrl || null,
      metadata: JSON.stringify(input.metadata || {}),
    })
  } catch (err) {
    console.error('[Buildr] notify() failed:', err instanceof Error ? err.message : err)
  }
}
