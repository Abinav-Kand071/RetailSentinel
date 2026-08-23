-- ==============================================================================
-- RetailSentinel Supabase Database Schema
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. Create or ensure the scans table exists with quantity and status
CREATE TABLE IF NOT EXISTS public.scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    brand TEXT,
    item_name TEXT,
    expiry_date DATE,
    quantity INTEGER NOT NULL DEFAULT 1,
    inventory_count INTEGER DEFAULT 1,
    translation TEXT,
    detected_items JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'success'
);

-- Safely add columns if they do not exist
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

-- 3. Create/Update RLS Policies for Anon & Authenticated access
DROP POLICY IF EXISTS "Allow anonymous and authenticated inserts to scans" ON public.scans;
CREATE POLICY "Allow anonymous and authenticated inserts to scans" 
ON public.scans FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous and authenticated select from scans" ON public.scans;
CREATE POLICY "Allow anonymous and authenticated select from scans" 
ON public.scans FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anonymous and authenticated updates to scans" ON public.scans;
CREATE POLICY "Allow anonymous and authenticated updates to scans" 
ON public.scans FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous and authenticated deletes from scans" ON public.scans;
CREATE POLICY "Allow anonymous and authenticated deletes from scans" 
ON public.scans FOR DELETE TO anon, authenticated USING (true);

-- 4. Create an index on created_at for fast queries
CREATE INDEX IF NOT EXISTS idx_scans_created_at ON public.scans (created_at DESC);
