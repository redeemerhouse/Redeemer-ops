---
name: Resident lifecycle boundaries
description: Durable separation of intake stages, resident status, housing assignments, temporary absences, alumni follow-up, and reapplication.
---

Application stages and resident lifecycle are separate state machines. Resident state is
limited to `pending`, `active`, `exited`, and `discharged`; placement, temporary absence,
alumni follow-up, and reapplication are related dated records rather than extra states.
State and placement changes append evidence and update projections transactionally instead
of overwriting history through generic edits.

**Why:** Collapsing intake, occupancy, absence, and alumni coordination into mutable status
or house fields loses transition evidence, permits contradictory occupancy, and increases
duplicate-person risk on re-entry.

**How to apply:** Keep generic profile edits away from lifecycle/placement fields. Use
closed server-enforced transitions, preserve application-to-resident/reapplication links,
and baseline unknown legacy history explicitly without inventing dates or reasons.