// Lightweight unified diff (Myers-based LCS). No external deps.
// ------------------------------------------------------------------
// Returns a list of ops (+/-/context) that the DiffViewer renders with
// green/red coloring. Adequate for file-level diffs; for very large
// files a real diff lib (diff-match-patch) would be faster, but this
// avoids adding a dependency and handles typical generated-file sizes.

export type DiffOp =
  | { type: 'context'; text: string }
  | { type: 'add'; text: string }
  | { type: 'del'; text: string }

export function diffLines(oldText: string, newText: string): DiffOp[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  // LCS DP table (bounded to avoid OOM on huge files).
  const MAX = 2000
  if (m > MAX || n > MAX) {
    // Fallback: show entire new file as added, old as deleted.
    return [
      ...oldLines.slice(0, 50).map((t) => ({ type: 'del' as const, text: t })),
      ...newLines.slice(0, 50).map((t) => ({ type: 'add' as const, text: t })),
    ]
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'context', text: oldLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: oldLines[i] })
      i++
    } else {
      ops.push({ type: 'add', text: newLines[j] })
      j++
    }
  }
  while (i < m) ops.push({ type: 'del', text: oldLines[i++] })
  while (j < n) ops.push({ type: 'add', text: newLines[j++] })
  return ops
}

export interface FileDiffSummary {
  path: string
  action: 'create' | 'update' | 'delete'
  additions: number
  deletions: number
  ops: DiffOp[]
}

export function diffFile(
  path: string,
  oldContent: string | null,
  newContent: string | null,
): FileDiffSummary {
  if (newContent === null) {
    return {
      path,
      action: 'delete',
      additions: 0,
      deletions: oldContent?.split('\n').length ?? 0,
      ops: (oldContent ?? '').split('\n').map((t) => ({ type: 'del' as const, text: t })),
    }
  }
  if (oldContent === null) {
    return {
      path,
      action: 'create',
      additions: newContent.split('\n').length,
      deletions: 0,
      ops: newContent.split('\n').map((t) => ({ type: 'add' as const, text: t })),
    }
  }
  const ops = diffLines(oldContent, newContent)
  return {
    path,
    action: 'update',
    additions: ops.filter((o) => o.type === 'add').length,
    deletions: ops.filter((o) => o.type === 'del').length,
    ops,
  }
}
