"""Role and permission resolution checks."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.auth import AuthContext
from app.models.organization import (
    MemberRole,
    DELEGATABLE_PERMISSIONS,
    MAX_ASSISTANT_MANAGERS,
)


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
    org = FakeOrg(
        manager_perms if manager_perms is not None else list(DELEGATABLE_PERMISSIONS),
        assistant_perms if assistant_perms is not None else list(DELEGATABLE_PERMISSIONS),
    )
    return AuthContext(
        user_id="u1",
        organization_id="org1",
        organization=org,
        membership=FakeMembership(role),
        is_authenticated=True,
    )


def test_admin_always_has_everything():
    a = ctx(MemberRole.ADMIN, manager_perms=[], assistant_perms=[])
    assert set(a.permissions) == set(DELEGATABLE_PERMISSIONS)
    assert a.has_permission("manage_org_settings")
    assert a.can_manage
    print("PASS: admin holds every permission regardless of org config")


def test_manager_uses_org_configuration():
    a = ctx(MemberRole.MANAGER, manager_perms=["manage_nurses", "manage_schedules"])
    assert a.has_permission("manage_nurses")
    assert a.has_permission("manage_schedules")
    assert not a.has_permission("manage_org_settings")
    assert a.can_manage
    print("PASS: manager limited to admin-granted actions")


def test_assistant_manager_has_own_set():
    a = ctx(
        MemberRole.ASSISTANT_MANAGER,
        manager_perms=list(DELEGATABLE_PERMISSIONS),
        assistant_perms=["manage_handovers"],
    )
    assert a.permissions == ["manage_handovers"]
    assert not a.has_permission("manage_nurses")
    assert a.can_manage
    print("PASS: assistant manager uses its own permission set")


def test_nurse_has_no_delegatable_permissions():
    a = ctx(MemberRole.NURSE)
    assert a.permissions == []
    assert not a.has_permission("manage_nurses")
    assert not a.can_manage
    print("PASS: nurse holds no delegatable permissions")


def test_manager_stripped_of_everything_loses_can_manage():
    a = ctx(MemberRole.MANAGER, manager_perms=[])
    assert a.permissions == []
    assert not a.can_manage
    print("PASS: fully revoked manager no longer counts as management")


def test_unknown_permissions_are_ignored():
    a = ctx(MemberRole.MANAGER, manager_perms=["manage_nurses", "make_coffee"])
    assert a.permissions == ["manage_nurses"]
    print("PASS: unknown stored permissions are ignored")


def test_assistant_manager_cap_is_two():
    assert MAX_ASSISTANT_MANAGERS == 2
    print("PASS: assistant manager cap is 2")


if __name__ == "__main__":
    test_admin_always_has_everything()
    test_manager_uses_org_configuration()
    test_assistant_manager_has_own_set()
    test_nurse_has_no_delegatable_permissions()
    test_manager_stripped_of_everything_loses_can_manage()
    test_unknown_permissions_are_ignored()
    test_assistant_manager_cap_is_two()
    print("\nAll role permission tests passed.")
