import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent } from 'undici'
import { isBlockedIp } from '@/lib/ssrf'

const BLOCKED = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^fc/i, /^fd/i, /^fe80:/i,
]

function privateAddress(address: string): boolean {
  if (address.includes(':')) return !address.toLowerCase().startsWith('2') || BLOCKED.some(pattern => pattern.test(address))
  return BLOCKED.some(pattern => pattern.test(address)) || address.startsWith('100.64.') || address.startsWith('192.0.2.')
}

/** Creates a one-request dispatcher pinned to a checked public DNS answer. */
export async function createPublicPinnedDispatcher(host: string): Promise<Agent> {
  const hostname = host.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  let address = hostname
  let family = isIP(hostname)
  if (family === 0) {
    const records = await lookup(hostname, { all: true, verbatim: true })
    if (!records.length || records.some(record => privateAddress(record.address))) {
      throw new Error('SSRF blocked: unsafe DNS answer')
    }
    address = records[0].address
    family = records[0].family
  }
  if (privateAddress(address)) throw new Error('SSRF blocked: private address')
  const pinnedLookup = (
    _hostname: string,
    _options: unknown,
    callback: (error: NodeJS.ErrnoException | null, address: string, family?: number) => void,
  ) => callback(null, address, family)
  return new Agent({ connect: { lookup: pinnedLookup as never } })
}
