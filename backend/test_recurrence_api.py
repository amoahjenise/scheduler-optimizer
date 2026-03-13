"""Test recurrence and employee preference API endpoints."""

import requests
import json
from datetime import datetime, date, timedelta
import os

# Configuration
BASE_URL = "http://localhost:8000/api/scheduling"
ORG_ID = "org_test_123"  # Use a test org ID
NURSE_ID = None  # We'll get this from the database

# Test data
TEST_RECURRENCE = {
    "name": "2-Week Night Rotation",
    "description": "Alternating night shifts every 2 weeks",
    "recurrence_type": "bi-weekly",
    "cycle_length_days": 14,
    "pattern": {
        "monday": ["Z99"],
        "tuesday": ["Z99"],
        "wednesday": ["Z99"],
        "thursday": ["OFF"],
        "friday": ["OFF"],
        "saturday": ["OFF"],
        "sunday": ["OFF"]
    },
    "applicable_nurses": [],
    "start_date": str(date.today()),
    "end_date": None,
    "is_active": True
}

def test_recurrence_endpoints():
    """Test recurrence CRUD endpoints."""
    print("\n" + "="*60)
    print("TESTING RECURRENCE ENDPOINTS")
    print("="*60)
    
    recurrence_id = None
    
    # Test 1: Create recurrence
    print("\n1. CREATE RECURRENCE")
    print("-" * 40)
    headers = {
        "Authorization": f"Bearer test_org_{ORG_ID}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        f"{BASE_URL}/recurrences",
        json=TEST_RECURRENCE,
        headers=headers,
        timeout=15
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2, default=str)}")
    
    if response.status_code == 201 or response.status_code == 200:
        recurrence_data = response.json()
        recurrence_id = recurrence_data.get("id")
        print(f"✅ Recurrence created successfully (ID: {recurrence_id})")
    else:
        print(f"❌ Failed to create recurrence")
        return
    
    # Test 2: List recurrences
    print("\n2. LIST RECURRENCES")
    print("-" * 40)
    response = requests.get(
        f"{BASE_URL}/recurrences",
        headers=headers,
        timeout=10
    )
    
    print(f"Status: {response.status_code}")
    data = response.json()
    if isinstance(data, list):
        print(f"Total recurrences: {len(data)}")
        if data:
            print(f"First recurrence: {json.dumps(data[0], indent=2, default=str)}")
        print(f"✅ List recurrences successful")
    else:
        print(f"Response: {json.dumps(data, indent=2, default=str)}")
    
    # Test 3: Get specific recurrence
    if recurrence_id:
        print(f"\n3. GET RECURRENCE (ID: {recurrence_id})")
        print("-" * 40)
        response = requests.get(
            f"{BASE_URL}/recurrences/{recurrence_id}",
            headers=headers,
            timeout=10
        )
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {json.dumps(response.json(), indent=2, default=str)}")
            print(f"✅ Get recurrence successful")
        else:
            print(f"❌ Failed to get recurrence")
            print(f"Response: {response.text}")
    
    # Test 4: Update recurrence
    if recurrence_id:
        print(f"\n4. UPDATE RECURRENCE (ID: {recurrence_id})")
        print("-" * 40)
        update_data = TEST_RECURRENCE.copy()
        update_data["name"] = "Updated 2-Week Night Rotation"
        update_data["description"] = "Updated description"
        
        response = requests.put(
            f"{BASE_URL}/recurrences/{recurrence_id}",
            json=update_data,
            headers=headers,
            timeout=15
        )
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {json.dumps(response.json(), indent=2, default=str)}")
            print(f"✅ Update recurrence successful")
        else:
            print(f"❌ Failed to update recurrence")
            print(f"Response: {response.text}")
    
    # Test 5: Generate schedule from recurrence
    if recurrence_id:
        print(f"\n5. GENERATE SCHEDULE FROM RECURRENCE (ID: {recurrence_id})")
        print("-" * 40)
        generate_request = {
            "start_date": str(date.today()),
            "end_date": str(date.today() + timedelta(days=28)),
            "override_nurses": []
        }
        
        response = requests.post(
            f"{BASE_URL}/recurrences/{recurrence_id}/generate-schedule",
            json=generate_request,
            headers=headers,
            timeout=30
        )
        
        print(f"Status: {response.status_code}")
        if response.status_code in [200, 201]:
            data = response.json()
            print(f"Response: {json.dumps(data, indent=2, default=str)[:500]}...")
            print(f"✅ Generate schedule successful")
        else:
            print(f"❌ Failed to generate schedule")
            print(f"Response: {response.text}")
    
    return recurrence_id


def test_employee_preference_endpoints():
    """Test employee preference endpoints."""
    print("\n" + "="*60)
    print("TESTING EMPLOYEE PREFERENCE ENDPOINTS")
    print("="*60)
    
    headers = {
        "Authorization": f"Bearer test_org_{ORG_ID}",
        "Content-Type": "application/json"
    }
    
    # First, get a nurse ID from the database
    print("\nFetching nurse from database...")
    try:
        from app.db.database import SessionLocal
        from app.models.nurse import Nurse
        
        db = SessionLocal()
        nurse = db.query(Nurse).filter(Nurse.organization_id == ORG_ID).first()
        
        if nurse:
            nurse_id = str(nurse.id)
            print(f"✅ Found nurse: {nurse.name} (ID: {nurse_id})")
        else:
            print(f"⚠️  No nurses found for org {ORG_ID}, using placeholder")
            nurse_id = "550e8400-e29b-41d4-a716-446655440000"  # UUID placeholder
        
        db.close()
    except Exception as e:
        print(f"⚠️  Could not fetch nurse from database: {e}")
        nurse_id = "550e8400-e29b-41d4-a716-446655440000"  # UUID placeholder
    
    # Test 1: Create employee preference
    print("\n1. CREATE EMPLOYEE PREFERENCE")
    print("-" * 40)
    
    preference_data = {
        "nurse_id": nurse_id,
        "preferred_pattern": {
            "monday": ["Z07"],
            "tuesday": ["Z07"],
            "wednesday": ["OFF"],
            "thursday": ["Z99"],
            "friday": ["Z99"],
            "saturday": ["OFF"],
            "sunday": ["Z07"]
        },
        "period_start_date": str(date.today()),
        "period_end_date": str(date.today() + timedelta(days=30)),
        "constraints": {
            "max_consecutive_days": 4,
            "min_break_days": 2
        },
        "source": "manual",
        "status": "pending_review"
    }
    
    response = requests.post(
        f"{BASE_URL}/employee-preferences",
        json=preference_data,
        headers=headers,
        timeout=15
    )
    
    print(f"Status: {response.status_code}")
    preference_id = None
    if response.status_code in [200, 201]:
        pref_data = response.json()
        preference_id = pref_data.get("id")
        print(f"Response: {json.dumps(pref_data, indent=2, default=str)}")
        print(f"✅ Employee preference created (ID: {preference_id})")
    else:
        print(f"❌ Failed to create preference")
        print(f"Response: {response.text}")
        return
    
    # Test 2: Get employee preferences
    print(f"\n2. GET EMPLOYEE PREFERENCES (Nurse ID: {nurse_id})")
    print("-" * 40)
    response = requests.get(
        f"{BASE_URL}/employee-preferences/{nurse_id}",
        headers=headers,
        timeout=10
    )
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        if isinstance(data, list):
            print(f"Total preferences: {len(data)}")
            if data:
                print(f"First preference: {json.dumps(data[0], indent=2, default=str)[:300]}...")
        else:
            print(f"Response: {json.dumps(data, indent=2, default=str)}")
        print(f"✅ Get employee preferences successful")
    else:
        print(f"❌ Failed to get preferences")
        print(f"Response: {response.text}")
    
    # Test 3: Update employee preference
    if preference_id:
        print(f"\n3. UPDATE EMPLOYEE PREFERENCE (ID: {preference_id})")
        print("-" * 40)
        
        update_data = preference_data.copy()
        update_data["status"] = "approved"
        update_data["admin_notes"] = "Approved by scheduler"
        
        response = requests.put(
            f"{BASE_URL}/employee-preferences/{preference_id}",
            json=update_data,
            headers=headers,
            timeout=15
        )
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {json.dumps(response.json(), indent=2, default=str)[:300]}...")
            print(f"✅ Update employee preference successful")
        else:
            print(f"❌ Failed to update preference")
            print(f"Response: {response.text}")


def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("RECURRENCE AND EMPLOYEE PREFERENCE API TEST SUITE")
    print("="*60)
    print(f"Base URL: {BASE_URL}")
    print(f"Test Org ID: {ORG_ID}")
    
    try:
        # Test recurrence endpoints
        test_recurrence_endpoints()
        
        # Test employee preference endpoints
        test_employee_preference_endpoints()
        
        print("\n" + "="*60)
        print("✅ TEST SUITE COMPLETED")
        print("="*60)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
