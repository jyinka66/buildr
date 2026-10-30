-- Buildr uses a server-side service-role client for its application API.
-- Remove broad default PostgREST grants from public client roles; RLS alone is
-- not a substitute for least-privilege SQL grants.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- The isolated API runtime uses the anon key to load code for explicitly
-- public previews. Permit only the minimum project metadata and file reads.
GRANT SELECT (id, preview_url) ON public.projects TO anon;
GRANT SELECT ON public.project_files TO anon;

DROP POLICY IF EXISTS projects_public_preview_metadata ON public.projects;
CREATE POLICY projects_public_preview_metadata
  ON public.projects
  FOR SELECT
  TO anon
  USING (preview_url IS NOT NULL);

DROP POLICY IF EXISTS project_files_public_preview_read ON public.project_files;
CREATE POLICY project_files_public_preview_read
  ON public.project_files
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects AS p
      WHERE p.id = project_files.project_id
        AND p.preview_url IS NOT NULL
    )
  );
