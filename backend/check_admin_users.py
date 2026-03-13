#!/usr/bin/env python3
"""
Check for admin users with organizations in the database.
"""
import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL not set in .env")
    exit(1)

# Create engine
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as conn:
        # Query for admin users with organizations
        query = text("""
            SELECT 
                om.id,
                om.user_id,
                om.user_email,
                om.user_name,
                om.role,
                om.organization_id,
                o.name as organization_name,
                om.joined_at,
                om.is_active
            FROM organization_memberships om
            JOIN organizations o ON o.id = om.organization_id
            WHERE om.role = 'admin'
            ORDER BY o.name, om.user_name;
        """)
        
        result = conn.execute(query)
        rows = result.fetchall()
        
        print("=" * 120)
        print("ADMIN USERS WITH ORGANIZATIONS")
        print("=" * 120)
        
        if not rows:
            print("❌ No admin users found with organizations")
        else:
            print(f"\n✅ Found {len(rows)} admin user(s) with organization(s):\n")
            
            for i, row in enumerate(rows, 1):
                print(f"[{i}] Admin User:")
                print(f"    User ID: {row[1]}")
                print(f"    Email: {row[2]}")
                print(f"    Name: {row[3]}")
                print(f"    Role: {row[4]}")
                print(f"    Organization: {row[6]}")
                print(f"    Organization ID: {row[5]}")
                print(f"    Active: {row[8]}")
                print(f"    Joined: {row[7]}")
                print()
        
        print("=" * 120)
        
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
