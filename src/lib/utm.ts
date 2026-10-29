// UTM + short link generation helpers for the Campaign ROI Tracking feature.
// ------------------------------------------------------------------
// Builds UTM-tagged destination URLs, generates 6-char short codes, and
// persists tracking rows into the `campaign_tracking` table via the shared
// `db` proxy (works with real Supabase or the local in-memory store).
//
// Table shape (created on demand by the local store; add to supabase/schema.sql
// for production):
//   campaign_tracking (
//     id, owner_id, short_code, destination_url, utm jsonb,
//     campaign_id, post_id, clicks int, conversions int, revenue_kobo int,
//     last_clicked_at, created_at, updated_at
//   )

import { db } from '@/lib/db'

export const SHORT_URL_BASE =
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export interface UTMParams {
  source: string
  medium: string
  campaign: string
  content?: string
}

export interface TrackingLinkInput {
  ownerId: string
  destinationUrl: string
  utm: UTMParams
  campaignId?: string | null
  postId?: string | null
}

export interface CreatedTrackingLink {
  shortCode: string
  trackingId: string
  shortUrl: string
}

// 6-char alphanumeric alphabet (no ambiguous chars: 0/O, 1/I/l).
const SHORT_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Generate a 6-character alphanumeric short code. */
export function generateShortCode(): string {
  const len = 6
  let out = ''
  // Prefer crypto.getRandomValues when available (browser + Node 18+).
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(len)
    crypto.getRandomValues(buf)
    for (let i = 0; i < len; i++) out += SHORT_ALPHABET[buf[i] % SHORT_ALPHABET.length]
    return out
  }
  // Fallback (shouldn't normally hit this in Next.js runtime).
  for (let i = 0; i < len; i++) out += SHORT_ALPHABET[Math.floor(Math.random() * SHORT_ALPHABET.length)]
  return out
}

/**
 * Build a full destination URL with UTM parameters appended.
 * Preserves any existing query string on the destination URL and merges
 * UTM params in (UTM wins on conflict).
 */
export function generateUTM(input: {
  destinationUrl: string
  source: string
  medium: string
  campaign: string
  content?: string
}): string {
  const { destinationUrl, source, medium, campaign, content } = input
  try {
    const url = new URL(destinationUrl)
    if (source) url.searchParams.set('utm_source', source)
    if (medium) url.searchParams.set('utm_medium', medium)
    if (campaign) url.searchParams.set('utm_campaign', campaign)
    if (content) url.searchParams.set('utm_content', content)
    return url.toString()
  } catch {
    // destinationUrl wasn't absolute — return as-is so we don't break the redirect.
    return destinationUrl
  }
}

/**
 * Insert a new tracking link row and return the short code + tracking id.
 * Retries short-code generation if a collision is found (rare for 6 chars).
 */
export async function createTrackingLink(
  input: TrackingLinkInput,
): Promise<CreatedTrackingLink> {
  const { ownerId, destinationUrl, utm, campaignId, postId } = input

  // Try a few times in case of a short-code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortCode = generateShortCode()

    // Ensure uniqueness of the short code before inserting.
    const { data: existing } = await db
      .from('campaign_tracking')
      .select('id')
      .eq('short_code', shortCode)
      .maybeSingle()

    if (existing) continue

    const { data, error } = await db
      .from('campaign_tracking')
      .insert({
        owner_id: ownerId,
        short_code: shortCode,
        destination_url: destinationUrl,
        utm: {
          source: utm.source,
          medium: utm.medium,
          campaign: utm.campaign,
          content: utm.content ?? null,
        },
        campaign_id: campaignId ?? null,
        post_id: postId ?? null,
        clicks: 0,
        conversions: 0,
        revenue_kobo: 0,
        last_clicked_at: null,
      })
      .select('*')
      .single()

    if (error) {
      throw new Error(`Failed to create tracking link: ${error.message}`)
    }

    const trackingId = (data as { id?: string } | null)?.id ?? shortCode
    return {
      shortCode,
      trackingId,
      shortUrl: `${SHORT_URL_BASE}/api/marketing/track?c=${shortCode}`,
    }
  }

  // Extremely unlikely — 6 chars from a 31-char alphabet = ~887M combos.
  throw new Error('Could not allocate a unique short code after 5 attempts.')
}

/**
 * Build the final redirect URL for a tracking row (destination + UTM).
 * Reads the stored UTM JSON and applies it via generateUTM.
 */
export function buildRedirectUrl(row: {
  destination_url: string
  utm?: { source?: string; medium?: string; campaign?: string; content?: string } | null
}): string {
  const utm = row.utm ?? {}
  return generateUTM({
    destinationUrl: row.destination_url,
    source: utm.source ?? '',
    medium: utm.medium ?? '',
    campaign: utm.campaign ?? '',
    content: utm.content ?? undefined,
  })
}
