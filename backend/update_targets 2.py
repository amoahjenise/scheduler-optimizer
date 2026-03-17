#!/usr/bin/env python3
import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv('DATABASE_URL', 'postgresql://scheduler:scheduler@localhost/scheduler_db')
engine = create_engine(DB_URL)

with engine.connect() as conn:
    # Get organization defaults
    org_result = conn.execute(text('SELECT id, name, full_time_weekly_target, part_time_weekly_target FROM organizations LIMIT 1'))
    org = org_result.fetchone()
    
    if not org:
        print('No organization found')
        exit(1)
    
    org_id, org_name, ft_target, pt_target = org
    print(f'Organization: {org_name}')
    print(f'FT Default: {ft_target}h bi-weekly')
    print(f'PT Default: {pt_target}h bi-weekly')
    print()
    
    # Update FT nurses
    ft_result = conn.execute(text("""
        UPDATE nurses 
        SET target_weekly_hours = :ft_target
        WHERE organization_id = :org_id 
        AND employment_type = 'full-time'
        AND target_weekly_hours != :ft_target
        RETURNING name, target_weekly_hours
    """), {'ft_target': ft_target, 'org_id': org_id})
    
    ft_updated = ft_result.rowcount
    for row in ft_result:
        print(f'FT: {row[0]} -> {row[1]}h')
    
    # Update PT nurses
    pt_result = conn.execute(text("""
        UPDATE nurses 
        SET target_weekly_hours = :pt_target
        WHERE organization_id = :org_id 
        AND employment_type = 'part-time'
        AND target_weekly_hours != :pt_target
        RETURNING name, target_weekly_hours
    """), {'pt_target': pt_target, 'org_id': org_id})
    
    pt_updated = pt_result.rowcount
    for row in pt_result:
        print(f'PT: {row[0]} -> {row[1]}h')
    
    conn.commit()
    print()
    print(f'Updated {ft_updated} FT and {pt_updated} PT nurses')

