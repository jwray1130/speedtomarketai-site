-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 3 — DOCUMENT PERSISTENCE LAYER (revised)
-- Speed to Market AI · Altitude
--
-- Run this SQL in the Supabase dashboard:
--   → Supabase extension → SQL Editor → paste this whole file → Run
--
-- ─── PREREQUISITES ───────────────────────────────────────────────────────
-- This migration creates a foreign-key reference to public.submissions(id).
-- That table must already exist before this migration runs. If you're on a
-- fresh database without submissions yet, run your earlier submissions
-- migration first.
--
-- Required tables (must exist):
--   • public.submissions (id UUID primary key)  — Altitude's existing table
--   • auth.users (id UUID primary key)          — built into every Supabase project
-- ─────────────────────────────────────────────────────────────────────────
--
-- This migration is idempotent — safe to run multiple times. All `CREATE`
-- statements use `IF NOT EXISTS`, all policy creates check existing names
-- first. No data loss on re-run.
--
-- After this migration:
--   • document_pages table exists with all 19 columns + RLS
--   • submission-files storage bucket exists (private, 100MB cap, MIME allowlist)
--   • Storage RLS policies allow each user to read/write only their own files
--   • Triggers keep updated_at fresh on row updates
--
-- After running this, the front-end code in Phase 3 expects two extra
-- columns: html_content (TEXT, nullable) and annotations (JSONB, default
-- empty store). Both are NULLABLE/DEFAULTED so re-running this migration
-- against an already-populated table is safe.
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. document_pages table — one row per page (or per native file like Excel)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_pages (
  id                       UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id            UUID                     REFERENCES public.submissions(id) ON DELETE CASCADE,
  user_id                  UUID                     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- File identity (one logical upload may produce N rows, e.g. PDF page-split)
  file_id                  TEXT                     NOT NULL,        -- the iframe's 'doc-N-timestamp' id
  file_name                TEXT                     NOT NULL,        -- original filename including extension
  file_size                BIGINT,                                   -- bytes
  file_mime_type           TEXT,
  storage_path             TEXT,                                     -- {user_id}/{file_id}_{filename}; NULL for non-binary docs

  -- Pagination
  page_number              INTEGER                  NOT NULL DEFAULT 1,
  total_pages              INTEGER                  NOT NULL DEFAULT 1,

  -- Display + categorization
  display_name             TEXT                     NOT NULL,        -- user-editable name
  category                 TEXT                     NOT NULL DEFAULT 'all',
  color                    TEXT,                                     -- nullable; one of the 9 tag colors
  tagged                   BOOLEAN                  NOT NULL DEFAULT false,

  -- Pipeline integration (Phase 4)
  pipeline_classification  TEXT,                                     -- e.g. 'application', 'loss_run'
  pipeline_routed_to       TEXT,                                     -- e.g. 'extractor_v2'

  -- Searchable content
  extracted_text           TEXT,                                     -- text layer for PDFs, mammoth output for Word, etc.

  -- Render cache (optional — saves re-rendering on reload)
  thumbnail_data_url       TEXT,                                     -- base64 PNG for thumbnail
  html_content             TEXT,                                     -- rendered HTML (Word, email, PowerPoint, text) for fast preview without re-processing
  annotations              JSONB                    NOT NULL DEFAULT '{"layers":[],"undone":[]}'::jsonb,  -- pen/highlighter/shape/text/sticky layers; el DOM refs stripped before save

  -- Audit
  created_at               TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT document_pages_category_chk CHECK (category IN (
    'all', 'correspondence', 'applications', 'loss-history',
    'cancellations', 'pricing', 'quotes', 'binders', 'policies',
    'endorsements', 'subjectivities', 'surplus-lines', 'project', 'underwriting'
  )),
  CONSTRAINT document_pages_color_chk CHECK (color IS NULL OR color IN (
    'red', 'maroon', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black'
  )),
  CONSTRAINT document_pages_pages_chk CHECK (page_number >= 1 AND total_pages >= 1 AND page_number <= total_pages)
);

-- ──────────────────────────────────────────────────────────────────────────
-- 1b. Idempotent column additions
-- If document_pages already exists from a previous Phase 2 run, the
-- CREATE TABLE IF NOT EXISTS above is a no-op and won't add the new columns.
-- These ALTER TABLE ... ADD COLUMN IF NOT EXISTS clauses run safely whether
-- the columns exist or not.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.document_pages
  ADD COLUMN IF NOT EXISTS html_content TEXT,
  ADD COLUMN IF NOT EXISTS annotations  JSONB NOT NULL DEFAULT '{"layers":[],"undone":[]}'::jsonb;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. Indexes — query hot paths
-- ──────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS document_pages_user_id_idx
  ON public.document_pages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_pages_submission_id_idx
  ON public.document_pages (submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_pages_category_idx
  ON public.document_pages (user_id, category);

CREATE INDEX IF NOT EXISTS document_pages_tagged_idx
  ON public.document_pages (user_id, tagged, color)
  WHERE tagged = true;

-- Full-text search across extracted text content. GIN is the right index for
-- to_tsvector queries; we use the 'english' dictionary by default.
CREATE INDEX IF NOT EXISTS document_pages_text_search_idx
  ON public.document_pages
  USING GIN (to_tsvector('english', COALESCE(extracted_text, '')));

-- ──────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger — keep the audit field accurate without app-level work
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_document_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_pages_updated_at ON public.document_pages;
CREATE TRIGGER document_pages_updated_at
  BEFORE UPDATE ON public.document_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_document_pages_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Row-Level Security — each user only sees their own document pages
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing versions of these policies before re-creating, so the
-- script is fully idempotent.
DROP POLICY IF EXISTS "Users can view their own document pages"   ON public.document_pages;
DROP POLICY IF EXISTS "Users can insert their own document pages" ON public.document_pages;
DROP POLICY IF EXISTS "Users can update their own document pages" ON public.document_pages;
DROP POLICY IF EXISTS "Users can delete their own document pages" ON public.document_pages;

CREATE POLICY "Users can view their own document pages"
  ON public.document_pages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own document pages"
  ON public.document_pages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own document pages"
  ON public.document_pages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own document pages"
  ON public.document_pages FOR DELETE
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Storage bucket — submission-files
--
-- Private bucket. Files are stored at path: {user_id}/{file_id}_{filename}
-- 100MB per-file cap. MIME allowlist prevents accidental exec/script uploads.
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submission-files',
  'submission-files',
  false,                                      -- private
  104857600,                                  -- 100 MB
  ARRAY[
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    'application/vnd.openxmlformats-officedocument.presentationml.template',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    'application/vnd.ms-powerpoint.template.macroEnabled.12',
    'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
    'application/vnd.ms-excel.template.macroEnabled.12',
    'application/rtf',
    'text/rtf',
    -- Email
    'message/rfc822',
    'application/vnd.ms-outlook',
    'application/vnd.ms-office.outlook.template',
    -- Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
    'image/tiff', 'image/heic', 'image/heif',
    -- Text
    'text/plain', 'text/csv', 'text/tab-separated-values',
    'text/markdown', 'text/html',
    -- Archives
    'application/zip', 'application/x-rar-compressed',
    'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
    -- Catch-all for native files we can't classify
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Storage RLS — users can only access files in their own folder
--
-- The path convention is {user_id}/{...rest}, so the first path segment
-- must equal auth.uid() for any read/write/delete to succeed.
-- ──────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own submission files"   ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to own folder"        ON storage.objects;
DROP POLICY IF EXISTS "Users can update own submission files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own submission files" ON storage.objects;

CREATE POLICY "Users can view own submission files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'submission-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'submission-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own submission files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'submission-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own submission files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'submission-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES — run these after the migration to confirm everything
-- landed correctly. Each should return rows.
-- ════════════════════════════════════════════════════════════════════════════

-- Should show 1 row: the document_pages table
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'document_pages';

-- Should show 4 RLS policies on document_pages
-- SELECT policyname FROM pg_policies WHERE tablename = 'document_pages';

-- Should show the submission-files bucket
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'submission-files';

-- Should show 4 storage policies referencing submission-files
-- SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

-- Should show 5 indexes on document_pages
-- SELECT indexname FROM pg_indexes WHERE tablename = 'document_pages';

-- Should show the html_content + annotations columns
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'document_pages' AND column_name IN ('html_content', 'annotations');

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (only run if you need to undo this migration cleanly)
-- ════════════════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS public.document_pages CASCADE;
-- DELETE FROM storage.buckets WHERE id = 'submission-files';
-- DROP POLICY IF EXISTS "Users can view own submission files"   ON storage.objects;
-- DROP POLICY IF EXISTS "Users can upload to own folder"        ON storage.objects;
-- DROP POLICY IF EXISTS "Users can update own submission files" ON storage.objects;
-- DROP POLICY IF EXISTS "Users can delete own submission files" ON storage.objects;
