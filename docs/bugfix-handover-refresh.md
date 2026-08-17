# Handover Refresh Bug (Resolved)

## What was happening

After creating handoff reports, a page refresh could show an empty list even though records existed.

## Root cause

The handover page fetched data before organization context finished loading.
When that happened, requests were missing `X-Organization-ID`, and the backend correctly returned no org-scoped handovers.

## Fix

In `frontend/src/app/handover/page.tsx`, data loading was gated until org context was ready.

Before:

- fetch kicked off as soon as `user?.id` existed

After:

- fetch waits for `user?.id`
- fetch waits for `orgLoading === false`
- fetch waits for `currentOrganization` to exist

## Why this works

`getAuthHeaders()` now consistently includes both:

- `Authorization: Bearer ...`
- `X-Organization-ID: ...`

That means the backend query is scoped to the right organization on first load and after refresh.

## Quick regression check

1. Open `/handover`
2. Create a report
3. Refresh
4. Confirm the report still appears

## Files involved

- `frontend/src/app/handover/page.tsx`
- `frontend/src/app/context/OrganizationContext.tsx`

## Follow-up rule

Any page that depends on org-scoped APIs should not fetch until org context is fully resolved.
