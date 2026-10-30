// Splits a streamed model response into "thinking" and "text" pieces for
// reasoning models that put their reasoning inline inside <think>…</think>
// (or <thinking>…</thinking>) tags instead of a separate reasoning field.
//
// Safety rule: the stream is only treated as reasoning when it STARTS with an
// opening tag. A response that merely mentions "<think>" later (for example
// inside generated code) passes through untouched.

export type StreamPiece = { kind: 'text' | 'thinking'; text: string }

const OPEN_TAGS = ['<think>', '<thinking>']
const CLOSE_TAGS = ['</think>', '</thinking>']
const LONGEST_TAG = Math.max(...OPEN_TAGS.map((t) => t.length), ...CLOSE_TAGS.map((t) => t.length))

type Mode = 'detect' | 'thinking' | 'text'

export class ThinkTagParser {
  private mode: Mode = 'detect'
  private buffer = ''
  // After </think>, drop the blank lines models put before the real answer,
  // even when they arrive in a later chunk.
  private trimLeading = false

  feed(chunk: string): StreamPiece[] {
    if (!chunk) return []
    this.buffer += chunk
    return this.drain(false)
  }

  // Call once when the upstream stream ends to release anything held back.
  flush(): StreamPiece[] {
    return this.drain(true)
  }

  private drain(final: boolean): StreamPiece[] {
    const out: StreamPiece[] = []
    const push = (kind: StreamPiece['kind'], text: string) => {
      if (text) out.push({ kind, text })
    }

    for (;;) {
      if (this.mode === 'detect') {
        const trimmed = this.buffer.trimStart()
        const open = OPEN_TAGS.find((t) => trimmed.startsWith(t))
        if (open) {
          this.buffer = trimmed.slice(open.length)
          this.mode = 'thinking'
          continue
        }
        // Could still become an opening tag once more characters arrive.
        const couldBeTag = OPEN_TAGS.some((t) => t.startsWith(trimmed))
        if (couldBeTag && !final) return out
        this.mode = 'text'
        continue
      }

      if (this.mode === 'thinking') {
        const idx = indexOfAny(this.buffer, CLOSE_TAGS)
        if (idx) {
          push('thinking', this.buffer.slice(0, idx.index))
          this.buffer = this.buffer.slice(idx.index + idx.tag.length)
          this.mode = 'text'
          this.trimLeading = true
          continue
        }
        if (final) {
          push('thinking', this.buffer)
          this.buffer = ''
          return out
        }
        // Hold back a possible partial closing tag at the end of the buffer.
        const keep = partialTagSuffix(this.buffer, CLOSE_TAGS)
        push('thinking', this.buffer.slice(0, this.buffer.length - keep))
        this.buffer = this.buffer.slice(this.buffer.length - keep)
        return out
      }

      // text mode: everything is answer text.
      if (this.trimLeading) {
        this.buffer = this.buffer.replace(/^\s+/, '')
        if (this.buffer) this.trimLeading = false
      }
      push('text', this.buffer)
      this.buffer = ''
      return out
    }
  }
}

function indexOfAny(haystack: string, tags: string[]): { index: number; tag: string } | null {
  let best: { index: number; tag: string } | null = null
  for (const tag of tags) {
    const i = haystack.indexOf(tag)
    if (i !== -1 && (!best || i < best.index)) best = { index: i, tag }
  }
  return best
}

// Length of the longest suffix of `s` that is a proper prefix of any tag.
function partialTagSuffix(s: string, tags: string[]): number {
  const max = Math.min(s.length, LONGEST_TAG - 1)
  for (let len = max; len > 0; len--) {
    const suffix = s.slice(s.length - len)
    if (tags.some((t) => t.startsWith(suffix) && t.length > len)) return len
  }
  return 0
}
