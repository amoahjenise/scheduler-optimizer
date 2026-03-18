#!/usr/bin/env python3
"""Check authentication setup."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.models.user import User
from app.models.organization import Organization, OrganizationMember

engine = create_engine(settings.DATABASE_URL)
Session = sessionmaker(bind=engine)
session = Session()

print("\n" + "="*60)
print("Authentication Setup Status")
print("="*60)

users = session.query(User).all()
orgs = session.query(Organization).all()
members = session.query(OrganizationMember).all()

print(f"\n👤 Users: {len(users)}")
for user in users:
    print(f"  - ID: {user.id[:20]}...")
    print(f"    Active: {user.is_active}")

print(f"\n🏢 Organizations: {len(orgs)}")
for org in orgs:
    print(f"  - Name: {org.name}")
    print(f"    ID: {org.id[:20]}...")

print(f"\n👥 Organization Members: {len(members)}")
for member in members:
    print(f"  - User: {member.user_id[:20]}...")
    print(f"    Org: {member.organization_id[:20]}...")
    print(f"    Role: {member.role.value}")
    print(f"    Status: {member.status.value}")

if not users:
    print("\n⚠️  NO USERS FOUND!")
    print("   You need to:")
    print("   1. Sign up/login via Clerk in the frontend")
    print("   2. The Clerk webhook will create your user")
elif not orgs:
    print("\n⚠️  NO ORGANIZATIONS FOUND!")
    print("   You need to:")
    print("   1. Login to the frontend")
    print("   2. Create a new organization")
elif not members:
    print("\n⚠️  NO ORGANIZATION MEMBERS!")
    print("   You need to join an organization")
else:
    print("\n✅ Authentication setup looks good!")
    print("\nTo access the API, you need to:")
    print("1. Be logged in via Clerk (JWT token in Authorization header)")
    print("2. Include your organization ID in requests")

session.close()
