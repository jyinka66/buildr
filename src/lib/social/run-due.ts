// Find scheduled posts that are due, claim them, publish them, and record the outcome.
// Called by /api/cron/publish-scheduled, which a scheduler (GitHub Actions) hits every few minutes.

import { db } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/crypto'
import { notify } from '@/lib/notify'
import { defaultDeps, type ProviderDeps } from '@/lib/social/providers'
import { publishPost, type AccountToken, type PostResults } from '@/lib/social/publish-post'

const BATCH_SIZE = 10
/** A post stuck in "posting" this long was interrupted (crash or timeout). */
const STUCK_AFTER_MS = 15 * 60 * 1000

export interface RunSummary {
  claimed: number
  posted: number
  failed: number
  interrupted: number
}

const asArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

const asObject = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      return JSON.parse(v) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

function tryDecrypt(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    return decrypt(value)
  } catch {
    return null
  }
}

export async function runDuePosts(deps: ProviderDeps = defaultDeps, env: Record<string, string | undefined> = process.env): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, posted: 0, failed: 0, interrupted: 0 }
  const nowIso = deps.now().toISOString()

  // 1. Posts left in "posting" by a crashed run are marked failed, never re-sent: the post may
  //    already be live and a duplicate cannot be taken back. The owner can reschedule it.
  const cutoff = new Date(deps.now().getTime() - STUCK_AFTER_MS).toISOString()
  const { data: stuck } = await db
    .from('scheduled_posts')
    .update({ status: 'failed', updated_at: nowIso })
    .eq('status', 'posting')
    .lt('updated_at', cutoff)
    .select('id')
  summary.interrupted = stuck?.length ?? 0

  // 2. Claim due posts. The status filter on the UPDATE makes the claim atomic: if two runners
  //    race, only one UPDATE still matches a given row.
  const { data: due, error: dueError } = await db
    .from('scheduled_posts')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (dueError) throw new Error(`due_posts_query_failed: ${dueError.message}`)
  if (!due || due.length === 0) return summary

  const { data: claimed, error: claimError } = await db
    .from('scheduled_posts')
    .update({ status: 'posting', updated_at: nowIso })
    .in('id', due.map((row: { id: string }) => row.id))
    .eq('status', 'scheduled')
    .select('*')
  if (claimError) throw new Error(`claim_failed: ${claimError.message}`)
  summary.claimed = claimed?.length ?? 0

  for (const row of (claimed ?? []) as Record<string, unknown>[]) {
    const postId = String(row.id)
    const ownerId = String(row.owner_id)
    try {
      const platforms = asArray(row.platforms)
      const { data: accountRows } = await db
        .from('social_accounts')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('is_connected', true)
        .in('platform', platforms.length ? platforms : ['none'])

      // Accounts without a stored token were added with the old "mock" connect and cannot post.
      const accounts: AccountToken[] = ((accountRows ?? []) as Record<string, unknown>[])
        .map((a): AccountToken | null => {
          const accessToken = tryDecrypt(a.access_token)
          if (!accessToken || typeof a.account_id !== 'string') return null
          return {
            id: String(a.id),
            platform: String(a.platform),
            accountId: a.account_id,
            accountName: String(a.account_name ?? a.account_id),
            accessToken,
            refreshToken: tryDecrypt(a.refresh_token),
            tokenExpires: typeof a.token_expires === 'string' ? new Date(a.token_expires) : null,
            metadata: asObject(a.metadata),
          }
        })
        .filter((a): a is AccountToken => a !== null)

      const save = async (results: PostResults) => {
        await db.from('scheduled_posts').update({ post_results: results, updated_at: deps.now().toISOString() }).eq('id', postId)
      }

      const outcome = await publishPost(
        {
          content: String(row.content ?? ''),
          hashtags: asArray(row.hashtags),
          mediaUrls: asArray(row.media_urls),
          platforms,
          previous: asObject(row.post_results) as PostResults,
        },
        {
          accounts,
          env,
          deps,
          onProgress: save,
          onTokens: async (account, tokens) => {
            await db.from('social_accounts').update({
              access_token: encrypt(tokens.accessToken),
              refresh_token: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
              token_expires: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
              updated_at: deps.now().toISOString(),
            }).eq('id', account.id)
          },
        },
      )

      const finishedAt = deps.now().toISOString()
      await db.from('scheduled_posts').update({
        status: outcome.status,
        post_results: outcome.results,
        posted_at: outcome.status === 'posted' ? finishedAt : null,
        updated_at: finishedAt,
      }).eq('id', postId)

      if (outcome.status === 'posted') {
        summary.posted += 1
      } else {
        summary.failed += 1
        await notify({
          ownerId,
          source: 'system',
          severity: 'error',
          title: `Scheduled post failed: ${String(row.title ?? 'Untitled')}`,
          message: 'One or more platforms did not accept the post. Open Social Scheduler to see why and reschedule it.',
          actionUrl: '/?view=marketing',
          metadata: { postId },
        })
      }
    } catch (err) {
      // Unexpected failure (database, decrypt...). The post may or may not have gone out, so it is
      // marked failed with the reason instead of being retried automatically.
      summary.failed += 1
      console.error('[Buildr] scheduled post failed unexpectedly:', postId, err instanceof Error ? err.message : err)
      await db.from('scheduled_posts').update({
        status: 'failed',
        post_results: { _error: { ok: false, error: err instanceof Error ? err.message : 'unexpected_error', accounts: {} } },
        updated_at: deps.now().toISOString(),
      }).eq('id', postId)
    }
  }
  return summary
}
