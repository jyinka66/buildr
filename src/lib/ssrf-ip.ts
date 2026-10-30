import { isIP } from 'node:net'

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value * 256 + octet) >>> 0
  }
  return value >>> 0
}

function inIpv4Cidr(ip: string, network: string, prefix: number): boolean {
  const address = ipv4ToNumber(ip)
  const base = ipv4ToNumber(network)
  if (address === null || base === null) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (address & mask) === (base & mask)
}

function ipv6ToBigInt(input: string): bigint | null {
  let ip = input.toLowerCase().split('%')[0]
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':')
    if (lastColon < 0) return null
    const v4 = ipv4ToNumber(ip.slice(lastColon + 1))
    if (v4 === null) return null
    ip = `${ip.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  if (!ip.includes(':')) return null
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const words = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
  if (words.length !== 8 || words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null
  return words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n)
}

function inIpv6Cidr(ip: string, network: string, prefix: number): boolean {
  const address = ipv6ToBigInt(ip)
  const base = ipv6ToBigInt(network)
  if (address === null || base === null) return false
  const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n)
  return (address & mask) === (base & mask)
}

const BLOCKED_IPV4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const BLOCKED_IPV6: Array<[string, number]> = [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['3fff::', 20], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]

export function isBlockedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const version = isIP(normalized)
  if (version === 4) return BLOCKED_IPV4.some(([network, prefix]) => inIpv4Cidr(normalized, network, prefix))
  if (version === 6) {
    // IPv6 destinations are allowed only from global unicast space (2000::/3),
    // then known special-use/reserved ranges are denied.
    if (!inIpv6Cidr(normalized, '2000::', 3)) return true
    return BLOCKED_IPV6.some(([network, prefix]) => inIpv6Cidr(normalized, network, prefix))
  }
  return true
}
