// Publish one scheduled post to every platform it targets, and report per-platform results.
//
// Pure with respect to storage: the caller loads the accounts (with decrypted tokens) and
// passes callbacks for persistence, so this runs under plain `node --test` and the
// duplicate-safety rules below can be tested without a database.
//
// Duplicate safety (a social post cannot be unsent):
//   - results are persisted after every single account via `onProgress`
//   - an account that already succeeded on an earlier attempt is skipped on retry, so
//     rescheduling a partly failed post only retries the failures

import { getProvider, SocialApiError, type PlatformKey, type ProviderDeps, type SocialProvider, type TokenSet } from './providers.ts'

export interface AccountToken {
  /** social_accounts row id. */
  id: string
  platform: string
  accountId: string
  accountName: string
  accessToken: string
  refreshToken: string | null
  tokenExpires: Date | null
  metadata?: Record<string, unknown>
}

export interface AccountResult {
  ok: boolean
  name: string
  postId?: string
  url?: string | null
  error?: string
  at: string
}

export interface PlatformResult {
  ok: boolean
  /** Set when the platform could not be attempted at all (no account, text too long...). */
  error?: string
  accounts: Record<string, AccountResult>
}

export type PostResults = Record<string, PlatformResult>

export interface PostToPublish {
  content: string
  hashtags: string[]
  mediaUrls: string[]
  platforms: string[]
  /** Results from earlier attempts, used to skip accounts that already posted. */
  previous: PostResults
}

export interface PublishContext {
  accounts: AccountToken[]
  env: Record<string, string | undefined>
  deps: ProviderDeps
  /** Called when a token was refreshed so the caller can store it. */
  onTokens: (account: AccountToken, tokens: TokenSet) => Promise<void>
  /** Called after every account attempt so progress survives a crash. */
  onProgress: (results: PostResults) => Promise<void>
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000

export function buildText(post: Pick<PostToPublish, 'content' | 'hashtags'>, provider: SocialProvider, mediaUrls: string[]): string {
  const tags = post.hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
  let text = post.content.trim()
  if (tags.length) text += `\n\n${tags.join(' ')}`
  if (provider.mediaInText && mediaUrls.length) text += `\n\n${mediaUrls.join('\n')}`
  return text
}

/** X counts every link as 23 characters regardless of its real length. */
export function textLength(text: string, platform: string): number {
  if (platform !== 'x') return [...text].length
  return [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error')

export async function publishPost(post: PostToPublish, ctx: PublishContext): Promise<{ status: 'posted' | 'failed'; results: PostResults }> {
  const results: PostResults = {}
  for (const [platform, prior] of Object.entries(post.previous ?? {})) {
    if (prior && typeof prior === 'object' && prior.accounts) results[platform] = { ...prior, accounts: { ...prior.accounts } }
  }

  for (const platform of post.platforms) {
    const provider = getProvider(platform)
    const entry: PlatformResult = results[platform] ?? { ok: false, accounts: {} }
    delete entry.error
    results[platform] = entry

    if (!provider) {
      entry.error = `Unknown platform "${platform}".`
      continue
    }
    const targets = ctx.accounts.filter((a) => a.platform === platform)
    if (targets.length === 0) {
      // Every earlier success stays a success even if the account has since been disconnected.
      if (entry.ok && Object.keys(entry.accounts).length > 0) continue
      entry.error = `No account is linked for ${provider.label}. Connect one with "Connect account" and try again.`
      await ctx.onProgress(results)
      continue
    }

    const text = buildText(post, provider, post.mediaUrls)
    const length = textLength(text, platform)
    if (!text) {
      entry.error = 'The post has no text.'
      await ctx.onProgress(results)
      continue
    }
    if (length > provider.maxTextLength) {
      entry.error = `The post is ${length} characters, but ${provider.label} allows ${provider.maxTextLength}.`
      await ctx.onProgress(results)
      continue
    }

    for (const account of targets) {
      if (entry.accounts[account.accountId]?.ok) continue
      const at = ctx.deps.now().toISOString()
      try {
        await ensureFreshToken(provider, account, ctx)
        const published = await provider.publish(
          { accountId: account.accountId, accessToken: account.accessToken, metadata: account.metadata },
          { text, mediaUrls: post.mediaUrls },
          ctx.deps,
          ctx.env,
        )
        entry.accounts[account.accountId] = { ok: true, name: account.accountName, postId: published.postId, url: published.url ?? null, at }
      } catch (err) {
        entry.accounts[account.accountId] = { ok: false, name: account.accountName, error: message(err), at }
        if (err instanceof SocialApiError && (err.status === 401 || err.status === 403)) {
          entry.accounts[account.accountId].error += ' If this keeps happening, reconnect the account.'
        }
      }
      await ctx.onProgress(results)
    }

    entry.ok = targets.every((a) => entry.accounts[a.accountId]?.ok === true)
  }

  const status = post.platforms.length > 0 && post.platforms.every((p) => results[p]?.ok === true) ? 'posted' : 'failed'
  return { status, results }
}

async function ensureFreshToken(provider: SocialProvider, account: AccountToken, ctx: PublishContext): Promise<void> {
  if (!account.tokenExpires) return
  if (account.tokenExpires.getTime() - ctx.deps.now().getTime() > REFRESH_MARGIN_MS) return
  if (!account.refreshToken || !provider.refresh) {
    throw new SocialApiError(`The ${provider.label} connection has expired. Reconnect the account.`, 401)
  }
  const tokens = await provider.refresh(ctx.env, account.refreshToken, ctx.deps)
  account.accessToken = tokens.accessToken
  account.refreshToken = tokens.refreshToken ?? account.refreshToken
  account.tokenExpires = tokens.expiresAt ?? null
  await ctx.onTokens(account, tokens)
}

export type { PlatformKey }
