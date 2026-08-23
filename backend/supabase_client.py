from __future__ import annotations
import os
import logging
from typing import Optional, Dict, Any, List
from supabase import create_client, Client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

supabase: Optional[Client] = None

# Initialize only if valid real credentials exist
if SUPABASE_URL and SUPABASE_KEY and "your-project" not in SUPABASE_URL and "your_supabase" not in SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully.")
    except Exception as e:
        logger.warning(f"Supabase connection failed: {e}")
else:
    logger.info("Supabase credentials not configured or using default placeholders. Database logging is inactive.")


def log_scan_result(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Logs a product analysis scan (brand, item name, expiry date) to the Supabase 'scans' table.
    """
    if not supabase:
        return None

    try:
        raw_expiry = data.get("expiry_date")
        # If expiry_date is "N/A" or missing and the DB column is DATE, pass None/NULL safely
        parsed_expiry = None if not raw_expiry or str(raw_expiry).strip().upper() in ("N/A", "NONE", "NULL", "") else str(raw_expiry).strip()

        payload: Dict[str, Any] = {
            "status": str(data.get("status", "success")),
            "brand": str(data.get("brand", "")),
            "item_name": str(data.get("item_name", "")),
            "expiry_date": parsed_expiry,
        }

        if "inventory_count" in data:
            payload["inventory_count"] = int(data.get("inventory_count", 1))
        if "translation" in data:
            payload["translation"] = str(data.get("translation", ""))
        if "detected_items" in data:
            payload["detected_items"] = data.get("detected_items", [])

        res = supabase.table("scans").insert(payload).execute()
        return res.data[0] if res.data else None
    except Exception as err:
        logger.error(f"Failed to insert scan into Supabase: {err}")
        return None


def get_recent_scans(limit: int = 15) -> List[Dict[str, Any]]:
    """
    Retrieves recent audit scans from Supabase.
    """
    if not supabase:
        return []

    try:
        res = (
            supabase.table("scans")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as err:
        logger.error(f"Failed to fetch recent scans from Supabase: {err}")
        return []
