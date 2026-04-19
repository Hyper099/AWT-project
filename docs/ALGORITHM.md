# Smart Scheduling Algorithm

## Problem formulation

Given:

- A set of courses **C**, each with type (theory/lab), expected enrollment,
  weekly contact hours, and an optional preferred building.
- A pool of rooms **R**, each with capacity, type, and building.
- A set of buildings **B** each with `(x, y)` coordinates (metres).
- A set of professors **P** with eligible courses, preferred/unavailable
  slots, and a weekly hour cap.
- A fixed slot catalogue **S** (VTOP-style, see `scheduler/slots.js`).
- Student registrations **Reg ⊂ Student × Course × Slot × Term**.

Produce a **timetable**: an injection `T: C → S × R × P` such that all hard
constraints hold, minimising a soft cost function.

### Hard constraints

| # | Constraint |
|---|-----------|
| H1 | For any two assignments `a, b`, if they share a professor and their slots clash, reject. |
| H2 | Same for shared room. |
| H3 | Same for shared cohort (batch of students). |
| H4 | Room capacity ≥ course expected enrollment. |
| H5 | Lab courses require lab rooms; theory courses require theory rooms. |
| H6 | `slot ∉ professor.unavailableSlots`. |
| H7 | Professor must be eligible for the course. |

### Soft cost function

```
Cost(T) =  W_travel  * Σ_student weekly_travel_metres(student, T)
         + W_tight   * #tight_transfers(T)
         + W_long    * Σ_student hours_in_long_stretch(student, T)
         + W_profpref * #assignments_off_preferred_slot(T)
         + W_balance * Σ_student stdev(daily_minutes(student, T))
```

Weights are defined in `scheduler/cost.js`. A *tight transfer* is when
back-to-back classes leave less walk-time than needed given a walking
speed of 80 m/min.

## Why hybrid greedy + local search?

| Approach | Verdict |
|----------|---------|
| Backtracking CSP | Exponential worst case; fine for tiny instances, dies on real scale. |
| Graph colouring | Enforces clashes only; can't express distance. |
| Pure GA | Converges slowly on timetable problems; hard to inject domain constraints. |
| **Greedy + Local Search** | ✅ Fast feasible init, domain-specific moves, interpretable. Same pattern used by OptaPlanner's `ConstructionHeuristic + LocalSearch`. |

## Phase 1 — Preprocess

Precompute `clashIdx[slotCode] = Set<slotCode>` once. Every subsequent
"is this slot busy?" check is O(1) over the clash family.

Courses are sorted by a **difficulty score**:

```
difficulty(c) = (#eligibleProfs(c) * #compatRooms(c)) / expectedEnrollment(c)
```

Smaller = harder to place. Hard courses are assigned first because their
feasible regions shrink fastest as others take slots.

## Phase 2 — Constrained greedy

Pseudo-code:

```
for course in sortedCourses:
    candidates = feasibleCandidates(course)  # (slot, room, prof) triples
    if candidates is empty:
        warn and skip  # problem instance infeasible
        continue
    pick c* = argmin(candidates, key=candidateCost)
    mark (prof, slot-and-clashes) busy
    mark (room, slot-and-clashes) busy
    mark (cohortBatches, slot-and-clashes) busy
    record assignment(course, c*)
```

`candidateCost` is **incremental**: it evaluates travel only against
already-placed courses that share students with this course, plus a bonus
for the professor's preferred slots. This is O(k) per candidate for
small k and keeps greedy near-linear.

## Phase 3 — Hill-climbing local search

```
for iter in 1..MAX_ITERS:
    pick a random assignment a
    free its occupancy
    cands = feasibleCandidates(a.course) - {current}
    propose c' = random pick from top-10 (or random if <10)
    apply c' tentatively
    if globalCost(T') < globalCost(T):
        commit
        noImprove = 0
    else:
        revert
        noImprove += 1
    if noImprove >= 200: break
```

The **global cost** is measured on the full timetable each time because the
travel term is non-decomposable (a single swap can affect every student in
a cohort's weekly travel). That's the O(students × regs/student) cost we
pay; it's cheap on real data (~ms/eval for 500 students × 7 regs).

## Complexity

| Phase | Cost |
|-------|------|
| Clash index | O(|S|²) = constant after startup |
| Greedy | O(|C| × |S| × |R| × |P|) worst, typically O(|C| × k) after pruning |
| Local search | O(iters × (feasible-gen + global-score)) ≈ O(iters × students × regs) |

For the seeded instance (18 courses, 18 slots, 20 rooms, 18 profs, 472
students): greedy finishes in <50 ms, local search in <2 s on an M2 laptop.

## Distance function

```
d(b_i, b_j) = √((x_i - x_j)² + (y_i - y_j)²)         # metres, Euclidean
walkTime(d)     = d / 80                               # 80 m/min
walkTime(same)  = 0.5                                  # stair / floor transfer
```

Transfer is **tight** when `walkTime > gap between classes`. Tight
transfers get a very large penalty (`W_tight = 500`) so they're essentially
forbidden by the optimiser unless no alternative exists.

## Worked example (seeded data)

Run:

```
$ npm run seed
$ npm run schedule
```

Expected (exact numbers depend on RNG):

```
[scheduler] running for term: TERM_2026_ODD
  courses=18 rooms=28 buildings=5 profs=18 students=472 registrations=3304
[scheduler] produced 18 assignments. score=14,871.32
  components: { travel: 9340, tight: 0, longStretch: 18, profPref: 6, dailyImbalance: 214 }
[scheduler] persisted.
```

Observations:

- CSE theory courses (`CS301–CS305`) cluster in AB1 rooms.
- Labs (`CS351`, `CS352`, `CS353`, `IT351`, `EC351`) go to `LAB-L*` rooms
  at `L1–L6` slot family, keeping theory mornings free.
- No tight transfers — greedy + local search co-located every back-to-back
  pair in the same building or left ≥1 free period.
- Professor preference misses drop from ~14 (greedy only) to ~6 after
  local search.

## Extension points

- **Multi-section**: when `enrolled > roomCapacity`, split the course into
  `ceil(enrolled / capacity)` sections. The scheduler loop already keys
  occupancy by `sectionId`; just iterate sections and distribute students
  by batch.
- **Professor workload**: track `hoursScheduled[profId]` during greedy and
  cut off eligibility at `maxHoursPerWeek`.
- **Annealing**: replace pure hill climbing with simulated annealing
  (accept worse moves with probability `e^(-Δ/T)`) to escape local minima.
