// NextAuth configuration — credentials provider with 2FA + admin support.
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { syncAdminFlag, isUserAdmin } from '@/lib/admin'
import { verifyCode, hashBackupCode } from '@/lib/totp'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'

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

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: '/' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' }, totpCode: { label: '2FA Code', type: 'text' } },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        const totpCode = credentials?.totpCode?.trim() ?? ''
        if (!email || !password) return null

        // Limit repeated guesses for the same normalized account identifier.
        // The counter is stored in Postgres so attempts are shared across app instances.
        const loginAttempt = await distributedRateLimit(`login:${email}`, { limit: 10, windowMs: 15 * 60 * 1000 })
        if (!loginAttempt.ok) return null

        const { data: user, error } = await db.from('users').select('id, email, name, password, is_disabled, totp_secret, totp_enabled, totp_backup_codes').eq('email', email).single()
        if (error || !user || !user.password) return null
        if (user.is_disabled) return null

        const ok = await bcrypt.compare(password, user.password)
        if (!ok) return null

        // 2FA check
        if (user.totp_enabled) {
          if (!totpCode) return null
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
          if (!twoFactorOk) return null
        }

        await syncAdminFlag(user.id, user.email)
        return { id: user.id, email: user.email, name: user.name ?? undefined }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id
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
