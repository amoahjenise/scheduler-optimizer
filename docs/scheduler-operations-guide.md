# Scheduler Operations Guide

This guide is for internal use only. It explains the main scheduling concepts, staffing structure, and day-to-day workflow for the scheduler without exposing sensitive operational data.

> Safety note: Do not add names, employee IDs, personal health details, patient identifiers, or other sensitive records to this guide or any scheduling notes.

## 1. What this system is for

This scheduler helps a unit build and maintain a safe, balanced coverage plan across a scheduling period.

It is designed to:

- map working shifts to standard shift codes
- preserve valid existing assignments when possible
- respect approved time off and leave requests
- maintain minimum staffing coverage by time of day
- balance hours fairly across nurses
- enforce basic staffing rules such as consecutive day limits and rest windows
- support staff structure by role and staffing team

The aim is not to create perfect coverage at any cost. The aim is to create safe, workable coverage that is consistent with unit rules and staffing requirements.

---

## 2. Core concepts

### 2.1 Shift codes

Shift codes are the building blocks of the schedule. They identify the actual assigned shift for each nurse on a day.

Common examples in this system:

- `07` — Day 8-hour shift
- `11` — Mid 8-hour shift
- `E15` — Evening 8-hour shift
- `23` — Night 8-hour shift
- `Z07` — Day 12-hour shift
- `Z11` — Mid 12-hour shift
- `Z19` — Evening split / night start component
- `Z23` — Night finish component
- `Z23 B` — Combined overnight pattern with return coverage

The scheduler treats shift codes as either:

- day coverage
- evening coverage
- night coverage
- off / leave / holiday markers

Hours are tracked as paid hours, not necessarily raw clock time.

### 2.2 Time slots

A time slot is a staffing category used in planning and self-scheduling. It usually maps to one or more shift codes.

Examples:

- D8 — Day 8-hour coverage
- E8 — Evening 8-hour coverage
- N8 — Night 8-hour coverage
- ZD12 — Day 12-hour coverage
- ZN — Night split coverage

These are planning buckets. The system still resolves them back to exact shift codes before scheduling.

### 2.3 Staffing role hierarchy

The application separates two related concepts:

- `role` for organization membership access
- `staffing_role` for staffing structure and scheduling logic

Default role hierarchy:

1. Admin
   - full system control
   - can manage organization settings and permissions
2. Manager
   - operational owner of schedule, nurses, and settings
3. Assistant Manager
   - acts as delegated leadership coverage
   - may have manager-like permissions depending on configuration
4. Nurse
   - standard staff role
   - can view and contribute to operational workflows based on permissions

In practice, `staffing_role` is usually set to one of:

- `nurse`
- `assistant_manager`

This distinction matters because assistant managers may be treated differently in weekend rotation, leadership coverage, and assignment logic.

### 2.4 Staffing team

A staffing team is a grouping used to organize staff by unit coverage group or functional team.

Examples of team labels:

- Team A
- Team B
- custom team labels configured by the organization

Purpose:

- grouping staff for operational assignments
- helping weekend rotation coverage
- clarifying reporting and coverage by group
- supporting delegation in larger units
- aligning each team with a dedicated assistant manager when the organization uses that model

The operating goal is to have one assistant manager per team so leadership coverage, team accountability, and weekend coverage are clearly mapped.

A nurse can belong to a staffing team even if they still have a standard nursing role.

### 2.5 Schedule breakdown

A schedule is built from daily assignments across a defined date range.

Typical schedule structure:

- date
- nurse or staff member
- assigned shift code
- assigned staffing team
- day/evening/night designation
- off request or leave indicator
- notes or comments

The scheduler looks at both the total number of required staff and the distribution across the day.

### 2.6 What “full coverage” means

“Full coverage” does not mean every possible shift is filled to a maximum. In this system, it means the unit has enough staff to meet the required minimum staffing thresholds for each day and time block while staying within normal assignment rules.

A good full coverage schedule has:

- minimum required staff for each shift window
- valid distribution across day, evening, and night
- no unsafe overuse of one nurse or one shift pattern
- required leave and time-off requests respected
- realistic hour balancing and rest constraints respected

In other words, full coverage is not a raw headcount target. It is a safe operational minimum with acceptable variance and fairness.

A schedule is usually considered healthy when:

- daily minimums are met
- time-of-day coverage is balanced
- no one is being pushed beyond reasonable limits
- no minimum rest windows are violated
- staffing team and role rules are still respected

---

## 3. How the algorithm works

The scheduler logic is rule-based and iterative, not purely random.

### 3.1 Inputs it uses

The scheduler reads:

- shift codes and their time / hours metadata
- existing assignments already in the schedule
- leave and off requests
- nurse profile data such as role, team, seniority, and availability
- staffing requirements for each date and shift category
- organization configuration such as staffing teams and weekend rotation settings

### 3.2 Priority order

The logic typically follows this order:

1. Preserve existing valid assignments whenever possible
2. Respect approved time off and leave requests
3. Meet minimum day / evening / night coverage
4. Honor role, staffing team, and staffing constraints
5. Balance hours and avoid over-assignment
6. Keep coverage realistic and operationally safe

This means the system prefers preserving a known-good plan before making changes to fill gaps.

### 3.3 Coverage logic

For each day, the scheduler compares the current assignments to the minimum staffing requirements for that date.

If short on coverage, it looks for eligible nurses who:

- are not already over their target hours
- are not blocked by time-off rules
- are available for that shift type
- fit role and seniority constraints
- help maintain balance across the schedule

The scheduler may also evaluate whether an assignment helps maintain a healthy D/E/N spread across the daily timeline.

### 3.4 Role and team logic

The algorithm uses staffing role and staffing team information to avoid unrealistic assignments.

Examples:

- assistant managers may be excluded from some fill-in patterns if the unit wants them to stay in leadership coverage
- staffing teams may be used for weekend coverage rotation or operational grouping
- coverage balancing may prefer not to overload a single team or a single seniority band

### 3.5 Weekend rotation logic

If the organization enables alternating weekend assignment by staffing team, the scheduler may rotate weekend coverage between configured teams.

This helps:

- spread weekend burden more fairly
- avoid overloading the same team every weekend
- keep staffing patterns predictable

### 3.6 Validation

After assignment, the scheduler validates:

- minimum coverage met
- staffing rules not broken
- off requests respected
- rest limits respected
- shift code compatibility maintained

If the generated schedule fails validation, the scheduler rebalances until it resolves the issue or flags a problem.

---

## 4. Scheduling features and how to use them

### 4.1 Shift code management

Use this feature to define and maintain the shift codes the unit uses.

Typical steps:

1. Open the shift code settings or admin configuration area.
2. Review the list of active codes.
3. Add, edit, or remove a code if the unit's shift model changes.
4. Update start time, end time, hours, and shift type when needed.
5. Keep the codes aligned with actual staffing operations.

Best practice:

- avoid adding custom codes that do not match actual unit work patterns
- keep shift names consistent across the schedule and the scheduler rules
- ensure each code maps to one clear staffing category

### 4.2 Nurses and staffing profiles

The nurse profile is where staff details are tracked.

Use it to maintain:

- name and employee record if applicable
- staffing role
- staffing team
- seniority or experience value
- employment type or hour target information
- leave or availability notes

Typical use cases:

- assign a nurse to a staffing team
- mark a nurse as an assistant manager if needed
- update skill or coverage metadata
- keep the profile aligned with the current operating model

### 4.3 Staffing teams

Use staffing teams to group nurses into coverage groups.

Typical workflow:

1. Open settings or org configuration.
2. Review the staffing team list.
3. Add or rename teams if needed.
4. Map assistant managers to the relevant team if your workflow requires it.
5. Continue using the same team names consistently across all schedules.

This keeps staffing organization simple and predictable.

### 4.4 Schedule editor

The schedule editor is where daily and weekly coverage gets built or adjusted.

Typical workflow:

1. Open the schedule for the date range you need.
2. Review the current assignments.
3. Check minimum coverage by day and shift block.
4. Fix gaps where staffing is short.
5. Preserve valid current assignments if they already meet rule requirements.
6. Save or regenerate the schedule when needed.

The scheduler can usually make large corrective changes, but human review remains important.

### 4.5 Time off and leave handling

Leave requests should always be treated as protected planning inputs.

Examples of time-off inputs:

- leave / vacation requests
- holiday blocks
- absence notes tied to a date
- explicit off codes or leave flags

The scheduler will generally:

- honor approved off requests
- avoid assigning a nurse to work that day
- carry the time-off constraint into the optimization process

### 4.6 Settings and organizational configuration

The system uses org settings to shape scheduling behavior.

Examples of configuration areas:

- staffing team options
- default staffing team labels
- assistant manager mapping
- weekend rotation toggle
- shift rules and staffing system settings

When changing these, make sure the change reflects the actual operational policy, not just a temporary preference.

### 4.7 Handover / handoff workflow

Handover features exist to make operational continuity easier across shifts.

Use them to:

- communicate overnight or shift-level notes
- summarize patient or operational context
- reduce missed communication between teams

This part of the system is operational support, not scheduling logic.

---

## 5. Good schedule quality checklist

A schedule is usually considered strong when all of the following are true:

- minimum daily coverage is met
- day / evening / night spread is balanced
- no avoidable rule violations exist
- time-off requests are respected
- staffing teams are used consistently
- assistant manager leadership coverage remains intact
- weekend rotation is fair and intentional
- hours are reasonably distributed across the staff group

### Quick rule of thumb

A “good full coverage” schedule is one where:

- coverage is safe,
- the unit can operate without emergency rework,
- rules are respected,
- staffing is equitable,
- and the plan remains readable and operationally credible.

---

## 6. Operational guidance for daily use

### Before generating a schedule

- confirm the staffing team setup is correct
- confirm the role hierarchy is still accurate
- verify the active shift codes match the unit's actual patterns
- check approved leave and off requests
- review the date range and staffing requirements

### During schedule review

- review coverage by day and shift block
- check for odd clustering of assignments in one team or one time period
- validate that off requests were respected
- confirm the schedule remains realistic for staff workloads

### After the schedule is generated

- review any gaps or emergency overrides
- verify schedule consistency with policy
- correct edge cases manually if needed
- keep the format and terminology aligned with the organization settings

---

## 7. Common terminology

- Shift code: actual schedule assignment such as `07`, `23`, `Z07`
- Time slot: planning category like Day / Evening / Night
- Staffing team: operational grouping used for coverage and weekend rotation
- Staffing role: schedule-relevant role such as `nurse` or `assistant_manager`
- Full coverage: meeting minimum staffing requirements without breaking constraints
- Coverage minimum: the lowest required safe staffing target for the schedule period
- Leave / off request: approved time away from work that the scheduler must respect

---

## 8. Recommended operating principles

- Keep shift code names aligned with actual unit practice.
- Keep staffing teams stable and understandable.
- Respect leave requests before optimizing around them.
- Treat minimum coverage as a floor, not a misleading target.
- Use manual review for exceptions and edge cases.
- Do not add personal or sensitive employee details into notes or docs.

---

## 9. Useful contacts and references in this repo

This repository already contains the operational building blocks for these concepts:

- shift code definition and setup in `backend/app/api/routes/shift_codes.py`
- nurse role and staffing logic in `backend/app/api/routes/nurse.py`
- staffing team and organization configuration in `backend/app/models/organization.py`
- scheduling logic in `backend/app/api/routes/optimized_schedule.py`
- frontend scheduler UI in `frontend/src/app/scheduler/`

Use the corresponding code and UI pages for the most up-to-date implementation details for your specific setup.

---

## 10. Welcome note for future maintainers

This project is best managed by keeping operational language simple and consistent. The system does not need a long list of hidden assumptions. It needs clear shift definitions, clear staffing roles, clear coverage expectations, and a disciplined review process.

If a schedule looks operationally plausible, respects leave requests, and meets minimum coverage without violating staffing rules, it is usually a good schedule.
