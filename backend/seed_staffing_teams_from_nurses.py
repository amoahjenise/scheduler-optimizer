"""Safely seed staffing teams from existing nurse team values.

Usage:
  cd backend
  ../.venv/bin/python seed_staffing_teams_from_nurses.py
  ../.venv/bin/python seed_staffing_teams_from_nurses.py --apply
  ../.venv/bin/python seed_staffing_teams_from_nurses.py --apply --org-id <ORG_ID>

Behavior:
- Dry-run by default (no writes).
- Adds distinct non-empty Nurse.team values into Organization.staffing_team_options.
- Does not remove existing staffing teams.
- Optionally maps assistant managers to their current Nurse.team when possible.
"""

from __future__ import annotations

import argparse
from typing import Dict, List, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.models.nurse import Nurse
from app.models.organization import Organization


def normalize_unique(values: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        item = raw.strip()
        if not item:
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def build_seed_updates(
    db: Session,
    organization: Organization,
    seed_assistant_manager_map: bool,
) -> Tuple[List[str], Dict[str, str]]:
    existing_staffing_teams = normalize_unique(
        list(organization.staffing_team_options or []),
    )
    existing_staffing_keys = {value.casefold() for value in existing_staffing_teams}

    nurse_team_rows = (
        db.query(func.distinct(Nurse.team))
        .filter(Nurse.organization_id == organization.id, Nurse.team.isnot(None))
        .all()
    )
    discovered_teams = normalize_unique([row[0] for row in nurse_team_rows if row[0]])

    merged_staffing_teams = list(existing_staffing_teams)
    for team in discovered_teams:
        key = team.casefold()
        if key in existing_staffing_keys:
            continue
        merged_staffing_teams.append(team)
        existing_staffing_keys.add(key)

    next_map: Dict[str, str] = dict(organization.assistant_manager_team_map or {})
    if seed_assistant_manager_map:
        assistant_managers = (
            db.query(Nurse)
            .filter(
                Nurse.organization_id == organization.id,
                Nurse.staffing_role == "assistant_manager",
            )
            .all()
        )
        allowed_keys = {value.casefold(): value for value in merged_staffing_teams}
        for assistant in assistant_managers:
            if not assistant.team:
                continue
            team_key = assistant.team.strip().casefold()
            if team_key not in allowed_keys:
                continue
            next_map[str(assistant.id)] = allowed_keys[team_key]

    return merged_staffing_teams, next_map


def run(org_id: str | None, apply: bool, seed_assistant_manager_map: bool) -> int:
    db = SessionLocal()
    changed_orgs = 0
    try:
        query = db.query(Organization).filter(Organization.is_active == True)
        if org_id:
            query = query.filter(Organization.id == org_id)

        organizations = query.order_by(Organization.name).all()
        if not organizations:
            print("No organizations found for selection.")
            return 0

        print(f"Found {len(organizations)} organization(s).")
        for org in organizations:
            next_staffing_teams, next_map = build_seed_updates(
                db,
                org,
                seed_assistant_manager_map=seed_assistant_manager_map,
            )

            current_staffing = normalize_unique(list(org.staffing_team_options or []))
            current_map = dict(org.assistant_manager_team_map or {})

            changed_teams = current_staffing != next_staffing_teams
            changed_map = current_map != next_map

            if not changed_teams and not changed_map:
                print(f"- {org.name} ({org.id}): no changes")
                continue

            changed_orgs += 1
            print(f"- {org.name} ({org.id})")
            if changed_teams:
                print(f"  staffing_team_options: {current_staffing} -> {next_staffing_teams}")
            if changed_map:
                print(f"  assistant_manager_team_map entries: {len(current_map)} -> {len(next_map)}")

            if apply:
                org.staffing_team_options = next_staffing_teams
                org.assistant_manager_team_map = next_map

        if apply and changed_orgs:
            db.commit()
            print(f"Applied updates to {changed_orgs} organization(s).")
        elif apply:
            print("No updates required.")
        else:
            print("Dry-run complete. Re-run with --apply to persist changes.")

        return 0
    except Exception as exc:
        db.rollback()
        print(f"Failed: {exc}")
        return 1
    finally:
        db.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed staffing teams from existing nurse team values",
    )
    parser.add_argument(
        "--org-id",
        help="Only process a specific organization ID",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist updates (default is dry-run)",
    )
    parser.add_argument(
        "--no-assistant-manager-map",
        action="store_true",
        help="Do not seed assistant_manager_team_map from assistant manager nurse.team",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(
        run(
            org_id=args.org_id,
            apply=args.apply,
            seed_assistant_manager_map=not args.no_assistant_manager_map,
        )
    )
