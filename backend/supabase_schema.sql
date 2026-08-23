-- ==============================================================================
-- RetailSentinel Supabase Database Schema
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- ==============================================================================

-- 1. Create the scans table with product identification and expiry tracking
CREATE TABLE IF NOT EXISTS public.scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    brand TEXT,
    item_name TEXT,
    expiry_date DATE,
    inventory_count INTEGER DEFAULT 1,
    translation TEXT,
    detected_items JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'success'
);

-- If the table already existed with older schema, safely add the new columns
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies (Safe recreate)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'scans' AND policyname = 'Allow anonymous and authenticated inserts to scans'
    ) THEN
        CREATE POLICY "Allow anonymous and authenticated inserts to scans" 
        ON public.scans FOR INSERT TO anon, authenticated WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'scans' AND policyname = 'Allow anonymous and authenticated select from scans'
    ) THEN
        CREATE POLICY "Allow anonymous and authenticated select from scans" 
        ON public.scans FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

-- 4. Create an index on created_at for fast queries
CREATE INDEX IF NOT EXISTS idx_scans_created_at ON public.scans (created_at DESC);
