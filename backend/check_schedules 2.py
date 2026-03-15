#!/usr/bin/env python3
"""
Script to check optimized schedules in the database
Run from backend directory: python check_schedules.py
"""
import sys
import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import json

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in environment")
    sys.exit(1)

print(f"Connecting to database...")
engine = create_engine(DATABASE_URL)

try:
    with engine.connect() as conn:
        # Check if table exists
        result = conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'optimized_schedules'
            );
        """))
        table_exists = result.scalar()
        
        if not table_exists:
            print("❌ Table 'optimized_schedules' does not exist!")
            sys.exit(1)
        
        print("✅ Table 'optimized_schedules' exists\n")
        
        # Count total schedules
        result = conn.execute(text("SELECT COUNT(*) FROM optimized_schedules"))
        total_count = result.scalar()
        print(f"Total schedules: {total_count}")
        
        # Count finalized schedules
        result = conn.execute(text("SELECT COUNT(*) FROM optimized_schedules WHERE finalized = true"))
        finalized_count = result.scalar()
        print(f"Finalized schedules: {finalized_count}")
        
        # List all schedules with details
        result = conn.execute(text("""
            SELECT 
                id, 
                organization_id, 
                finalized, 
                created_at,
                result->>'start_date' as start_date,
                result->>'end_date' as end_date
            FROM optimized_schedules 
            ORDER BY created_at DESC 
            LIMIT 10
        """))
        
        schedules = result.fetchall()
        
        if schedules:
            print(f"\n{'='*80}")
            print("Recent Schedules:")
            print(f"{'='*80}")
            for schedule in schedules:
                print(f"\nID: {schedule[0]}")
                print(f"  Organization ID: {schedule[1] or 'None'}")
                print(f"  Finalized: {schedule[2]}")
                print(f"  Created: {schedule[3]}")
                print(f"  Start Date: {schedule[4] or 'N/A'}")
                print(f"  End Date: {schedule[5] or 'N/A'}")
        else:
            print("\n⚠️  No schedules found in database")
        
        # Check organization IDs
        result = conn.execute(text("""
            SELECT DISTINCT organization_id, COUNT(*) 
            FROM optimized_schedules 
            GROUP BY organization_id
        """))
        
        orgs = result.fetchall()
        if orgs:
            print(f"\n{'='*80}")
            print("Schedules by Organization:")
            print(f"{'='*80}")
            for org_id, count in orgs:
                print(f"Organization: {org_id or 'NULL'} - Count: {count}")
        
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
finally:
    engine.dispose()

print("\n✅ Database check complete")
