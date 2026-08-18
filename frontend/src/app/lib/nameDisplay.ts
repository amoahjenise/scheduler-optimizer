import type { Nurse } from "./api";

interface AccountIdentity {
  fullName?: string | null;
  firstName?: string | null;
  primaryEmailAddress?: {
    emailAddress?: string | null;
  } | null;
}

function clean(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getAccountDisplayName(
  account?: AccountIdentity | null,
): string | null {
  const fullName = clean(account?.fullName);
  if (fullName) return fullName;

  const firstName = clean(account?.firstName);
  if (firstName) {
    return `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`;
  }

  return clean(account?.primaryEmailAddress?.emailAddress);
}

export function buildNurseNameByUserId(
  nurses: Nurse[],
): Map<string, { name: string; team: string | null }> {
  const map = new Map<string, { name: string; team: string | null }>();

  for (const nurse of nurses) {
    const userId = clean(nurse.user_id);
    const nurseName = clean(nurse.name);
    if (!userId || !nurseName) continue;
    map.set(userId, {
      name: nurseName,
      team: clean(nurse.team),
    });
  }

  return map;
}

export function resolveDisplayName(options: {
  nurseName?: string | null;
  accountName?: string | null;
  userId?: string | null;
  allowUserIdFallback?: boolean;
}): string | null {
  const nurseName = clean(options.nurseName);
  if (nurseName) return nurseName;

  const accountName = clean(options.accountName);
  if (accountName) return accountName;

  if (options.allowUserIdFallback) {
    return clean(options.userId);
  }

  return null;
}
