// Browser-side reader for Buildr's conversational chat streams
// (/api/chat/stream and /api/projects/[id]/chat-stream). See
// lib/llm/chat-sse.ts for the event format. The build pipeline
// (generate-stream) has its own reader in the store and is not affected.

export interface ChatDoneInfo {
  provider: { id: string; name: string; model: string } | null
  tokens: number
  durationMs: number
  stopped?: boolean
}

export interface ChatStreamHandlers {
  onThinking?: (text: string) => void
  // Called once, when the model stops thinking and starts answering (or the
  // stream ends). `ms` is how long it thought.
  onThinkingEnd?: (ms: number) => void
  onToken?: (text: string) => void
  // The request should be built by the builder instead of answered in chat.
  onBuild?: () => void
  onDone?: (info: ChatDoneInfo) => void
}

type ChatEvent =
  | { type: 'thinking'; content: string }
  | { type: 'token'; content: string }
  | { type: 'build' }
  | ({ type: 'done' } & ChatDoneInfo)
  | { type: 'error'; message?: string }

export async function streamChat(
  url: string,
  body: unknown,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let message = `chat_failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.message) message = String(data.message)
      else if (data?.error) message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
    } catch {
      /* keep the default message */
    }
    throw new Error(message)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no_stream_body')

  const decoder = new TextDecoder()
  let buffer = ''
  let thinkingStartedAt: number | null = null
  let thinkingReported = false

  const endThinking = () => {
    if (thinkingStartedAt !== null && !thinkingReported) {
      thinkingReported = true
      handlers.onThinkingEnd?.(Date.now() - thinkingStartedAt)
    }
  }

  const handle = (evt: ChatEvent) => {
    switch (evt.type) {
      case 'thinking':
        if (thinkingStartedAt === null) thinkingStartedAt = Date.now()
        handlers.onThinking?.(evt.content)
        break
      case 'token':
        endThinking()
        handlers.onToken?.(evt.content)
        break
      case 'build':
        handlers.onBuild?.()
        break
      case 'done':
        endThinking()
        handlers.onDone?.({
          provider: evt.provider ?? null,
          tokens: evt.tokens ?? 0,
          durationMs: evt.durationMs ?? 0,
          stopped: evt.stopped,
        })
        break
      case 'error':
        throw new Error(evt.message || 'stream_error')
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue
        let evt: ChatEvent | null = null
        try {
          evt = JSON.parse(data) as ChatEvent
        } catch {
          evt = null // ignore keep-alives / partial frames
        }
        if (evt) handle(evt)
      }
    }
  } finally {
    // If the stream ended while still thinking (stopped or failed), report it.
    endThinking()
  }
}
