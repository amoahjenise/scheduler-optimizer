#!/usr/bin/env python3
"""Check what organizational data remains and clean it."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.models import Nurse, Handover, OptimizedSchedule, DeletionActivity

def main():
    engine = create_engine(settings.DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    print("\n" + "="*60)
    print("Checking Remaining Organizational Data")
    print("="*60)
    
    # Check nurses
    nurses_with_org = session.query(Nurse).filter(Nurse.organization_id.isnot(None)).count()
    nurses_without_org = session.query(Nurse).filter(Nurse.organization_id.is_(None)).count()
    print(f"\n👨‍⚕️ Nurses:")
    print(f"  With organization_id: {nurses_with_org}")
    print(f"  Without organization_id (NULL): {nurses_without_org}")
    
    # Check handovers
    handovers_with_org = session.query(Handover).filter(Handover.organization_id.isnot(None)).count()
    handovers_without_org = session.query(Handover).filter(Handover.organization_id.is_(None)).count()
    print(f"\n📋 Handovers:")
    print(f"  With organization_id: {handovers_with_org}")
    print(f"  Without organization_id (NULL): {handovers_without_org}")
    
    # Check optimized schedules
    schedules_with_org = session.query(OptimizedSchedule).filter(OptimizedSchedule.organization_id.isnot(None)).count()
    schedules_without_org = session.query(OptimizedSchedule).filter(OptimizedSchedule.organization_id.is_(None)).count()
    print(f"\n📅 Optimized Schedules:")
    print(f"  With organization_id: {schedules_with_org}")
    print(f"  Without organization_id (NULL): {schedules_without_org}")
    
    # Check deletion activities
    activities_with_org = session.query(DeletionActivity).filter(DeletionActivity.organization_id.isnot(None)).count()
    activities_without_org = session.query(DeletionActivity).filter(DeletionActivity.organization_id.is_(None)).count()
    print(f"\n🗑️  Deletion Activities:")
    print(f"  With organization_id: {activities_with_org}")
    print(f"  Without organization_id (NULL): {activities_without_org}")
    
    # Ask if user wants to delete legacy data too
    if nurses_without_org > 0 or handovers_without_org > 0 or schedules_without_org > 0 or activities_without_org > 0:
        print(f"\n{'='*60}")
        print("⚠️  Found legacy data with NULL organization_id")
        print("   This is likely from before multi-org was implemented.")
        print("="*60)
        response = input("\nDelete legacy data too? (yes/no): ")
        
        if response.lower() == 'yes':
            print("\n🗑️  Deleting legacy data...")
            
            # Delete all records (including NULL org_id)
            nurses_deleted = session.query(Nurse).delete(synchronize_session=False)
            handovers_deleted = session.query(Handover).delete(synchronize_session=False)
            schedules_deleted = session.query(OptimizedSchedule).delete(synchronize_session=False)
            activities_deleted = session.query(DeletionActivity).delete(synchronize_session=False)
            
            session.commit()
            
            print(f"  ✓ Deleted {nurses_deleted} nurses")
            print(f"  ✓ Deleted {handovers_deleted} handovers")
            print(f"  ✓ Deleted {schedules_deleted} optimized schedules")
            print(f"  ✓ Deleted {activities_deleted} deletion activities")
            print("\n✅ All organizational data (including legacy) deleted!")
        else:
            print("\n❌ Legacy data kept intact.")
    else:
        print("\n✅ No legacy data found - database is clean!")
    
    session.close()

if __name__ == "__main__":
    main()
