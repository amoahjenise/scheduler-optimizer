"""Test Clerk API integration"""
import asyncio
from clerk_backend_api import Clerk
from app.core.config import settings

async def test_clerk():
    clerk_client = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)
    
    # Test with a known user ID from the activities
    test_user_id = "user_3B5eWoQkuQMK7DXGxiogpqPtXmg"
    
    try:
        print(f"Fetching user: {test_user_id}")
        clerk_user = clerk_client.users.get(test_user_id)
        
        first_name = clerk_user.first_name or ""
        last_name = clerk_user.last_name or ""
        full_name = f"{first_name} {last_name}".strip()
        
        print(f"✓ Success!")
        print(f"  First Name: {first_name}")
        print(f"  Last Name: {last_name}")
        print(f"  Full Name: {full_name}")
        
        if clerk_user.email_addresses:
            for email in clerk_user.email_addresses:
                if hasattr(email, 'id') and email.id == clerk_user.primary_email_address_id:
                    print(f"  Primary Email: {email.email_address}")
                    break
        
    except Exception as e:
        print(f"✗ Error: {e}")
        print(f"  Type: {type(e).__name__}")

if __name__ == "__main__":
    asyncio.run(test_clerk())
