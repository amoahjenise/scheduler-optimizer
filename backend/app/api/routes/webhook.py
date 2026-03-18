import logging
import os
from fastapi import APIRouter, Request, Header, HTTPException
from svix.webhooks import Webhook, WebhookVerificationError
import httpx
from app.core.config import settings

router = APIRouter()

CLERK_WEBHOOK_SECRET = settings.CLERK_WEBHOOK_SIGNING_SECRET
API_URL = settings.FASTAPI_BACKEND_URL  # e.g. http://localhost:8000
USERS_API_ENDPOINT = f"{API_URL}/users/"
INTERNAL_API_SECRET = settings.INTERNAL_API_SECRET

# Configure logger
logger = logging.getLogger("webhooks")
if not logger.hasHandlers():
    logging.basicConfig(level=logging.INFO)


def _get_internal_headers() -> dict:
    """Get headers for internal API calls, including the secret."""
    return {"X-Internal-Secret": INTERNAL_API_SECRET}


@router.post("/webhook")
async def handle_clerk_webhook(
    request: Request,
    svix_id: str = Header(None),
    svix_timestamp: str = Header(None),
    svix_signature: str = Header(None),
):
    logger.info(f"Received webhook: svix-id={svix_id}, svix-timestamp={svix_timestamp}")

    body = await request.body()
    wh = Webhook(CLERK_WEBHOOK_SECRET)

    try:
        evt = wh.verify(body, {
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": svix_signature
        })
        logger.info(f"Webhook signature verified successfully. Event type: {evt['type']}")
    except WebhookVerificationError:
        logger.warning("Webhook signature verification failed.")
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = evt["type"]
    data = evt["data"]
    logger.debug(f"Event data: {data}")

    user_id = data["id"]
    headers = _get_internal_headers()

    async with httpx.AsyncClient() as client:
        if event_type == "user.created":
            # Check if user already exists
            existing_user = await client.get(f"{USERS_API_ENDPOINT}{user_id}", headers=headers)
            if existing_user.status_code == 200:
                logger.info(f"User already exists: {user_id}. Skipping creation.")
            else:
                user_payload = {
                    "id": user_id,
                    "is_active": True  # Optional, as your model defaults it
                }
                logger.info(f"Creating user with payload: {user_payload}")
                response = await client.post(USERS_API_ENDPOINT, json=user_payload, headers=headers)
                if response.status_code != 200:
                    logger.error(f"Failed to create user: {response.text}")
                    raise HTTPException(status_code=500, detail="Failed to create user in DB")

        elif event_type == "user.deleted":
            logger.info(f"Deleting user with ID: {user_id}")
            response = await client.delete(f"{USERS_API_ENDPOINT}{user_id}", headers=headers)
            if response.status_code in (200, 204):
                logger.info(f"User {user_id} deleted successfully.")
            elif response.status_code == 404:
                logger.info(f"User {user_id} not found. Nothing to delete.")
            else:
                logger.error(f"Failed to delete user: {response.text}")
                raise HTTPException(status_code=500, detail="Failed to delete user in DB")

    return {"success": True}
