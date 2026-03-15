import sys
sys.path.insert(0, '.')
from app.db.session import SessionLocal
from app.models.nurse import Nurse
from app.models.organization import Organization

db = SessionLocal()
try:
    orgs = db.query(Organization).all()
    for org in orgs:
        print(f'\n=== {org.name} (ID: {org.id}) ===')
        print(f'FT Target: {org.full_time_weekly_target}h bi-weekly')
        print(f'PT Target: {org.part_time_weekly_target}h bi-weekly')
        
        nurses = db.query(Nurse).filter(Nurse.organization_id == org.id).all()
        ft_updated = 0
        pt_updated = 0
        
        for nurse in nurses:
            old = nurse.target_weekly_hours
            if nurse.employment_type == 'full-time':
                new = org.full_time_weekly_target
                if old != new:
                    print(f'  FT: {nurse.name}: {old}h -> {new}h')
                    nurse.target_weekly_hours = new
                    ft_updated += 1
            else:
                new = org.part_time_weekly_target
                if old != new:
                    print(f'  PT: {nurse.name}: {old}h -> {new}h')
                    nurse.target_weekly_hours = new
                    pt_updated += 1
        
        db.commit()
        print(f'Updated {ft_updated} FT and {pt_updated} PT nurses')
    
    print('\nDone!')
except Exception as e:
    db.rollback()
    print(f'Error: {e}')
    raise
finally:
    db.close()
