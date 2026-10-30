// NextAuth configuration — credentials provider with 2FA + admin support.
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { syncAdminFlag, isUserAdmin } from '@/lib/admin'
import { verifyCode, hashBackupCode } from '@/lib/totp'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { trustedClientIp } from '@/lib/rate-limit'

// SECURITY: In production, NEXTAUTH_SECRET MUST be set. The hardcoded
// fallback is for local dev only — if it leaks, anyone can mint valid
// JWTs for any user. We refuse to start in production without a real
// secret (checked at module load).
const DEV_SECRET = 'buildr-dev-secret-change-in-production'
const configuredSecret = process.env.NEXTAUTH_SECRET || ''
const isProduction = process.env.NODE_ENV === 'production'
// Next evaluates server modules while collecting build-time page data. The
// production secret must be enforced when the server runs, not while the
// build is compiling routes; no build-time secret is embedded into the image.
const isProductionBuild = process.env.NEXT_PHASE === 'phase-production-build'

if (isProduction && !isProductionBuild && (configuredSecret.length < 32 || configuredSecret === DEV_SECRET)) {
  throw new Error(
    'NEXTAUTH_SECRET must be at least 32 characters and must not use the dev fallback. ' +
      'Generate one with: openssl rand -base64 32 — and set it in .env',
  )
}

// Valid bcrypt hash of a random string. Compared against when the account does
// not exist so unknown and known emails take the same time to reject.
const DUMMY_HASH = '$2b$10$9JZ.KIVnluPTqvLluZ.U7eL2rOH6aJmM5.LVCQqSMQF/5MgISC9rS'

// Error codes surfaced to the client. NextAuth puts a thrown error's message in
// the `error` query param of the response URL, so these double as the contract.
// They are only thrown AFTER the password has been verified, so they cannot be
// used to probe which emails are registered.
export const AUTH_ERRORS = {
  rateLimited: 'RateLimited',
  accountDisabled: 'AccountDisabled',
  emailNotVerified: 'EmailNotVerified',
  twoFactorRequired: 'TwoFactorRequired',
  invalidTotp: 'InvalidTotp',
} as const

/**
 * Create or link the Buildr account for a verified OAuth identity.
 * Returns false when the sign-in must be refused.
 */
async function upsertOAuthUser(email: string, name?: string | null): Promise<boolean> {
  const { data: existing, error } = await db
    .from('users')
    .select('id, is_disabled, email_verified')
    .eq('email', email)
    .maybeSingle()
  if (error) return false
  if (existing) {
    if (existing.is_disabled) return false
    if (existing.email_verified !== true) {
      // Pre-hijack defence: an unverified row may have been registered by someone
      // who does not own this mailbox and knows its password. The provider has now
      // proven ownership, so discard any password and pending tokens.
      const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
      const { error: updErr } = await db
        .from('users')
        .update({ password: unusable, email_verified: true, verify_token: null, reset_token: null, reset_expires: null })
        .eq('id', existing.id)
      if (updErr) return false
    }
    return true
  }
  // New account. The random password can never be used for credentials login;
  // the user can set one through "Forgot password" if they want both methods.
  const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
  const { error: insErr } = await db
    .from('users')
    .insert({ email, name: name?.trim() || null, password: unusable, email_verified: true })
  if (!insErr) return true
  // Lost a race with a concurrent first sign-in: the row now exists.
  const { data: again } = await db.from('users').select('id, is_disabled').eq('email', email).maybeSingle()
  return Boolean(again && !again.is_disabled)
}

// OAuth providers are enabled only when their credentials are configured, and
// /api/auth/providers reports exactly this list to the sign-in dialog.
const oauthProviders: NextAuthOptions['providers'] = []
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  oauthProviders.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  )
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  oauthProviders.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: { params: { scope: 'read:user user:email' } },
      // Only trust a primary email that GitHub has verified. Without this a user
      // could attach an unverified address they do not own.
      userinfo: {
        url: 'https://api.github.com/user',
        async request({ tokens }: any) {
          const headers = { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'buildr', Accept: 'application/vnd.github+json' }
          const profile = await (await fetch('https://api.github.com/user', { headers })).json()
          const res = await fetch('https://api.github.com/user/emails', { headers })
          let verified: string | null = null
          if (res.ok) {
            const emails = (await res.json()) as { email: string; primary: boolean; verified: boolean }[]
            verified = emails.find((e) => e.primary && e.verified)?.email ?? null
          }
          return { ...profile, email: verified }
        },
      },
    }),
  )
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: '/', error: '/' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' }, totpCode: { label: '2FA Code', type: 'text' } },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        const totpCode = credentials?.totpCode?.trim() ?? ''
        if (!email || !password) return null

        // Apply an IP bucket only when the deployment explicitly trusts its
        // reverse proxy headers. Never let a caller spoof their own IP bucket.
        const requestHeaders = new Headers()
        const forwardedFor = req.headers?.['x-forwarded-for']
        const realIp = req.headers?.['x-real-ip']
        if (typeof forwardedFor === 'string') requestHeaders.set('x-forwarded-for', forwardedFor)
        if (typeof realIp === 'string') requestHeaders.set('x-real-ip', realIp)
        const clientIp = trustedClientIp(requestHeaders)
        const ipKnown = clientIp !== 'unknown' && clientIp !== 'development'
        if (ipKnown) {
          const ipAttempt = await distributedRateLimit(`login-ip:${clientIp}`, { limit: 30, windowMs: 15 * 60 * 1000 })
          if (!ipAttempt.ok) throw new Error(AUTH_ERRORS.rateLimited)
        }

        // Per-account limiting. When the client IP is trustworthy the tight bucket
        // is per email AND IP, so one attacker cannot lock the real owner out from
        // their own network; a looser per-email ceiling still caps distributed
        // guessing. Without a trusted IP we fall back to the strict per-email bucket.
        const attemptWindow = 15 * 60 * 1000
        const tight = await distributedRateLimit(ipKnown ? `login:${email}:${clientIp}` : `login:${email}`, { limit: 10, windowMs: attemptWindow })
        if (!tight.ok) throw new Error(AUTH_ERRORS.rateLimited)
        if (ipKnown) {
          const ceiling = await distributedRateLimit(`login:${email}`, { limit: 100, windowMs: attemptWindow })
          if (!ceiling.ok) throw new Error(AUTH_ERRORS.rateLimited)
        }

        const { data: user, error } = await db.from('users').select('id, email, name, password, email_verified, is_disabled, totp_secret, totp_enabled, totp_backup_codes').eq('email', email).maybeSingle()
        if (error) return null

        // Always run one bcrypt compare so a missing account costs the same time as
        // a wrong password.
        const ok = await bcrypt.compare(password, user?.password || DUMMY_HASH)
        if (!user || !user.password || !ok) return null

        // The password is now proven, so these states can be reported precisely
        // without revealing anything to someone who does not know the password.
        if (user.is_disabled) throw new Error(AUTH_ERRORS.accountDisabled)
        // Critical: unverified email accounts must never receive a session.
        if (user.email_verified !== true) throw new Error(AUTH_ERRORS.emailNotVerified)

        // 2FA check
        if (user.totp_enabled) {
          if (!totpCode) throw new Error(AUTH_ERRORS.twoFactorRequired)
          let twoFactorOk = false
          if (/^\d{6}$/.test(totpCode) && user.totp_secret) twoFactorOk = verifyCode(user.totp_secret, totpCode)
          if (!twoFactorOk && user.totp_backup_codes) {
            // SECURITY: consume the backup code atomically to prevent
            // race conditions where concurrent requests reuse the same
            // code. We filter out the matching hash and write back in
            // a single update, verifying the row changed.
            let parsedCodes: string[] = []
            try {
              parsedCodes = JSON.parse(user.totp_backup_codes)
              if (!Array.isArray(parsedCodes)) parsedCodes = []
            } catch {
              parsedCodes = []
            }
            const inputHash = hashBackupCode(totpCode)
            const matchIdx = parsedCodes.indexOf(inputHash)
            if (matchIdx !== -1) {
              const remaining = parsedCodes.filter((_, i) => i !== matchIdx)
              // Atomic update: only apply if the backup codes haven't
              // changed since we read them (optimistic concurrency).
              const { data: updated, error: updErr } = await db
                .from('users')
                .update({ totp_backup_codes: JSON.stringify(remaining) })
                .eq('id', user.id)
                .eq('totp_backup_codes', user.totp_backup_codes)
                .select('id')
                .maybeSingle()
              if (!updErr && updated) {
                twoFactorOk = true
              }
              // If the update didn't match (another request consumed it
              // first), twoFactorOk stays false → auth fails. This is
              // correct: the code was already used.
            }
          }
          if (!twoFactorOk) throw new Error(AUTH_ERRORS.invalidTotp)
        }

        await syncAdminFlag(user.id, user.email)
        return { id: user.id, email: user.email, name: user.name ?? undefined }
      },
    }),
    ...oauthProviders,
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider === 'credentials') return true
      const email = user.email?.trim().toLowerCase()
      if (!email) return false
      // Google reports whether it verified the address; GitHub is filtered in its
      // userinfo request above.
      if (account.provider === 'google' && (profile as { email_verified?: boolean } | undefined)?.email_verified !== true) return false
      return upsertOAuthUser(email, user.name)
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account && account.provider !== 'credentials') {
          // For OAuth, user.id is the provider's id. Resolve the Buildr account id.
          const { data: row } = await db.from('users').select('id, email').eq('email', (user.email ?? '').trim().toLowerCase()).maybeSingle()
          if (!row) return { ...token, id: undefined, isAdmin: false } as typeof token
          token.id = row.id
          await syncAdminFlag(row.id, row.email)
        } else {
          token.id = user.id
        }
      }
      if (token.id) {
        // Check admin flag AND disabled status on every JWT refresh.
        // This ensures a disabled user's session is revoked within the
        // JWT refresh window (not just at login).
        try {
          const { data: u } = await db.from('users')
            .select('is_admin, is_disabled')
            .eq('id', token.id as string)
            .maybeSingle()
          if (!u || u.is_disabled) {
            // Force sign-out by clearing the token.
            return { ...token, id: undefined, isAdmin: false } as typeof token
          }
          token.isAdmin = Boolean(u.is_admin)
        } catch {
          token.isAdmin = await isUserAdmin(token.id as string)
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string | undefined
        (session.user as { isAdmin?: boolean }).isAdmin = Boolean(token.isAdmin)
      }
      return session
    },
  },
  secret: configuredSecret || DEV_SECRET,
}
