// Shared Server-Sent-Events engine for conversational chat.
// ------------------------------------------------------------------
// Used by /api/chat/stream (no project) and /api/projects/[id]/chat-stream
// (project chat). It streams the model's reasoning ('thinking') and answer
// ('token') live, supports the user pressing Stop, meters token usage, and —
// for project chat — detects the BUILD_MARKER and tells the client to hand the
// request to the existing build route instead of answering.
//
// Events sent to the client (each as `data: {json}`; stream ends with [DONE]):
//   { type: 'thinking', content }  reasoning text, when the model exposes it
//   { type: 'token', content }     answer text
//   { type: 'build' }              this request should be built, not chatted
//   { type: 'done', provider, tokens, durationMs }
//   { type: 'error', message }
import { completeStream, type ChatMessage } from '@/lib/llm/router'
import { classifyReplyHead } from '@/lib/llm/chat-prompts'
import { releaseUsageReservation, trackUsage } from '@/lib/billing'

export interface ChatSseParams {
  req: Request
  userId: string
  messages: ChatMessage[]
  providerKey: string | null
  reservationId?: string
  projectId?: string
  // Project chat only: let the model hand real build requests to the builder.
  allowBuildHandoff: boolean
  // Called once, as soon as the reply is known to be a normal chat answer
  // (not a build handoff). Project chat uses it to record the user's turn.
  onChatStarted?: () => Promise<void>
  // Called after the answer finished (or was stopped) with what was shown.
  onChatFinished?: (r: {
    content: string
    providerId: string | null
    tokens: number
    durationMs: number
  }) => Promise<void>
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
}

export function createChatSseResponse(p: ChatSseParams): Response {
  const encoder = new TextEncoder()
  const abort = new AbortController()
  if (p.req.signal.aborted) abort.abort()
  else p.req.signal.addEventListener('abort', () => abort.abort(), { once: true })

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          closed = true
        }
      }

      let handedOff = false
      let decided = !p.allowBuildHandoff
      let head = ''
      let content = ''
      let providerInfo: { id: string; name: string; model: string } | null = null
      let tokens = 0
      let durationMs = 0
      let failure: string | null = null
      const startedAt = Date.now()

      const startChat = async () => {
        decided = true
        await p.onChatStarted?.()
      }

      try {
        for await (const event of completeStream(
          p.messages,
          'general',
          // Deep reasoning only when the person is purely chatting; in auto
          // mode a hidden reasoning pass just delays the answer or the build.
          { temperature: 0.7, maxTokens: 4000, reasoning: !p.allowBuildHandoff, signal: abort.signal },
          (p.providerKey as never) ?? null,
        )) {
          if (event.type === 'thinking') {
            send({ type: 'thinking', content: event.content })
          } else if (event.type === 'token') {
            if (!decided) {
              head += event.content
              const verdict = classifyReplyHead(head)
              // Still possibly the start of the marker: keep holding it back.
              if (verdict === 'wait') continue
              if (verdict === 'build') {
                handedOff = true
                abort.abort()
                break
              }
              await startChat()
              content += head
              send({ type: 'token', content: head })
              head = ''
            } else {
              content += event.content
              send({ type: 'token', content: event.content })
            }
          } else if (event.type === 'done') {
            providerInfo = { id: event.provider.id, name: event.provider.name, model: event.provider.model }
            tokens = event.tokens
            durationMs = event.durationMs
          } else if (event.type === 'error') {
            failure = event.message
          }
        }

        if (handedOff) {
          // Nothing was answered or recorded; the client now calls the builder.
          send({ type: 'build' })
          return
        }

        if (failure) throw new Error(failure)

        // A very short reply that never grew past a marker prefix.
        if (!decided && head) {
          await startChat()
          content += head
          send({ type: 'token', content: head })
          head = ''
        }

        const stopped = abort.signal.aborted
        if (!tokens) {
          // Stopped early (no 'done' event): estimate from what was exchanged.
          tokens = Math.ceil(
            (p.messages.reduce((n, m) => n + m.content.length, 0) + content.length) / 4,
          )
          durationMs = Date.now() - startedAt
        }

        if (content.trim() || !stopped) {
          const recorded = await trackUsage(p.userId, 'llm_tokens', tokens, {
            projectId: p.projectId,
            reservationId: p.reservationId,
          })
          if (!recorded) console.error('[Buildr] chat usage could not be recorded for user', p.userId)
        }

        if (content.trim()) {
          await p.onChatFinished?.({
            content,
            providerId: providerInfo?.id ?? null,
            tokens,
            durationMs,
          })
        }

        send({ type: 'done', provider: providerInfo, tokens, durationMs, stopped })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'stream_failed' })
      } finally {
        // Always free the usage reservation so the next request (including the
        // build handoff) is not blocked by this one.
        await releaseUsageReservation(p.userId, p.reservationId).catch(() => undefined)
        if (!closed) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {
            /* client already disconnected */
          }
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

export function jsonError(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })
}
