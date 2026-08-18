"""Verify permission gating actually blocks/allows the right roles.

Exercises the real FastAPI dependency (`require_permission`) rather than
re-implementing the rule in the test.
"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.auth import AuthContext, require_permission
from app.models.organization import MemberRole, DELEGATABLE_PERMISSIONS


class FakeOrg:
    def __init__(self, manager_perms, assistant_perms):
        self.manager_permissions = manager_perms
        self.assistant_manager_permissions = assistant_perms


class FakeMembership:
    def __init__(self, role):
        self.role = role
        self.is_active = True
        self.is_approved = True


def ctx(role, manager_perms=None, assistant_perms=None):
    return AuthContext(
        user_id="u1",
        organization_id="org1",
        organization=FakeOrg(
            list(DELEGATABLE_PERMISSIONS) if manager_perms is None else manager_perms,
            list(DELEGATABLE_PERMISSIONS) if assistant_perms is None else assistant_perms,
        ),
        membership=FakeMembership(role),
        is_authenticated=True,
    )


def allows(auth, permission) -> bool:
    """Run the actual dependency body and report whether it passed."""
    dep = require_permission(permission)
    try:
        dep(auth=auth)
        return True
    except HTTPException as exc:
        assert exc.status_code == 403, exc.status_code
        return False


def test_nurse_is_blocked_from_managing_staff():
    assert not allows(ctx(MemberRole.NURSE), "manage_nurses")
    print("PASS: nurse blocked from manage_nurses")


def test_admin_passes_every_gate():
    admin = ctx(MemberRole.ADMIN, manager_perms=[], assistant_perms=[])
    for permission in DELEGATABLE_PERMISSIONS:
        assert allows(admin, permission), permission
    print("PASS: admin passes all gates even with everything revoked")


def test_manager_blocked_once_admin_revokes_the_action():
    granted = ctx(MemberRole.MANAGER)
    assert allows(granted, "manage_nurses")

    revoked = ctx(
        MemberRole.MANAGER,
        manager_perms=[p for p in DELEGATABLE_PERMISSIONS if p != "manage_nurses"],
    )
    assert not allows(revoked, "manage_nurses")
    # Untouched actions still work.
    assert allows(revoked, "manage_schedules")
    print("PASS: revoking one action blocks only that action for a manager")


def test_assistant_manager_uses_its_own_grants():
    a = ctx(
        MemberRole.ASSISTANT_MANAGER,
        manager_perms=list(DELEGATABLE_PERMISSIONS),
        assistant_perms=["manage_handovers"],
    )
    assert allows(a, "manage_handovers")
    assert not allows(a, "manage_nurses")
    print("PASS: assistant manager gated by its own grants, not the manager's")


def test_error_message_is_human_readable():
    dep = require_permission("manage_nurses")
    with pytest.raises(HTTPException) as exc:
        dep(auth=ctx(MemberRole.NURSE))
    assert "manage nurses" in exc.value.detail
    print(f"PASS: readable 403 detail -> {exc.value.detail!r}")


if __name__ == "__main__":
    test_nurse_is_blocked_from_managing_staff()
    test_admin_passes_every_gate()
    test_manager_blocked_once_admin_revokes_the_action()
    test_assistant_manager_uses_its_own_grants()
    test_error_message_is_human_readable()
    print("\nAll permission enforcement tests passed.")
