
## Plan: Refine Planning for Data, Selection, and Allocation

Turn the current informal todo list into a clear implementation plan with separate tracks for data preparation, course-selection UX, admin allocation controls, operational reset scripts, validation, and timetable presentation. The main goal is to make the system demonstrable end-to-end: data is sourced from CSV/XLSX, students choose courses and professors under seat constraints, admins can allocate/reset/re-run flows, and the final timetable can be allotted, emailed, and downloaded.

**Steps**

1. Normalize source data first. Audit data/csv and data/xlsx, identify missing or inconsistent fields, and decide which datasets are canonical for seeding. Fill missing CSVs from XLSX where possible and generate mock-only data only where the spreadsheet source is incomplete.
2. Refactor seed loading to be file-driven. The seed pipeline should read students, batches, terms, courses, professors, buildings, rooms, offerings, selections, and professor availability from files instead of hardcoded sample arrays. Keep fallback mock generation limited and explicit.
3. Define the missing domain model for course selection. Add planning for explicit course offering records, professor seat counts, batch scope, term scope, and a rule for how professor capacity is decremented when students select a course. This should be written as a data contract before implementation starts.
4. Add capacity-aware professor choice to student registration. When a student opens a slot modal, show the available courses for that slot first, then switch the modal into a two-column chooser with course details on the left and eligible professors plus remaining seats on the right. Prevent selecting a professor whose remaining seats are already exhausted.
5. Expand student portal visibility. Under the student name, show a list of courses offered in the active term with clear state labels such as selected and allotted, so students can see what is pending versus finalized.
6. Add admin allocation controls. In the admin dashboard, add semester and batch filters plus a primary Allot Slots action that runs the allocation algorithm for the selected cohort. The result should include assignment counts and progress metrics.
7. Add admin status reporting. Show visual and numeric summaries for students who have not finished course selection, who missed the selection deadline, professors who are fully allocated and can no longer be selected, and records that are partially complete or invalid.
8. Define operational scripts for resets and demos. Provide three explicit scripts: one to remove selected courses for a single student or all students, one to de-allocate everything and restart from a clean state, and one to allocate courses for every student in bulk. Also define whether these scripts are CLI-only or can later be exposed in the admin UI.
9. Separate the allocation pipeline into two phases. First allocate course slots/professor choices for students according to course load, credits, and professor availability. Then, after all students finish selection, run the final scheduler to assign rooms/buildings and persist the timetable.
10. Add hard credit-to-slot compatibility constraints in slot generation and allocation planning. Define slot families by weekly meeting pattern and map allowed credit/course types to each family. Example planning rule: a 3-credit theory course must map to a 3-meeting pattern family (for example MON+TUE+FRI style family), while a 1-credit lab must map to a single-opening lab-compatible family.
11. Add room near-fit objective in scheduling planning. For each course section, prefer the smallest feasible classroom/lab capacity that still satisfies enrollment (for example 30 students should prefer a room near 30 over a 60-seat room), while still balancing travel and clash constraints.
12. Add travel-distance input dependency planning. Introduce a building distance matrix CSV that references buildings from `buildings.xlsx`; this matrix is user-maintained and used by the scheduler objective once distances are provided.
13. Explicitly load and use `data/csv/building_distances.csv` in the scheduling JavaScript flow (for example in `algorithm.js` via a shared loader utility) so travel-aware scoring comes from CSV data instead of hardcoded or inferred distance.
14. Preserve download and notification behavior. After the final scheduler run, the student portal should show the allotted timetable and allow download, and the backend should send the completion email that timetable allocation is successful.
15. Flip the timetable grid orientation where needed. Render days on rows and times on columns wherever the requirement calls for the inverted view, while keeping the data model unchanged.
16. Add validation and rollback planning. Define how to handle invalid CSV rows, missing XLSX sheets, duplicate student records, professor over-allocation, failed scheduler runs, and recovery after a partial reset.
17. Add test and verification planning. Reserve time for seed verification, registration flow checks, admin allocation checks, reset-script checks, and export/download sanity checks so the plan does not stop at feature intent.
18. Add data lifecycle planning. Define when a term moves from planning to registration-open to selection-closed to allotment-complete, and which scripts or admin actions are allowed in each phase.
19. Add cohort-level reporting rules. The admin view should be able to explain, for a selected semester/batch, which students still need to choose, which selections are invalid, and which professors are fully booked.
20. Add explicit recovery paths. If allocation partially succeeds, the plan should require a reset/rollback path that can safely clear only the affected term or cohort without destroying unrelated data.
21. Add deterministic demo mode. Keep a repeatable demo configuration so seed, selection, reset, and allocate scripts can produce the same showcase state every time.

**Relevant files**

- todo.md — source list to be rewritten into a more precise implementation backlog.
- todo2.md — the refined plan that should stay in sync with the final implementation scope.
- data/xlsx/buildings.xlsx — source of building identifiers used to prepare distance matrix data.
- data/csv/building_distances.csv — planned distance matrix input (`from_building_id`, `to_building_id`, `distance_meters`) to be filled and maintained for travel-aware optimization.
- seed.js — seed entrypoint that should become file-driven.
- generate_missing_data.py — helper to populate missing CSV datasets from source files.
- student.js — student selection, status, and download flow.
- professor.js — professor availability and remaining-seat logic.
- scheduler.js — admin scheduling and final allotment entrypoint.
- algorithm.js — allocation rules for course/professor assignment and final room/building scheduling.
- distance.js or scheduler loader utility — JavaScript layer that reads and validates `data/csv/building_distances.csv` before scoring travel.
- StudentPortal.jsx — student selection UI and allotted timetable view.
- AdminDashboard.jsx — cohort filters, allocation actions, and status dashboards.
- TimetableGrid.jsx — grid orientation and cell rendering.
- notifyStudents.js — email completion notifications.
- timetableExport.js — downloadable timetable formats.

**Verification**

1. Confirm the refined plan covers every item from todo.md and the new todo2.md additions without mixing implementation into planning.
2. Verify all canonical CSVs have rows and that the seed script reads from CSV/XLSX sources rather than hardcoded sample objects.
3. Validate the planned admin and student flows against the current route and page structure to ensure each requested feature has a clear owner.
4. Define test coverage for seed loading, credit-to-slot compatibility constraints, room near-fit objective behavior, allocation rollback, deterministic demo mode, and timetable export so the final implementation can be verified against the plan.
5. Keep the plan limited to planning scope only; no code changes should be introduced while refining this document.

**Decisions**

- Treat CSV/XLSX files as the primary seed source and use mock data only to fill unavoidable gaps.
- Keep backend compatibility and current role model intact while improving professor-facing UX labels to Instructor in the UI.
- Interpret Allot Slots as the cohort-level course/professor allocation step, distinct from the final room/building scheduler run.
- Treat credit-to-slot compatibility as a hard constraint, and room near-fit as an optimization objective constrained by capacity, availability, and clash rules.
- Use the building distance matrix CSV as the planning input for travel-aware scoring, maintained externally and loaded by the scheduler pipeline.
- Maintain the current stack and file layout; the goal is refinement and sequencing, not a rewrite.
- Use deterministic demo mode only for demos and verification, not for production allocation behavior.

**Further Considerations**

1. Should professor seat exhaustion be enforced at course-selection time only, or also during admin allocation? Recommended: both.
2. Should the reset scripts be CLI-only, or also exposed as admin UI actions? Recommended: CLI first, UI later if needed.
3. Should the timetable flip apply only to the student portal view, or also to exports? Recommended: keep exports unchanged unless explicitly requested.
4. Which term states should trigger automatic recovery versus manual admin intervention? Recommended: recovery-needed should block finalization until an admin reruns allocation or restores a backup state.
5. For equal candidate rooms, should the scheduler prioritize lower wasted seats first or lower travel distance first? Recommended: prioritize lower wasted seats within a small tolerance, then break ties by travel distance.
