// Snapshot helper — captures the full file tree after a generation so the
// user can rewind to any prior turn (version history).
import { db } from '@/lib/db'

export interface SnapshotFile {
  path: string
  content: string
  language: string
}

/**
 * Captures the current file tree of a project as a snapshot, linked to the
 * given generation. Called after each assistant generation completes.
 */
export async function captureSnapshot(
  projectId: string,
  generationId: string,
): Promise<void> {
  const { data: files } = await db
    .from('project_files')
    .select('path, content, language')
    .eq('project_id', projectId)
  const snapshot: SnapshotFile[] = (files ?? []).map((f) => ({
    path: f.path,
    content: f.content,
    language: f.language,
  }))
  await db.from('snapshots').insert({
    project_id: projectId,
    generation_id: generationId,
    files: JSON.stringify(snapshot),
  })
}

/**
 * Audit log helper — records who did what, when. Called on key actions
 * (generate, rewind, deploy, export, register, login).
 */
export async function audit(
  action: string,
  details: Record<string, unknown> = {},
  userId?: string,
  projectId?: string,
): Promise<void> {
  try {
    await db.from('audit_log').insert({
      user_id: userId ?? null,
      project_id: projectId ?? null,
      action,
      details: JSON.stringify(details),
    })
  } catch (err) {
    // Audit logging is best-effort — never fail the main action.
    // But log the error so ops can detect persistent audit failures.
    console.error('[Buildr] Audit log write failed:', err instanceof Error ? err.message : err)
  }
}
