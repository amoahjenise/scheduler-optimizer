# Admin Onboarding Guide

This guide is for new administrators or team leads using the scheduler. It is intended to make setup and day-to-day use simple, consistent, and safe.

> Safety note: Keep this guide generic. Do not store staff names, employee IDs, patient identifiers, or sensitive operational details in onboarding notes or documentation.

## 1. What you are responsible for

As an admin or manager, your main responsibilities are to keep the scheduling environment usable and aligned with unit policy.

This usually means:

- confirming the active shift-code setup
- keeping staffing roles accurate
- maintaining staffing team structure
- reviewing schedule coverage before approval
- checking leave and off-request inputs
- making sure the final schedule is safe and balanced

---

## 2. First things to check

When you first open the system, review these areas in order:

### A. Shift code setup

Confirm that the active shift codes reflect the unit's real working pattern.

Check:

- standard day and night codes are present
- codes match actual working shifts
- hours values are accurate
- labels are clear and consistent

### B. Staffing roles

Review who is assigned to leadership or staff coverage roles.

Typical categories:

- nurse
- assistant manager

Make sure the staffing role matches the actual operational workflow and permission model.

### C. Staffing teams

Review the current staffing team list and assignment pattern.

Check:

- team labels are clear and consistent
- team membership makes operational sense
- weekend rotation is aligned with policy when enabled
- assistant managers are mapped correctly if that workflow is used

### D. Schedule requirements

Before approving a schedule, review:

- daily staffing minimums
- day, evening, and night block coverage
- existing leave requests
- any dates with unusual demand or reduced staffing

---

## 3. How to use the scheduler

### Step 1: Review the current setup

Start with the schedule template or the current scheduling period and check:

- active shift codes
- team assignments
- staffing role assignments
- leave and off dates

### Step 2: Generate or rebuild the schedule

When coverage needs to be rebuilt, use the scheduler to generate or refresh the schedule based on the current inputs.

The scheduler will typically:

- preserve valid existing assignments
- respect approved leave requests
- fill coverage gaps within constraints
- balance assignments and avoid obvious overuse

### Step 3: Review coverage quality

After generation, review the schedule with the question: “Is this operationally safe and realistic?”

Look for:

- minimum coverage met
- appropriate day/evening/night distribution
- no obvious under-staffed block
- no unreasonable assignment clustering

### Step 4: Make manual adjustments if needed

The algorithm is helpful, but it is not the final authority. If the schedule looks plausible but not operationally sound, correct it before approval.

Manual adjustments should be used for:

- unusual or special coverage needs
- true operational exceptions
- fairness issues across teams
- schedule quality problems that the algorithm cannot reasonably resolve

### Step 5: Approve with confidence

A schedule is ready when:

- coverage is adequate
- rules are respected
- leave requests are honored
- staffing teams and roles remain sensible
- the schedule is understandable to the staff team

---

## 4. Key concepts to remember

### Staffing roles

A staffing role is not just a label. It influences the staffing model and operational logic.

Typical examples:

- nurse
- assistant manager

### Staffing teams

A staffing team is used to group nurses operationally, often for combined coverage or weekend planning.

### Shift codes

Shift codes define actual assignments used in the schedule. They are the building blocks for coverage.

### Full coverage

Full coverage means enough staff to satisfy operational minimums without violating normal staffing rules. It is not simply “everyone assigned as much as possible.”

---

## 5. Common admin tasks

### Update staffing teams

Use this when the unit structure changes or the current organizational grouping needs to be adjusted.

### Check role assignments

Use this when new leadership coverage is needed or when staffing responsibilities change.

### Review shift codes

Use this when the unit's actual scheduling model changes, such as new shift patterns or altered coverage windows.

### Review leave requests

Use this before scheduling so the system can respect approved off periods and avoid booking people on unavailable dates.

### Approve final schedule

Use the manager checklist as a final review step before the schedule is shared or published.

---

## 6. Red flags

Do not approve a final schedule if you see:

- a shift block with no realistic coverage
- obvious overuse of a few nurses
- leave requests being ignored without a valid reason
- staffing teams used inconsistently
- role assignments that do not match the actual staffing structure
- a plan that looks mathematically valid but operationally weak

---

## 7. Recommended routine

A practical weekly routine is:

1. Review staffing roles and teams
2. Confirm leave and off requests
3. Review shift-code setup
4. Generate or refresh the schedule
5. Check coverage quality
6. Make manual fixes if needed
7. Approve or return for revision

---

## 8. Related internal references

- [docs/scheduler-operations-guide.md](scheduler-operations-guide.md)
- [docs/manager-scheduling-checklist.md](manager-scheduling-checklist.md)
- [README.md](../README.md)

---

## 9. Simple operating rule

If the schedule is safe, balanced, consistent with rules, and understandable to the team, it is usually a good schedule for approval.
