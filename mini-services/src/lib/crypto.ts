// API key encryption at rest (AES-256-GCM).
// ------------------------------------------------------------------
// LLM provider API keys are encrypted before being stored in Supabase
// and decrypted only when needed for an outbound request. The master
// key is ENCRYPTION_KEY in .env (32-byte hex string, e.g. from
// `openssl rand -hex 32`). If unset, keys are stored as-is with a
// plaintext marker prefix — this is a dev fallback and logged as a
// warning in production.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const MASTER_KEY = process.env.ENCRYPTION_KEY || ''
const PLAINTEXT_PREFIX = 'plain:' // marker for unencrypted (dev fallback)

function getKey(): Buffer | null {
  if (!MASTER_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY must be set in production. Generate with: openssl rand -hex 32',
      )
    }
    return null
  }
  // Accept hex (64 chars = 32 bytes) — the recommended format.
  if (/^[0-9a-f]{64}$/i.test(MASTER_KEY)) {
    return Buffer.from(MASTER_KEY, 'hex')
  }
  // SECURITY: reject non-hex keys that aren't exactly 32 characters.
  // Previously, longer keys were silently truncated to 32 chars, which
  // reduces entropy and can cause key mismatches across deployments.
  // In production, require a proper 64-char hex key.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production. ' +
        'Generate with: openssl rand -hex 32',
    )
  }
  // Dev only: accept any 32-char string as a raw key.
  if (MASTER_KEY.length === 32) {
    return Buffer.from(MASTER_KEY, 'utf-8')
  }
  if (MASTER_KEY.length < 32) {
    console.warn('[Buildr] ENCRYPTION_KEY is shorter than 32 chars — encryption disabled (dev only).')
    return null
  }
  // Dev only: truncate longer keys with a warning.
  console.warn('[Buildr] ENCRYPTION_KEY is longer than 32 chars — truncating (dev only). Use a 64-char hex key in production.')
  return Buffer.from(MASTER_KEY.slice(0, 32), 'utf-8')
}

/** Encrypts a plaintext string. Returns a base64 payload (iv:ciphertext:tag). */
export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const key = getKey()
  if (!key) {
    // Dev fallback — store marked plaintext. Not for production.
    return PLAINTEXT_PREFIX + plaintext
  }
  const iv = randomBytes(12) // GCM standard nonce size
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':')
}

/** Decrypts a payload from encrypt(). Returns the plaintext string. */
export function decrypt(payload: string): string {
  if (!payload) return ''
  // SECURITY: in production, reject plaintext-stored secrets. They
  // indicate the secret was stored without encryption (dev fallback)
  // and should not be trusted in a production environment.
  if (payload.startsWith(PLAINTEXT_PREFIX)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to decrypt plaintext secret in production. ' +
          'Re-encrypt the secret with ENCRYPTION_KEY set, or migrate it using the rotation tool.',
      )
    }
    return payload.slice(PLAINTEXT_PREFIX.length)
  }
  const key = getKey()
  if (!key) {
    throw new Error('ENCRYPTION_KEY not set — cannot decrypt stored secrets.')
  }
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format.')
  const iv = Buffer.from(parts[0], 'base64')
  const encrypted = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

/** Whether encryption is active (true) or in dev-fallback plaintext mode. */
export function isEncryptionActive(): boolean {
  return Boolean(getKey())
}
