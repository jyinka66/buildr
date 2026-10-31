// Replace a project's whole file tree without ever leaving it empty.
//
// The Prisma version ran "delete all files, then insert the new ones" inside a
// transaction. Supabase's client has no transactions, and the sequential-await
// port deleted first and ignored the insert result, so any failed insert wiped
// the project and still reported success. This helper reverses the order:
//
//   1. one upsert of the new tree (a single SQL statement, so all-or-nothing)
//   2. delete only the paths that are no longer part of the tree
//
// If step 1 fails nothing has been removed and an error is thrown. If step 2
// fails the new files are already in place and an error is thrown so the caller
// can report it. The finished tree is identical to the old behaviour.
//
// The database client is passed in (instead of importing '@/lib/db') so the
// logic can be unit tested with an in-memory fake.

export interface ProjectFileInput {
  path: string
  content: string
  language: string
  generated?: boolean
}

// Minimal structural type: the real Supabase client satisfies it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ProjectFilesDb { from(table: string): any }

const DELETE_CHUNK = 100

export async function replaceProjectFiles(
  client: ProjectFilesDb,
  projectId: string,
  files: ProjectFileInput[],
): Promise<{ written: number; removed: number }> {
  // Last entry wins for a duplicated path, matching the Map-based merge callers use.
  const unique = new Map<string, ProjectFileInput>()
  for (const file of files) unique.set(file.path, file)

  const now = new Date().toISOString()
  const rows = Array.from(unique.values()).map((file) => ({
    project_id: projectId,
    path: file.path,
    content: file.content,
    language: file.language,
    generated: file.generated ?? true,
    updated_at: now,
  }))

  if (rows.length > 0) {
    const { error } = await client.from('project_files').upsert(rows, { onConflict: 'project_id,path' })
    if (error) throw new Error(`project_files_write_failed: ${error.message}`)
  }

  const { data: existing, error: listError } = await client
    .from('project_files')
    .select('path')
    .eq('project_id', projectId)
  if (listError) throw new Error(`project_files_list_failed: ${listError.message}`)

  const stale = ((existing ?? []) as { path: string }[])
    .map((row) => row.path)
    .filter((path) => !unique.has(path))

  for (let i = 0; i < stale.length; i += DELETE_CHUNK) {
    const { error } = await client
      .from('project_files')
      .delete()
      .eq('project_id', projectId)
      .in('path', stale.slice(i, i + DELETE_CHUNK))
    if (error) throw new Error(`project_files_cleanup_failed: ${error.message}`)
  }

  return { written: rows.length, removed: stale.length }
}
