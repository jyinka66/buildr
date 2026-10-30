import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
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

const MAX_REQUEST_BODY_BYTES = 1_048_576

function ensureBodyWithinLimit(body: Buffer): Buffer {
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error('safe_fetch_request_body_too_large')
  }
  return body
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal | null,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read()
  if (signal.aborted) throw new Error('safe_fetch_aborted')

  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void reader.cancel(signal.reason).catch(() => {})
      reject(new Error('safe_fetch_aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([reader.read(), aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function bodyToBuffer(
  body: BodyInit | null | undefined,
  signal?: AbortSignal | null,
): Promise<Buffer | undefined> {
  if (body == null) return undefined
  if (signal?.aborted) throw new Error('safe_fetch_aborted')
  if (typeof body === 'string') return ensureBodyWithinLimit(Buffer.from(body))
  if (body instanceof URLSearchParams) return ensureBodyWithinLimit(Buffer.from(body.toString()))
  if (body instanceof ArrayBuffer) {
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('safe_fetch_request_body_too_large')
    return Buffer.from(body)
  }
  if (ArrayBuffer.isView(body)) {
    if (body.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('safe_fetch_request_body_too_large')
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.size > MAX_REQUEST_BODY_BYTES) throw new Error('safe_fetch_request_body_too_large')
    return Buffer.from(await body.arrayBuffer())
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Buffer[] = []
    let totalBytes = 0
    try {
      for (;;) {
        const item = await readWithAbort(reader, signal)
        if (item.done) break
        totalBytes += item.value.byteLength
        if (totalBytes > MAX_REQUEST_BODY_BYTES) {
          await reader.cancel().catch(() => {})
          throw new Error('safe_fetch_request_body_too_large')
        }
        chunks.push(Buffer.from(item.value))
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks, totalBytes)
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
  const signal = init.signal
  if (signal?.aborted) throw new Error('safe_fetch_aborted')
  let abortDns: (() => void) | undefined
  const address = await Promise.race([
    resolvePublicAddress(hostname),
    ...(signal ? [new Promise<never>((_resolve, reject) => {
      abortDns = () => reject(new Error('safe_fetch_aborted'))
      if (signal.aborted) abortDns()
      else signal.addEventListener('abort', abortDns, { once: true })
    })] : []),
  ]).finally(() => {
    if (signal && abortDns) signal.removeEventListener('abort', abortDns)
  })
  if (signal?.aborted) throw new Error('safe_fetch_aborted')
  const body = await bodyToBuffer(init.body, signal)
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
    let req: ClientRequest
    const signal = init.signal
    const abort = () => req.destroy(signal?.reason instanceof Error ? signal.reason : new Error('safe_fetch_aborted'))
    const onResponse = (res: IncomingMessage) => {
      const responseHeaders = new Headers()
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1])
      }
      const status = res.statusCode || 502
      if (status < 200) {
        res.destroy()
        reject(new Error('safe_fetch_unexpected_informational_status'))
        return
      }
      res.once('end', () => signal?.removeEventListener('abort', abort))
      res.once('close', () => signal?.removeEventListener('abort', abort))
      const responseBody = status === 204 || status === 304
        ? null
        : Readable.toWeb(res) as ReadableStream<Uint8Array>
      resolve(new Response(responseBody, {
        status,
        statusText: res.statusMessage || '',
        headers: responseHeaders,
      }))
    }
    if (url.protocol === 'https:') req = httpsRequest(requestOptions, onResponse)
    else req = httpRequest(requestOptions, onResponse)

    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    req.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    if (body?.byteLength) req.write(body)
    req.end()
  })
}
