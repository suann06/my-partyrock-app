"""
Taste of Malaysia — chat.py
AWS Lambda handler for POST /api/chat

Replicates the Express server.js /api/chat endpoint:
  - Validates the incoming messages array
  - Calls Amazon Bedrock (Claude Haiku 4.5, global inference profile)
  - Returns { "reply": "..." } on success
  - Returns { "error": "..." } with an appropriate HTTP status on failure

Authentication:
  Lambda runs with an IAM execution role that has
  bedrock:InvokeModel permission — no bearer token needed here.
  The role is defined in infra/template.yaml.

Environment variables (set by SAM template / deploy workflow):
  BEDROCK_REGION   — AWS region for Bedrock calls (e.g. ap-southeast-5)
  MODEL_ID         — Bedrock model ID
"""

import json
import os
import boto3
from botocore.exceptions import ClientError

# ── Constants (mirror server.js) ─────────────────────────────────────────────
MAX_MESSAGE_LENGTH = 1000   # characters; applies to user turns only
MAX_HISTORY_TURNS  = 10     # keep last N user/assistant pairs

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-southeast-5")
MODEL_ID       = os.environ.get(
    "MODEL_ID",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0"
)

SYSTEM_PROMPT = (
    "You are Foodie AI Assistant, a friendly assistant specialising in Malaysian cuisine. "
    "Help users explore Malaysian dishes, ingredients, cooking methods and food culture. "
    "Provide clear and concise answers. "
    "If a question is unrelated to Malaysian cuisine, politely guide the conversation "
    "back to Malaysian food. Do not invent facts when uncertain."
)

# Initialise the Bedrock client once (reused across warm Lambda invocations)
bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cors_headers():
    """CORS headers required because the frontend is served from S3."""
    return {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {**_cors_headers(), "Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _is_valid_messages(messages) -> bool:
    """
    Mirror of isValidMessages() in server.js:
      - Non-empty list
      - Every item has role ('user'|'assistant') and non-empty string content
      - User messages are capped at MAX_MESSAGE_LENGTH chars
      - Assistant messages have no cap (they can be long model replies)
    """
    if not isinstance(messages, list) or len(messages) == 0:
        return False
    for m in messages:
        if not isinstance(m, dict):
            return False
        if m.get("role") not in ("user", "assistant"):
            return False
        content = m.get("content", "")
        if not isinstance(content, str) or not content.strip():
            return False
        # Length cap for user turns only
        if m["role"] == "user" and len(content) > MAX_MESSAGE_LENGTH:
            return False
    return True


# ── Lambda handler ────────────────────────────────────────────────────────────

def handler(event, context):
    """
    Handles two event types from API Gateway HTTP API (payload format 2.0):
      OPTIONS  — CORS preflight, return 200 immediately
      POST     — validate body, call Bedrock, return reply
    """
    method = event.get("requestContext", {}).get("http", {}).get("method", "").upper()

    # ── CORS preflight ──────────────────────────────────────────────────────
    if method == "OPTIONS":
        return _response(200, {})

    # ── Parse and validate request body ────────────────────────────────────
    raw_body = event.get("body", "") or ""
    try:
        body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        return _response(400, {
            "error": "Invalid JSON body."
        })

    messages = body.get("messages")

    if not _is_valid_messages(messages):
        return _response(400, {
            "error": (
                "Invalid request. Provide a non-empty messages array "
                "with role and content fields."
            )
        })

    # ── Trim history (same cap as server.js) ────────────────────────────────
    trimmed = messages[-(MAX_HISTORY_TURNS * 2):]

    # ── Call Bedrock ────────────────────────────────────────────────────────
    bedrock_payload = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "system": SYSTEM_PROMPT,
        "messages": trimmed,
    }

    try:
        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(bedrock_payload),
        )
        result = json.loads(response["body"].read())
        reply  = result.get("content", [{}])[0].get("text", "")

        if not reply:
            return _response(502, {"error": "Empty response from Bedrock."})

        return _response(200, {"reply": reply})

    except ClientError as err:
        code = err.response["Error"]["Code"]
        http_status = err.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 500)

        print(f"[Bedrock ClientError] {code}: {err}")  # logged to CloudWatch

        message_map = {
            "ValidationException":   "Bedrock rejected the request (ValidationException).",
            "ThrottlingException":   "Too many requests. Please try again in a moment.",
            "AccessDeniedException": "Access denied. Check the Lambda IAM role has bedrock:InvokeModel permission.",
        }
        return _response(http_status, {
            "error": message_map.get(code, "An error occurred while contacting the AI service.")
        })

    except Exception as err:
        print(f"[Unexpected error] {err}")  # logged to CloudWatch
        return _response(500, {
            "error": "An unexpected server error occurred."
        })
