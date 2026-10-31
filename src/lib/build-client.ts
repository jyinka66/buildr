// Browser reader for /api/projects/[id]/build-stream (first build with progress).

export async function streamBuild(
  projectId: string,
  body: { providerKey?: string | null },
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/build-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let message = `build_failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.message) message = String(data.message)
      else if (typeof data?.error === 'string') message = data.error
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no_stream_body')
  const decoder = new TextDecoder()
  let buffer = ''
  let failure: string | null = null
  let completed = false

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    try {
      const evt = JSON.parse(data) as { type: string; message?: string }
      if (evt.type === 'status' && evt.message) onStatus(evt.message)
      else if (evt.type === 'error') failure = evt.message || 'build_failed'
      else if (evt.type === 'complete') completed = true
    } catch {
      /* ignore malformed event */
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
  if (buffer) handleLine(buffer)
  if (failure) throw new Error(failure)
  if (!completed) throw new Error('The build stopped before it finished. Open the project and try again.')
}
