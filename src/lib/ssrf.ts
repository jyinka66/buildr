import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fetchWithPinnedAddress } from './ssrf-pinned.ts'
import { isBlockedIp } from './ssrf-ip.ts'
export { isBlockedIp } from './ssrf-ip.ts'

export interface SsrfCheckResult {
  ok: boolean
  reason?: string
}

export async function isUrlSafe(urlStr: string, opts?: { resolveDns?: boolean }): Promise<SsrfCheckResult> {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'unsupported_protocol' }
  if (url.username || url.password) return { ok: false, reason: 'embedded_credentials' }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hostname || hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost') || hostname.toLowerCase().endsWith('.local')) {
    return { ok: false, reason: 'blocked_hostname' }
  }
  if (isIP(hostname)) return isBlockedIp(hostname) ? { ok: false, reason: 'blocked_ip' } : { ok: true }
  // safeFetch uses the connection-pinned transport below, which resolves and
  // validates DNS with the request's abort signal. Avoid a separate unabortable
  // lookup that could hang before the pinned connection is even attempted.
  if (opts?.resolveDns === false) return { ok: true }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    if (!records.length) return { ok: false, reason: 'dns_no_records' }
    // Reject the entire hostname if ANY address is non-public.
    if (records.some(record => isBlockedIp(record.address))) return { ok: false, reason: 'blocked_ip' }
    return { ok: true }
  } catch {
    // A failed DNS lookup is not evidence that a destination is safe.
    return { ok: false, reason: 'dns_resolution_failed' }
  }
}

function retainTimeoutUntilBodyConsumed(response: Response, cleanup: () => void): Response {
  if (!response.body) {
    cleanup()
    return response
  }
  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          controller.close()
          cleanup()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        controller.error(error)
        cleanup()
      }
    },
    async cancel(reason) {
      cleanup()
      await reader.cancel(reason)
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/** Fetch an untrusted URL with redirect-by-redirect SSRF checks and a hard timeout. */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; maxRedirects?: number },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 15_000
  const maxRedirects = opts?.maxRedirects ?? 3
  const controller = new AbortController()
  const externalSignal = init?.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  let cleanedUp = false
  let timeoutTransferredToBody = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    if (timer) clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
  const abortFromCaller = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) abortFromCaller()
    else externalSignal.addEventListener('abort', abortFromCaller, { once: true })
  }
  timer = setTimeout(() => {
    controller.abort(new Error('safe_fetch_timeout'))
    cleanup()
  }, timeoutMs)

  try {
    let current = new URL(url)
    let method = (init?.method ?? 'GET').toUpperCase()
    let body = init?.body
    let headers = new Headers(init?.headers)

    for (let redirectCount = 0; ; redirectCount++) {
      const check = await isUrlSafe(current.toString(), { resolveDns: false })
      if (!check.ok) throw new Error(`SSRF blocked: ${check.reason}`)
      const response = await fetchWithPinnedAddress(current, { ...init, method, body, headers, redirect: 'manual', signal: controller.signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        timeoutTransferredToBody = Boolean(response.body)
        return retainTimeoutUntilBodyConsumed(response, cleanup)
      }

      const location = response.headers.get('location')
      if (!location) {
        timeoutTransferredToBody = Boolean(response.body)
        return retainTimeoutUntilBodyConsumed(response, cleanup)
      }
      if (redirectCount >= maxRedirects) {
        await response.body?.cancel().catch(() => {})
        throw new Error('safe_fetch_too_many_redirects')
      }
      const next = new URL(location, current)
      if (current.protocol === 'https:' && next.protocol !== 'https:') {
        await response.body?.cancel().catch(() => {})
        throw new Error('safe_fetch_https_downgrade_blocked')
      }
      await response.body?.cancel().catch(() => {})
      if (next.origin !== current.origin) {
        headers.delete('authorization')
        headers.delete('cookie')
        headers.delete('proxy-authorization')
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
        headers.delete('content-length')
        headers.delete('content-type')
      }
      current = next
    }
  } finally {
    if (!timeoutTransferredToBody) cleanup()
  }
}
