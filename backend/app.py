from __future__ import annotations
import os
import json
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

# Import database helpers
from supabase_client import log_scan_result, get_recent_scans, update_scan_quantity

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# Enable CORS for frontend development
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ---------------------------------------------------------------------------
# Gemini 1.5 Flash Initialization
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    logger.warning("GEMINI_API_KEY is not set. Gemini API calls will fallback to mock response.")

SYSTEM_PROMPT = """
You are an advanced retail AI. Analyze the provided image of a product. 
Identify the item, its brand, and look for any visible expiration dates or printed text.
If no expiration date is perfectly visible, estimate a realistic one for the sake of the database (e.g., 6 months from today).

Return ONLY a valid JSON object matching this exact schema:
{
  "brand": "Brand Name",
  "item_name": "Product Name",
  "expiry_date": "YYYY-MM-DD",
  "status": "success"
}
"""

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "online",
        "service": "RetailSentinel API",
        "gemini_configured": bool(GEMINI_API_KEY)
    }), 200


@app.route("/api/history", methods=["GET"])
def history():
    """Returns recent scans saved in Supabase."""
    limit = request.args.get("limit", default=50, type=int)
    scans = get_recent_scans(limit=limit)
    return jsonify({"scans": scans, "count": len(scans)}), 200


@app.route("/api/inventory/<item_id>/quantity", methods=["PATCH", "POST"])
def update_item_quantity_endpoint(item_id: str):
    """Adjusts item quantity in Supabase via increment/decrement delta or exact quantity."""
    try:
        body = request.get_json(silent=True) or {}
        delta = body.get("delta")
        new_quantity = body.get("quantity")

        updated = update_scan_quantity(item_id, delta=int(delta) if delta is not None else 0, new_quantity=new_quantity)
        if updated:
            return jsonify({"status": "success", "item": updated}), 200
        return jsonify({"status": "error", "message": "Failed to update item quantity."}), 400
    except Exception as err:
        logger.error(f"Error in update_item_quantity_endpoint: {err}")
        return jsonify({"status": "error", "message": str(err)}), 500


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Endpoint accepting product image (and optional voice note):
      - 'image': File (JPEG, PNG, WebP) [Required]
      - 'audio': File (WebM, WAV, MP3, OGG) [Optional]
    """
    try:
        # Validate uploaded files (image is required)
        if "image" not in request.files:
            return jsonify({
                "status": "error",
                "message": "Product 'image' file is required in multipart/form-data."
            }), 400

        image_file = request.files["image"]
        if image_file.filename == "":
            return jsonify({
                "status": "error",
                "message": "Empty file received for product image."
            }), 400

        image_bytes = image_file.read()
        image_mimetype = image_file.mimetype or "image/jpeg"

        audio_bytes = None
        audio_mimetype = None
        if "audio" in request.files and request.files["audio"].filename != "":
            audio_file = request.files["audio"]
            audio_bytes = audio_file.read()
            audio_mimetype = audio_file.mimetype or "audio/webm"

        logger.info(f"Received Image ({len(image_bytes)} bytes, {image_mimetype})")

        # Process with Gemini 1.5 Flash if API key is available
        if GEMINI_API_KEY:
            try:
                model = genai.GenerativeModel(
                    model_name="gemini-flash-lite-latest",
                    system_instruction=SYSTEM_PROMPT,
                    generation_config={"response_mime_type": "application/json"}
                )

                contents = [
                    {
                        "mime_type": image_mimetype,
                        "data": image_bytes
                    }
                ]

                if audio_bytes:
                    contents.append({
                        "mime_type": audio_mimetype,
                        "data": audio_bytes
                    })

                contents.append(
                    "Identify the product item name, brand, and expiration date (YYYY-MM-DD) from the attached image."
                )

                response = model.generate_content(contents)
                result_data = json.loads(response.text)

                # Ensure consistent keys
                if "status" not in result_data:
                    result_data["status"] = "success"

                logger.info(f"Gemini Product Analysis Successful: {result_data}")

                # Save audit to Supabase if configured
                log_scan_result(result_data)

                return jsonify(result_data), 200

            except Exception as gemini_err:
                logger.error(f"Gemini API Error: {gemini_err}. Falling back to standard mock response.")
                fallback_data = {
                    "brand": "Kellogg's",
                    "item_name": "Corn Flakes Cereal 500g",
                    "expiry_date": "2026-11-20",
                    "status": "mock_fallback"
                }
                log_scan_result(fallback_data)
                return jsonify(fallback_data), 200

        # Default Mock Response if no API key is set
        mock_response = {
            "brand": "Nestlé",
            "item_name": "KitKat 4-Finger Milk Chocolate",
            "expiry_date": "2026-12-15",
            "status": "mock_fallback"
        }
        log_scan_result(mock_response)
        return jsonify(mock_response), 200

    except Exception as e:
        logger.error(f"Unexpected server error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
