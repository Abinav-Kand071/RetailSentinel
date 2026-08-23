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
    - If the same brand + item_name exists, increments existing quantity by 1.
    - If it is a new item, inserts a new row with quantity = 1.
    """
    if not supabase:
        return None

    try:
        brand = str(data.get("brand", "")).strip()
        item_name = str(data.get("item_name", "")).strip()
        raw_expiry = data.get("expiry_date")
        # If expiry_date is "N/A" or missing and the DB column is DATE, pass None/NULL safely
        parsed_expiry = None if not raw_expiry or str(raw_expiry).strip().upper() in ("N/A", "NONE", "NULL", "") else str(raw_expiry).strip()
        status = str(data.get("status", "success"))

        # Check if an existing row matches the same brand + item_name
        existing_res = (
            supabase.table("scans")
            .select("*")
            .eq("brand", brand)
            .eq("item_name", item_name)
            .execute()
        )

        if existing_res.data and len(existing_res.data) > 0:
            existing_row = existing_res.data[0]
            current_qty = existing_row.get("quantity")
            new_qty = (int(current_qty) if current_qty is not None else 1) + 1

            update_payload: Dict[str, Any] = {
                "quantity": new_qty,
                "status": status,
            }
            if parsed_expiry:
                update_payload["expiry_date"] = parsed_expiry

            update_res = (
                supabase.table("scans")
                .update(update_payload)
                .eq("id", existing_row["id"])
                .execute()
            )
            updated_item = update_res.data[0] if update_res.data else existing_row
            logger.info(f"Incremented quantity for existing item '{brand} - {item_name}' to {new_qty}")
            return updated_item
        else:
            # Insert new item with quantity = 1
            payload: Dict[str, Any] = {
                "status": status,
                "brand": brand,
                "item_name": item_name,
                "expiry_date": parsed_expiry,
                "quantity": 1,
            }

            if "inventory_count" in data:
                payload["inventory_count"] = int(data.get("inventory_count", 1))
            if "translation" in data:
                payload["translation"] = str(data.get("translation", ""))
            if "detected_items" in data:
                payload["detected_items"] = data.get("detected_items", [])

            insert_res = supabase.table("scans").insert(payload).execute()
            inserted_item = insert_res.data[0] if insert_res.data else None
            logger.info(f"Inserted new item '{brand} - {item_name}' with quantity = 1")
            return inserted_item

    except Exception as err:
        logger.error(f"Failed to insert/update scan in Supabase: {err}")
        return None


def update_scan_quantity(item_id: str, delta: int = 0, new_quantity: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """
    Updates or increments/decrements quantity for a specific scan item.
    Ensures quantity never drops below 0.
    """
    if not supabase:
        return None

    try:
        if new_quantity is not None:
            final_qty = max(0, int(new_quantity))
        else:
            existing = supabase.table("scans").select("quantity").eq("id", item_id).execute()
            if not existing.data:
                return None
            curr = existing.data[0].get("quantity", 1)
            current_int = int(curr) if curr is not None else 1
            final_qty = max(0, current_int + delta)

        res = supabase.table("scans").update({"quantity": final_qty}).eq("id", item_id).execute()
        return res.data[0] if res.data else None
    except Exception as err:
        logger.error(f"Failed to update scan quantity in Supabase: {err}")
        return None


def get_recent_scans(limit: int = 50) -> List[Dict[str, Any]]:
    """
    Retrieves recent audit scans / inventory items from Supabase.
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
