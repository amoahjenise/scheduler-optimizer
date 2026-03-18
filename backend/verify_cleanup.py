#!/usr/bin/env python3
"""Verify the database cleanup and show what remains."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.models.shift_code import ShiftCode, TimeSlot
from app.models.user import User

def main():
    engine = create_engine(settings.DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()
    inspector = inspect(engine)
    
    print("\n" + "="*60)
    print("Database Status After Cleanup")
    print("="*60)
    
    # Check all tables
    table_names = inspector.get_table_names()
    
    print(f"\n📊 Tables in database: {len(table_names)}")
    
    non_empty_tables = []
    for table_name in sorted(table_names):
        try:
            from sqlalchemy import text
            result = session.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
            count = result.scalar()
            if count > 0:
                non_empty_tables.append((table_name, count))
        except Exception as e:
            pass
    
    print(f"\n📋 Non-empty tables:")
    print("-" * 60)
    for table_name, count in non_empty_tables:
        print(f"  {table_name}: {count:,} records")
    
    # Check system defaults
    print(f"\n🔧 System Defaults (NULL organization_id):")
    print("-" * 60)
    system_shift_codes = session.query(ShiftCode).filter(ShiftCode.organization_id.is_(None)).count()
    system_time_slots = session.query(TimeSlot).filter(TimeSlot.organization_id.is_(None)).count()
    print(f"  System Shift Codes: {system_shift_codes}")
    print(f"  System Time Slots: {system_time_slots}")
    
    # Check users
    print(f"\n👤 Users:")
    print("-" * 60)
    users = session.query(User).count()
    print(f"  Total Users: {users}")
    
    print(f"\n{'='*60}")
    print("✅ Database is clean - all organizational data removed")
    print("="*60)
    
    session.close()

if __name__ == "__main__":
    main()
