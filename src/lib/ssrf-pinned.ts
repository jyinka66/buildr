import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { isBlockedIp } from './ssrf-ip.ts'

type AddressRecord = { address: string; family: number }

async function resolvePublicAddress(hostnameInput: string): Promise<AddressRecord> {
  const hostname = hostnameInput.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const family = isIP(hostname)
  if (family) {
    if (isBlockedIp(hostname)) throw new Error('SSRF blocked: private address')
    return { address: hostname, family }
  }

  let records: AddressRecord[]
  try {
    records = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('SSRF blocked: DNS resolution failed')
  }
  if (!records.length || records.some((record) => isBlockedIp(record.address))) {
    throw new Error('SSRF blocked: unsafe DNS answer')
  }
  return records[0]
}

async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (typeof Blob !== 'undefined' && body instanceof Blob) return Buffer.from(await body.arrayBuffer())
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Buffer[] = []
    try {
      for (;;) {
        const item = await reader.read()
        if (item.done) break
        chunks.push(Buffer.from(item.value))
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  }
  // Never fall back to global fetch for an unsupported body: that would lose
  // the DNS pin and reintroduce the rebinding vulnerability.
  throw new Error('safe_fetch_unsupported_body_type')
}

/**
 * Send a single HTTP(S) request through a lookup function pinned to a checked
 * public IP. The URL hostname remains in the request options, preserving the
 * Host header and TLS SNI/certificate verification while the socket connects
 * to the exact address that was checked.
 */
export async function fetchWithPinnedAddress(url: URL, init: RequestInit): Promise<Response> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SSRF blocked: unsupported protocol')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const address = await resolvePublicAddress(hostname)
  const body = await bodyToBuffer(init.body)
  const headers = new Headers(init.headers)
  // Let Node build Host from the validated URL authority, not a caller header.
  headers.delete('host')
  if (body && !headers.has('content-length')) headers.set('content-length', String(body.byteLength))

  const lookupPinned = (
    _host: string,
    options: { all?: boolean } | number,
    callback: (...args: unknown[]) => void,
  ) => {
    if (typeof options === 'object' && options?.all) callback(null, [address])
    else callback(null, address.address, address.family)
  }

  const headerRecord: Record<string, string> = {}
  headers.forEach((value, key) => { headerRecord[key] = value })
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
  const path = `${url.pathname || '/'}${url.search}`
  const requestOptions = {
    protocol: url.protocol,
    hostname,
    port,
    method: (init.method || 'GET').toUpperCase(),
    path,
    headers: headerRecord,
    lookup: lookupPinned as never,
    agent: false as const,
    ...(url.protocol === 'https:' && !isIP(hostname) ? { servername: hostname } : {}),
  }

  return await new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = transport(requestOptions, (res) => {
      const responseHeaders = new Headers()
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1])
      }
      const status = res.statusCode || 502
      const responseBody = status === 204 || status === 304 || (status >= 100 && status < 200)
        ? null
        : Readable.toWeb(res) as ReadableStream<Uint8Array>
      resolve(new Response(responseBody, {
        status,
        statusText: res.statusMessage || '',
        headers: responseHeaders,
      }))
    })

    const signal = init.signal
    const abort = () => req.destroy(signal?.reason instanceof Error ? signal.reason : new Error('safe_fetch_aborted'))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    req.once('close', () => signal?.removeEventListener('abort', abort))
    req.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    if (body?.byteLength) req.write(body)
    req.end()
  })
}
