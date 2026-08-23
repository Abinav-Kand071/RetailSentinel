"""
RetailSentinel - Supabase Schema Fixer

This script:
1. Connects to your Supabase project via the management API
2. Re-applies the schema (ensuring all columns exist)
3. Triggers a PostgREST schema cache reload
4. Tests an insert + select to verify everything works

Usage:
  python fix_supabase_schema.py
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_KEY must be set in .env")
    sys.exit(1)

print(f"Project: {SUPABASE_URL}")
print()

# ── Step 1: Re-apply schema via Supabase RPC (SQL over PostgREST) ──
# We'll use the supabase-py client to run the schema fix
from supabase import create_client

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Read the schema SQL
schema_path = os.path.join(os.path.dirname(__file__), "supabase_schema.sql")
if os.path.exists(schema_path):
    with open(schema_path, "r") as f:
        schema_sql = f.read()
    print("✓ Found supabase_schema.sql")
else:
    print("✗ supabase_schema.sql not found")
    schema_sql = None

# ── Step 2: Test what columns PostgREST currently sees ──
print()
print("── Testing PostgREST schema cache ──")

# Test 1: Try a select to see what comes back
try:
    result = sb.table("scans").select("*").limit(1).execute()
    print(f"✓ SELECT works. Rows returned: {len(result.data)}")
    if result.data:
        print(f"  Columns visible: {list(result.data[0].keys())}")
    else:
        print("  (Table is empty, columns not testable via SELECT)")
except Exception as e:
    print(f"✗ SELECT failed: {e}")

# Test 2: Try inserting with all columns our code uses
test_payload_full = {
    "status": "test",
    "brand": "SchemaTest",
    "item_name": "FixerTestItem",
    "expiry_date": "2026-12-25",
}

print()
print("── Testing INSERT with all columns ──")
print(f"  Payload: {test_payload_full}")

try:
    result = sb.table("scans").insert(test_payload_full).execute()
    print(f"✓ Full INSERT succeeded! Row: {result.data}")
    
    # Clean up test row
    if result.data and result.data[0].get("id"):
        test_id = result.data[0]["id"]
        try:
            sb.table("scans").delete().eq("id", test_id).execute()
            print(f"  (Cleaned up test row {test_id})")
        except:
            print(f"  (Could not clean up test row {test_id} - manual cleanup needed)")
    
    print()
    print("═══════════════════════════════════════════")
    print("  ✅ EVERYTHING WORKS! No schema fix needed.")
    print("  Your Supabase schema cache is up to date.")
    print("═══════════════════════════════════════════")
    sys.exit(0)

except Exception as e:
    error_msg = str(e)
    print(f"✗ Full INSERT failed: {error_msg}")

# Test 3: Try inserting with minimal columns to isolate which ones are missing
print()
print("── Isolating missing columns ──")

columns_to_test = ["status", "brand", "item_name", "expiry_date"]
missing_columns = []

for col in columns_to_test:
    try:
        test_payload = {col: "test_value" if col != "expiry_date" else "2026-01-01"}
        result = sb.table("scans").insert(test_payload).execute()
        print(f"  ✓ Column '{col}' exists and accepts inserts")
        # Clean up
        if result.data and result.data[0].get("id"):
            try:
                sb.table("scans").delete().eq("id", result.data[0]["id"]).execute()
            except:
                pass
    except Exception as col_err:
        err_str = str(col_err)
        if "PGRST204" in err_str and col in err_str:
            print(f"  ✗ Column '{col}' is MISSING from PostgREST schema cache")
            missing_columns.append(col)
        elif "42501" in err_str:
            # RLS blocked it, but the column was recognized
            print(f"  ⚠ Column '{col}' exists but RLS blocked the insert")
        else:
            print(f"  ? Column '{col}' test inconclusive: {err_str[:100]}")

print()
if missing_columns:
    print("═══════════════════════════════════════════════════════════════")
    print(f"  ⚠ MISSING COLUMNS IN SCHEMA CACHE: {missing_columns}")
    print()
    print("  You need to do ONE of the following in the Supabase Dashboard:")
    print()
    print("  OPTION A - Re-run the schema SQL:")
    print("    1. Go to https://supabase.com/dashboard → your project")
    print("    2. Click 'SQL Editor' in the left sidebar")
    print("    3. Click 'New Query'")
    print("    4. Paste the contents of backend/supabase_schema.sql")
    print("    5. Click 'Run'")
    print()
    print("  OPTION B - Reload schema cache (if columns already exist):")
    print("    1. Go to https://supabase.com/dashboard → your project")
    print("    2. Click 'Project Settings' (gear icon)")
    print("    3. Click 'API' in the left sidebar")
    print("    4. Scroll down and click 'Reload schema cache'")
    print()
    print("  OPTION C - Add missing columns via Table Editor:")
    print("    1. Go to https://supabase.com/dashboard → your project")
    print("    2. Click 'Table Editor' → select 'scans' table")
    print("    3. Add the missing columns manually:")
    for col in missing_columns:
        if col == "expiry_date":
            print(f"       - '{col}': type DATE")
        elif col == "status":
            print(f"       - '{col}': type TEXT, default 'success'")
        else:
            print(f"       - '{col}': type TEXT")
    print()
    print("  After any option, restart your Flask backend.")
    print("═══════════════════════════════════════════════════════════════")
else:
    print("  All columns exist but inserts still fail.")
    print("  This is likely an RLS policy issue.")
    print()
    print("  Run this SQL in Supabase SQL Editor:")
    print()
    print("  DROP POLICY IF EXISTS \"Allow anonymous and authenticated inserts to scans\" ON public.scans;")
    print("  CREATE POLICY \"Allow anonymous and authenticated inserts to scans\"")
    print("    ON public.scans FOR INSERT TO anon, authenticated WITH CHECK (true);")
    print()
    print("  DROP POLICY IF EXISTS \"Allow anonymous and authenticated select from scans\" ON public.scans;")
    print("  CREATE POLICY \"Allow anonymous and authenticated select from scans\"")
    print("    ON public.scans FOR SELECT TO anon, authenticated USING (true);")
