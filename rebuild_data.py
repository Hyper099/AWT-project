#!/usr/bin/env python3
"""
Rebuild the core planning CSVs from the academic rules in todo3.md.

Rules (semester 5 CSE):
  - Compulsory: CS001 Artificial Intelligence (3 cr), CS002 AWT (1 cr)
  - Core electives (pick exactly 2): CS003 BDA, CS004 Cyber Security,
    CS005 Cryptography, CS006 Cloud Computing. Valid pairs:
        BDA+Cloud, Cyber+Cloud, Cyber+Crypto, BDA+Crypto.
  - Open electives (pick exactly 1): CS013..CS022.
  - Labs (paired with their theory course, 1 cr each):
        CS001→CS007, CS002→CS008, CS003→CS009, CS004→CS010,
        CS005→CS011, CS006→CS012.
  - Every student gets: 2 compulsory theory + 2 compulsory labs
    + 2 core-elective theory + 2 core-elective labs + 1 open elective = 9 courses.

This script only knows semester 5 and rewrites the files below whole; run
import_semester_timetable.py afterwards to restore the semester 7 rows.

Produces:
  - data/csv/course_offerings.csv
  - data/csv/professor_capacity_rules.csv
  - data/csv/student_course_selections.csv

Inputs (read but not modified):
  - data/csv/students.csv
  - data/csv/courses.csv
  - data/csv/batches.csv
  - data/csv/professors.csv
  - data/csv/professor_course_eligibility.csv
"""
from __future__ import annotations
import csv
import math
import os
import random
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_DIR = os.path.join(ROOT, "data", "csv")
TERM_ID = "TERM_2026_ODD"
random.seed(42)

# ---------- Course groups ----------
COMP_THEORY = ["CS001", "CS002"]           # AI, AWT
COMP_LAB = ["CS007", "CS008"]              # AI lab, AWT lab
CORE_THEORY = ["CS003", "CS004", "CS005", "CS006"]  # BDA, Cyber, Crypto, Cloud
CORE_LAB_FOR = {"CS003": "CS009", "CS004": "CS010", "CS005": "CS011", "CS006": "CS012"}
# Valid elective pairs (order-invariant)
VALID_PAIRS = [
    ("CS003", "CS006"),  # BDA + Cloud
    ("CS004", "CS006"),  # Cyber + Cloud
    ("CS004", "CS005"),  # Cyber + Crypto
    ("CS003", "CS005"),  # BDA + Crypto
]
OPEN_ELECTIVES = [f"CS{str(i).zfill(3)}" for i in range(13, 23)]  # CS013..CS022


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path, headers, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def load_slots(path):
    by_family = defaultdict(list)
    rows = read_csv(path)
    seen = set()
    for r in rows:
        code = r["slot_code"]
        fam = r["slot_family"]
        if code in seen:
            continue
        seen.add(code)
        by_family[fam].append(code)
    return by_family


def load_slot_meetings(path):
    """slot_code -> [(day, start_minute, end_minute)] for overlap checks."""
    meetings = defaultdict(list)
    for r in read_csv(path):
        h1, m1 = map(int, r["start_time"].split(":"))
        h2, m2 = map(int, r["end_time"].split(":"))
        meetings[r["slot_code"]].append((r["day_of_week"], h1 * 60 + m1, h2 * 60 + m2))
    return meetings


def slots_overlap(meetings, a, b):
    """Two slots clash if any of their meetings overlap on the same day.
    Comparing slot codes alone misses clashes such as C1 (Wed 11-12) and LJ (Wed 11-13)."""
    if a == b:
        return True
    return any(d1 == d2 and s1 < e2 and s2 < e1
               for d1, s1, e1 in meetings[a] for d2, s2, e2 in meetings[b])


def main():
    students = read_csv(os.path.join(CSV_DIR, "students.csv"))
    courses = read_csv(os.path.join(CSV_DIR, "courses.csv"))
    batches = read_csv(os.path.join(CSV_DIR, "batches.csv"))
    profs = read_csv(os.path.join(CSV_DIR, "professors.csv"))
    elig = read_csv(os.path.join(CSV_DIR, "professor_course_eligibility.csv"))
    slots_by_family = load_slots(os.path.join(CSV_DIR, "time_slots.csv"))
    slot_meetings = load_slot_meetings(os.path.join(CSV_DIR, "time_slots.csv"))
    rooms = read_csv(os.path.join(CSV_DIR, "rooms.csv"))
    max_lab_room = max(int(r["capacity"]) for r in rooms if r["room_type"] == "lab")

    courses_by_id = {c["course_id"]: c for c in courses}
    students_by_batch = defaultdict(list)
    for s in students:
        students_by_batch[s["batch_id"]].append(s)

    # -------- Eligibility pool per course --------
    eligible_profs = defaultdict(list)
    for e in elig:
        eligible_profs[e["course_id"]].append(e["professor_id"])
    all_profs = [p["professor_id"] for p in profs]

    def ensure_pool(course_id, min_count):
        """Guarantee at least `min_count` eligible profs; append more if needed."""
        existing = set(eligible_profs[course_id])
        i = 0
        while len(existing) < min_count and i < len(all_profs):
            pid = all_profs[(i * 7) % len(all_profs)]
            if pid not in existing:
                existing.add(pid)
                eligible_profs[course_id].append(pid)
            i += 1

    # Ensure plenty of profs for high-demand courses. Compulsory theory + lab
    # needs 12+ profs (≈40/section × 12 = 480 seats). Core electives need 4+.
    for c in COMP_THEORY + COMP_LAB:
        ensure_pool(c, 12)
    for c in CORE_THEORY:
        ensure_pool(c, 6)
    for c in CORE_LAB_FOR.values():
        ensure_pool(c, 6)
    for c in OPEN_ELECTIVES:
        ensure_pool(c, 3)

    # -------- Assign per-batch programme --------
    # Per batch: 2 compulsory theory + 2 compulsory labs + 1 chosen pair (2
    # theory + 2 labs) + 1 open elective. Rotate pair and open elective across
    # batches.
    batch_programme = {}
    for idx, b in enumerate(batches):
        pair = VALID_PAIRS[idx % len(VALID_PAIRS)]  # 2 core electives
        oe = OPEN_ELECTIVES[idx % len(OPEN_ELECTIVES)]
        theory = list(COMP_THEORY) + list(pair) + [oe]
        labs = list(COMP_LAB) + [CORE_LAB_FOR[c] for c in pair]
        batch_programme[b["batch_id"]] = {
            "theory": theory,
            "labs": labs,
            "all": theory + labs,  # 9 courses per student
        }

    # -------- course_offerings.csv --------
    offerings_rows = []
    for b in batches:
        prog = batch_programme[b["batch_id"]]
        strength = int(b["strength"])
        for cid in prog["all"]:
            course = courses_by_id[cid]
            is_lab = course["course_type"] == "lab"
            offerings_rows.append({
                "course_offering_id": f"OFF_{TERM_ID}_{b['batch_id']}_{cid}",
                "term_id": TERM_ID,
                "course_id": cid,
                "batch_id": b["batch_id"],
                "expected_enrollment": strength if not is_lab else strength,
                "is_elective": "yes" if cid in OPEN_ELECTIVES else "no",
                "min_sections": 1,
                "max_sections": 4 if not is_lab else 4,
                "special_room_requirement": "Lab" if is_lab else "Lecture",
                "status": "open",
            })

    # -------- Demand per course (sum of batch strengths) --------
    demand = Counter()
    for b in batches:
        prog = batch_programme[b["batch_id"]]
        for cid in prog["all"]:
            demand[cid] += int(b["strength"])

    # -------- professor_capacity_rules.csv --------
    # For each course, size caps so sum(caps) ≥ demand × 1.20. Split equally
    # across eligible profs with per-prof floor of 40 for theory, 30 for lab.
    cap_rows = []
    for cid in set(sum((prog["all"] for prog in batch_programme.values()), [])):
        course = courses_by_id[cid]
        is_lab = course["course_type"] == "lab"
        pool = eligible_profs[cid]
        if not pool:
            continue
        d = demand[cid]
        target_total = math.ceil(d * 1.20)
        min_per_prof = 30 if is_lab else 40
        per_prof = max(min_per_prof, math.ceil(target_total / len(pool)))
        # Cap per-prof so small-demand courses don't balloon
        if is_lab:
            # A lab section must fit in one lab room.
            per_prof = min(per_prof, max_lab_room)
        else:
            per_prof = min(per_prof, max(60, math.ceil(d / 2)))
        # Add extra profs if pool too small
        while per_prof * len(pool) < target_total:
            # add more eligible profs
            for p in all_profs:
                if p not in pool:
                    pool.append(p)
                    break
            else:
                break
            if per_prof * len(pool) >= target_total:
                break
        for pid in pool:
            cap_rows.append({
                "professor_id": pid,
                "course_id": cid,
                "max_students_per_section": per_prof,
                "max_sections": 1,
                "preferred_section_size": per_prof,
            })

    # -------- student_course_selections.csv --------
    # Each (batch, course) is split into sections of ≤ cap students. A section
    # is ONE (slot, prof) pair; every student in that section shares both.
    # To ensure the phase-2 scheduler sees distinct sections, we guarantee that
    # across batches sharing a course, (slot, prof) pairs are unique.
    cap_by_course = defaultdict(list)
    cap_lookup = {}
    for c in cap_rows:
        cap_by_course[c["course_id"]].append(c["professor_id"])
        cap_lookup[(c["professor_id"], c["course_id"])] = int(c["max_students_per_section"])

    # Track global seats-used so we don't oversubscribe a prof across batches.
    used = Counter()
    # Track (slot, prof) commitments per course — an assignment of a prof to a
    # slot for one course blocks that prof for any other course at the same slot.
    prof_slot_course = {}  # (pid, slot_code) -> course_id

    def prof_busy(pid, slot_code, cid):
        """Instructor already teaches a different section at an overlapping time."""
        return any(p2 == pid and (s2, c2) != (slot_code, cid)
                   and slots_overlap(slot_meetings, s2, slot_code)
                   for (p2, s2), c2 in prof_slot_course.items())
    # Track (slot, prof) uses per course so we don't duplicate.
    section_keys = set()   # {(course, slot, pid)}

    selections_rows = []
    ts_counter = 0

    # Iterate batches in order — students within a batch share slots for each course.
    for b in batches:
        prog = batch_programme[b["batch_id"]]
        batch_students = students_by_batch[b["batch_id"]]
        n = len(batch_students)
        # Slots already used BY THIS BATCH (so batch-level clashes are avoided).
        batch_slots_used = []
        # We assign courses in a deterministic order, picking slot+prof jointly.
        for cid in prog["all"]:
            pool = cap_by_course[cid][:]
            if not pool:
                continue
            course = courses_by_id[cid]
            fam = course["slot_family"] or "THEORY_3"
            slot_pool = slots_by_family.get(fam, [])
            if not slot_pool:
                continue
            per_prof_cap = min(int(cap_lookup[(p, cid)]) for p in pool)
            num_sections = max(1, math.ceil(n / per_prof_cap))
            sec_size = math.ceil(n / num_sections)

            # All sections for this (batch, course) share ONE slot (same time,
            # different rooms). We need `num_sections` distinct profs that are
            # (a) free at that slot, (b) not already committed to another course
            # at that slot, (c) have remaining seats.
            chosen = []          # [(slot_code, prof_id)]
            rot_s = (hash(b["batch_id"] + cid + "slot") % len(slot_pool))
            rot_p = (hash(b["batch_id"] + cid + "prof") % len(pool))
            ordered_slots = slot_pool[rot_s:] + slot_pool[:rot_s]
            ordered_profs = pool[rot_p:] + pool[:rot_p]
            for slot_code in ordered_slots:
                if any(slots_overlap(slot_meetings, slot_code, u) for u in batch_slots_used):
                    continue
                attempt = []
                for pid in ordered_profs:
                    if len(attempt) >= num_sections:
                        break
                    if prof_busy(pid, slot_code, cid):
                        continue
                    if (cid, slot_code, pid) in section_keys:
                        continue
                    cap = int(cap_lookup[(pid, cid)])
                    if used[(pid, cid)] + sec_size > cap:
                        continue
                    attempt.append(pid)
                if len(attempt) >= num_sections:
                    chosen = [(slot_code, pid) for pid in attempt]
                    break
            # Fallback: relax the seat-check
            if len(chosen) < num_sections:
                for slot_code in ordered_slots:
                    if any(slots_overlap(slot_meetings, slot_code, u) for u in batch_slots_used):
                        continue
                    attempt = []
                    for pid in ordered_profs:
                        if len(attempt) >= num_sections:
                            break
                        if prof_busy(pid, slot_code, cid):
                            continue
                        if (cid, slot_code, pid) in section_keys:
                            continue
                        attempt.append(pid)
                    if len(attempt) >= num_sections:
                        chosen = [(slot_code, pid) for pid in attempt]
                        break
            # Ultimate fallback so we always have at least 1 section
            if not chosen:
                slot_code = next((s for s in ordered_slots
                                  if not any(slots_overlap(slot_meetings, s, u) for u in batch_slots_used)),
                                 ordered_slots[0])
                chosen = [(slot_code, ordered_profs[0])]

            # Commit slot and (slot, prof) occupancy
            picked_slot = chosen[0][0]
            batch_slots_used.append(picked_slot)
            for slot_code, pid in chosen:
                prof_slot_course[(pid, slot_code)] = cid
                section_keys.add((cid, slot_code, pid))

            # Split batch students into sections
            for i, s in enumerate(batch_students):
                sec_idx = min(i // sec_size, len(chosen) - 1)
                slot_code, pid = chosen[sec_idx]
                used[(pid, cid)] += 1
                ts_counter += 1
                selections_rows.append({
                    "student_id": s["student_id"],
                    "term_id": TERM_ID,
                    "course_offering_id": f"OFF_{TERM_ID}_{b['batch_id']}_{cid}",
                    "course_id": cid,
                    "professor_id": pid,
                    "slot_code": slot_code,
                    "selection_type": "student_choice",
                    "priority_rank": 1,
                    "submission_timestamp": f"2026-04-15T{(9 + (ts_counter // 3600) % 8):02d}:"
                                             f"{(ts_counter // 60) % 60:02d}:"
                                             f"{ts_counter % 60:02d}",
                })

    # -------- Write out --------
    write_csv(
        os.path.join(CSV_DIR, "course_offerings.csv"),
        ["course_offering_id", "term_id", "course_id", "batch_id", "expected_enrollment",
         "is_elective", "min_sections", "max_sections", "special_room_requirement", "status"],
        offerings_rows,
    )
    write_csv(
        os.path.join(CSV_DIR, "professor_capacity_rules.csv"),
        ["professor_id", "course_id", "max_students_per_section", "max_sections",
         "preferred_section_size"],
        cap_rows,
    )
    write_csv(
        os.path.join(CSV_DIR, "student_course_selections.csv"),
        ["student_id", "term_id", "course_offering_id", "course_id", "professor_id",
         "slot_code", "selection_type", "priority_rank", "submission_timestamp"],
        selections_rows,
    )

    # -------- Also refresh professor_course_eligibility.csv to reflect
    # the expanded pools so seed-time eligible-courses per prof stay in sync.
    elig_rows = []
    seen = set()
    for cid, plist in eligible_profs.items():
        for pid in plist:
            if (pid, cid) in seen:
                continue
            seen.add((pid, cid))
            elig_rows.append({
                "professor_id": pid,
                "course_id": cid,
                "eligibility_type": "primary",
                "max_sections": 1,
            })
    write_csv(
        os.path.join(CSV_DIR, "professor_course_eligibility.csv"),
        ["professor_id", "course_id", "eligibility_type", "max_sections"],
        elig_rows,
    )

    # -------- Summary --------
    print(f"students: {len(students)}")
    print(f"batches: {len(batches)}")
    print(f"offerings: {len(offerings_rows)}")
    print(f"capacity rules: {len(cap_rows)}")
    print(f"selections: {len(selections_rows)}")
    print()
    print("Demand per course:")
    for cid in sorted(demand, key=lambda c: -demand[c]):
        sum_cap = sum(int(cap_lookup[(p, cid)]) for p in cap_by_course[cid])
        n = len(cap_by_course[cid])
        margin = sum_cap / max(demand[cid], 1)
        print(f"  {cid} ({courses_by_id[cid]['course_title'][:30]:30}) "
              f"demand={demand[cid]:3d} seats={sum_cap:4d} ({n:2d} profs × ~"
              f"{int(cap_lookup[(cap_by_course[cid][0], cid)])}) "
              f"margin={margin:.2f}×")


if __name__ == "__main__":
    main()
