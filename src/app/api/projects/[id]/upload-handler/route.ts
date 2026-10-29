// POST /api/projects/[id]/upload-handler — generates a file upload handler
// using Supabase Storage. Creates:
//   1. src/lib/storage.ts — a Supabase Storage client with upload/delete/getUrl helpers
//   2. src/app/api/upload/route.ts — a POST endpoint that accepts file uploads
//   3. src/components/FileUpload.tsx — a reusable React component with drag & drop
//
// The upload handler uses the project's Supabase config (anon key is public-safe
// for client-side uploads with proper RLS policies).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const { data: project } = await db
    .from('projects')
    .select('owner_id, stack, db_config')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const filesToSave: { path: string; content: string; language: string }[] = []

  // 1. Storage lib
  filesToSave.push({
    path: 'src/lib/storage.ts',
    language: 'ts',
    content: `import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase env vars not set — file uploads will fail.");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

const BUCKET_NAME = "uploads";

/**
 * Uploads a file to Supabase Storage and returns the public URL.
 * @param file - The File or Blob to upload
 * @param folder - Optional subfolder within the bucket (e.g. "avatars")
 * @returns The public URL of the uploaded file
 */
export async function uploadFile(
  file: File | Blob,
  folder?: string,
): Promise<{ url: string; path: string; error: string | null }> {
  const ext = file instanceof File ? file.name.split(".").pop() : "bin";
  const fileName = \`\${folder ? folder + "/" : ""}\${crypto.randomUUID()}.\${ext}\`;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    return { url: "", path: "", error: error.message };
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(fileName);

  return {
    url: urlData.publicUrl,
    path: data?.path || fileName,
    error: null,
  };
}

/**
 * Deletes a file from Supabase Storage.
 * @param path - The storage path of the file to delete
 */
export async function deleteFile(path: string): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);
  return { error: error?.message || null };
}

/**
 * Lists files in a Supabase Storage bucket folder.
 * @param folder - The folder to list (empty for root)
 * @param limit - Max files to return (default 100)
 */
export async function listFiles(folder?: string, limit = 100) {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(folder || "", { limit, sortBy: { column: "created_at", order: "desc" } });

  if (error) return { files: [], error: error.message };
  return { files: data || [], error: null };
}
`,
  })

  // 2. Upload API route
  filesToSave.push({
    path: 'src/app/api/upload/route.ts',
    language: 'ts',
    content: `import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    // Validate file size (10MB max).
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)." }, { status: 413 });
    }

    // Validate file type (common safe types).
    const allowedTypes = [
      "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
      "application/pdf", "text/csv", "application/json",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: \`File type \${file.type} not allowed.\` }, { status: 415 });
    }

    const result = await uploadFile(file, folder);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      url: result.url,
      path: result.path,
      fileName: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
`,
  })

  // 3. FileUpload component
  filesToSave.push({
    path: 'src/components/FileUpload.tsx',
    language: 'tsx',
    content: `"use client";

import { useState, useRef, useCallback } from "react";
import { UploadCloud, X, Loader2, FileCheck } from "lucide-react";

interface FileUploadProps {
  folder?: string;
  accept?: string;
  maxSize?: number; // in bytes
  onUpload?: (url: string, file: File) => void;
  multiple?: boolean;
}

interface UploadedFile {
  name: string;
  url: string;
  size: number;
}

export function FileUpload({
  folder,
  accept = "image/*,.pdf,.csv,.json",
  maxSize = 10 * 1024 * 1024,
  onUpload,
  multiple = false,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList) => {
    setError(null);
    setUploading(true);

    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        setError(\`File "\${file.name}" exceeds the maximum size of \${maxSize / 1024 / 1024}MB.\`);
        continue;
      }

      const formData = new FormData();
      formData.append("file", file);
      if (folder) formData.append("folder", folder);

      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Upload failed.");
          continue;
        }
        const uploadedFile = { name: file.name, url: data.url, size: file.size };
        setUploaded((prev) => multiple ? [...prev, uploadedFile] : [uploadedFile]);
        onUpload?.(data.url, file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    }

    setUploading(false);
  }, [folder, maxSize, multiple, onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFiles(e.target.files);
    }
  };

  const removeFile = (index: number) => {
    setUploaded((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="w-full">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={\`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer \${
          dragging ? "border-emerald-500 bg-emerald-50" : "border-zinc-300 hover:border-emerald-400"
        }\`}
      >
        {uploading ? (
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        ) : (
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {uploading ? "Uploading..." : "Drag & drop files here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">Max {maxSize / 1024 / 1024}MB per file</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleChange}
          className="hidden"
        />
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      ) : null}

      {uploaded.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {uploaded.map((file, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
              <FileCheck className="h-4 w-4 text-emerald-600" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)}KB</span>
              <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-red-500">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
`,
  })

  // 4. Supabase Storage migration SQL
  filesToSave.push({
    path: 'supabase/migrations/0002_create_storage_bucket.sql',
    language: 'sql',
    content: `-- Create the uploads storage bucket (public read, authenticated write)
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

-- Allow public read access to the uploads bucket
create policy "Public read access" on storage.objects
  for select using (bucket_id = 'uploads');

-- Allow authenticated users to upload to the uploads bucket
create policy "Authenticated upload access" on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');

-- Allow users to delete their own uploads
create policy "Users can delete own uploads" on storage.objects
  for delete to authenticated using (bucket_id = 'uploads' and owner = auth.uid());
`,
  })

  // Save all files (upsert).
  const savedFiles: { path: string }[] = []
  for (const file of filesToSave) {
    const { data: existing } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', id)
      .eq('path', file.path)
      .maybeSingle()

    if (existing) {
      await db
        .from('project_files')
        .update({ content: file.content, language: file.language, updated_at: new Date().toISOString() })
        .eq('project_id', id)
        .eq('path', file.path)
    } else {
      await db.from('project_files').insert({
        project_id: id,
        path: file.path,
        content: file.content,
        language: file.language,
        generated: true,
      })
    }
    savedFiles.push({ path: file.path })
  }

  await audit('upload-handler.generate', { filesGenerated: savedFiles.length }, user.id, id)

  return NextResponse.json({
    ok: true,
    filesSaved: savedFiles,
    message: 'File upload handler generated. Run the storage migration SQL in your Supabase SQL Editor to create the uploads bucket.',
  })
}
