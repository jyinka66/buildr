// TOTP helper — Time-based One-Time Password (RFC 6238) using only Node's crypto.
import { createHash, createHmac, randomBytes } from 'crypto'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer: Buffer): string {
  let result = '', bits = 0, value = 0
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { result += BASE32_CHARS[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31]
  return result
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').toUpperCase()
  let bits = 0, value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(bytes)
}

export function generateSecret(): string { return base32Encode(randomBytes(20)) }

function computeTotp(secret: string, time: number = Date.now()): string {
  const counter = Math.floor(time / 1000 / 30)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret))
  hmac.update(buffer)
  const digest = hmac.digest()
  const offset = digest[digest.length - 1] & 0x0f
  const truncated = ((digest[offset] & 0x7f) << 24 | (digest[offset + 1] & 0xff) << 16 | (digest[offset + 2] & 0xff) << 8 | (digest[offset + 3] & 0xff))
  return (truncated % 1000000).toString().padStart(6, '0')
}

export function verifyCode(secret: string, code: string): boolean {
  const cleanCode = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleanCode)) return false
  const now = Date.now()
  for (const offset of [-1, 0, 1]) {
    if (computeTotp(secret, now + offset * 30000) === cleanCode) return true
  }
  return false
}

export function buildOtpAuthUrl(secret: string, email: string, issuer: string = 'Buildr'): string {
  const label = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${params.toString()}`
}

export function generateBackupCodes(): string[] {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codes: string[] = []
  for (let i = 0; i < 8; i++) {
    let code = ''
    for (let j = 0; j < 8; j++) code += chars[randomBytes(1)[0] % chars.length]
    codes.push(code)
  }
  return codes
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase() + 'buildr-backup-salt').digest('hex')
}
