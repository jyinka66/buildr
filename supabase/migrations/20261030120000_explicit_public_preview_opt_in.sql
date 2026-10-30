-- Require explicit owner opt-in before anonymous users can read preview files.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_public_preview boolean NOT NULL DEFAULT false;

ALTER POLICY projects_public_preview_metadata
  ON public.projects
  USING (is_public_preview = true AND preview_url IS NOT NULL);

ALTER POLICY project_files_public_preview_read
  ON public.project_files
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects AS p
      WHERE p.id = project_files.project_id
        AND p.is_public_preview = true
        AND p.preview_url IS NOT NULL
    )
  );
