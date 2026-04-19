#!/usr/bin/env python3
"""
Populate data/csv/ from data/xlsx/ plus deterministic mock data.

Outputs (under data/csv/):
  - departments.csv             (deduplicated)
  - buildings.csv               (from Building.xlsx)
  - rooms.csv                   (from Rooms.xlsx)
  - courses.csv                 (from courses_data.xlsx)
  - professors.csv              (from prof_data.xlsx)
  - time_slots.csv              (generated slot catalog)
  - course_offerings.csv        (term × course × batch)
  - professor_course_eligibility.csv
  - professor_capacity_rules.csv
  - professor_availability.csv
  - student_course_selections.csv   (edge-case mix)

Preserves (does not overwrite): students.csv, student_credentials.csv, batches.csv,
terms.csv, building_distances.csv.

Designed to cover these edge cases:
  * some students with zero selections (pending)
  * some students with partial selections
  * some students fully selected
  * some professors fully booked (seat exhausted)
  * courses with multiple eligible professors
  * 1-, 2-, 3-credit theory + 1-credit lab covering slot-family mapping
"""
from __future__ import annotations

import csv
import os
import random
import sys
from collections import defaultdict
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("Install openpyxl first: pip install openpyxl", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent
CSV = ROOT / "data" / "csv"
XLSX = ROOT / "data" / "xlsx"
TERM = "TERM_2026_ODD"
RNG = random.Random(42)  # deterministic demo mode

# ------------------------------ Helpers ------------------------------

def load_xlsx(name: str) -> list[dict]:
    wb = openpyxl.load_workbook(XLSX / name, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() for h in rows[0] if h is not None]
    out = []
    for r in rows[1:]:
        if r is None or not any(c is not None for c in r):
            continue
        d = {header[i]: r[i] for i in range(min(len(header), len(r)))}
        out.append(d)
    return out

def write_csv(path: Path, header: list[str], rows: list[list]):
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"  wrote {path.relative_to(ROOT)} · {len(rows)} rows")

def load_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))

# ------------------------------ Clean departments.csv ------------------------------

def dedupe_departments():
    src = CSV / "departments.csv"
    rows = load_csv(src)
    seen, out = set(), []
    for r in rows:
        did = r.get("department_id")
        if did in seen:
            continue
        seen.add(did)
        out.append([r.get(k) for k in ["department_id", "department_name", "department_code", "active_status"]])
    write_csv(src, ["department_id", "department_name", "department_code", "active_status"], out)

# ------------------------------ Buildings + Rooms ------------------------------

def write_buildings():
    data = load_xlsx("Building.xlsx")
    rows = [[d["building_id"], d["building_name"], d["campus_name"], d["active_status"]] for d in data]
    write_csv(CSV / "buildings.csv",
              ["building_id", "building_name", "campus_name", "active_status"], rows)

def write_rooms():
    data = load_xlsx("Rooms.xlsx")
    rows = []
    for d in data:
        if not d.get("room_id"):
            continue
        rows.append([
            d["room_id"], d["building_id"], d["room_name"],
            int(d.get("capacity") or 0), d.get("room_type") or "lecture",
            int(d.get("floor_number") or 1),
            (d.get("has_projector") or "no"),
            (d.get("has_lab_equipment") or "no"),
            (d.get("is_accessible") or "yes"),
            d.get("active_status") or "active",
        ])
    write_csv(CSV / "rooms.csv", [
        "room_id", "building_id", "room_name", "capacity", "room_type", "floor_number",
        "has_projector", "has_lab_equipment", "is_accessible", "active_status",
    ], rows)

# ------------------------------ Courses + Professors ------------------------------

def _credit_to_slot_family(credits: int, course_type: str) -> str:
    c = int(credits)
    if course_type == "lab":
        return "LAB_1" if c == 1 else "LAB_2"
    if c >= 3:
        return "THEORY_3"
    if c == 2:
        return "THEORY_2"
    return "THEORY_1"

def write_courses():
    data = load_xlsx("courses_data.xlsx")
    rows = []
    for d in data:
        if not d.get("course_id"):
            continue
        needs_lab = str(d.get("needs_lab") or "").strip().lower() == "yes"
        credits = int(float(d.get("credits") or 0))
        course_type = "lab" if needs_lab else "theory"
        family = _credit_to_slot_family(credits, course_type)
        dept = d.get("department_id") or "CSE"
        rows.append([
            d["course_id"], d.get("course_code") or d["course_id"], d["course_title"],
            dept, (d.get("course_type") or "Core"),
            credits, int(float(d.get("weekly_hours") or credits or 1)),
            "yes" if needs_lab else "no",
            d.get("room_type_required") or ("Lab" if needs_lab else "Lecture"),
            course_type, family,
            int(int(credits) * 30) if needs_lab else 60,  # expected_enrollment default
            d.get("active_status") or "active",
        ])
    write_csv(CSV / "courses.csv", [
        "course_id", "course_code", "course_title", "department_id", "course_type_category",
        "credits", "weekly_hours", "needs_lab", "room_type_required",
        "course_type", "slot_family", "expected_enrollment", "active_status",
    ], rows)

def _course_title_to_id(courses: list[dict]) -> dict:
    m = {}
    for c in courses:
        m[str(c["course_title"]).strip().lower()] = c["course_id"]
    return m

def write_professors_and_eligibility():
    data = load_xlsx("prof_data.xlsx")
    courses = load_csv(CSV / "courses.csv")
    title_to_id = _course_title_to_id(courses)

    prof_rows = []
    elig_rows = []
    cap_rows = []

    for d in data:
        if not d.get("professor_id"):
            continue
        pid = d["professor_id"]
        prof_rows.append([
            pid, d.get("professor_code") or "", d.get("professor_name") or pid,
            d.get("department_id") or "CSE", d.get("designation") or "",
            int(float(d.get("max_weekly_load") or 12)), d.get("active_status") or "active",
        ])
        # Eligibility: from course1/course2 — map title to course_id. Also add lab variants.
        titles = [d.get("course1"), d.get("course2")]
        eligible_ids = []
        for t in titles:
            if not t or str(t).strip() in ("-", ""):
                continue
            cid = title_to_id.get(str(t).strip().lower())
            if cid:
                eligible_ids.append(cid)
                # Also make eligible for that course's lab variant (same title + " Lab")
                lab_id = title_to_id.get(str(t).strip().lower() + " lab")
                if lab_id:
                    eligible_ids.append(lab_id)
        for i, cid in enumerate(eligible_ids):
            elig_rows.append([pid, cid, i + 1, "senior", "yes"])

    # Backfill: if a course has no eligible prof (electives, industry-4.0,
    # etc.) assign 3 rotating backup professors. Concentrating fallback on
    # just P9/P13 previously caused slot-collision starvation when several
    # uncovered courses were offered in overlapping slots.
    import hashlib
    covered_courses = {r[1] for r in elig_rows}
    uncovered = [c for c in courses if c["course_id"] not in covered_courses]
    all_prof_ids = [p[0] for p in prof_rows]
    for c in uncovered:
        h = int(hashlib.md5(c["course_id"].encode()).hexdigest()[:8], 16)
        picks = []
        for i in range(5):
            pid = all_prof_ids[(h + i * 7) % len(all_prof_ids)]
            if pid not in picks:
                picks.append(pid)
        for pid in picks:
            elig_rows.append([pid, c["course_id"], 1, "junior", "no"])

    # Capacity rules: per (prof, course) max_students. Sized so that demand
    # (sum of batch strengths offering the course) is fully covered with a
    # ~15% slack — the Allocate-all flow can finish, yet some instructors
    # still saturate naturally for the admin "Full" status demo.
    import csv as _csv
    batches_by_id = {r["batch_id"]: int(r["strength"]) for r in _csv.DictReader(open(CSV / "batches.csv"))}
    offered_to = defaultdict(list)
    for o in _csv.DictReader(open(CSV / "course_offerings.csv")):
        offered_to[o["course_id"]].append(o["batch_id"])
    demand_by_course = {
        cid: sum(batches_by_id.get(b, 0) for b in bids)
        for cid, bids in offered_to.items()
    }
    profs_per_course = defaultdict(int)
    for pid, cid, *_ in elig_rows:
        profs_per_course[cid] += 1

    # Lab rooms max out around 40 seats in Rooms.xlsx, so lab sections are
    # hard-capped at 35 (comfortable fit). Theory caps scale with demand so
    # allocate-all can always finish.
    import math
    course_is_lab = {c["course_id"]: (str(c["needs_lab"]).strip().lower() == "yes") for c in courses}
    def per_prof_cap(cid):
        if course_is_lab.get(cid):
            return 35
        demand = demand_by_course.get(cid, 0)
        profs = max(1, profs_per_course.get(cid, 1))
        return max(40, math.ceil(demand * 1.15 / profs))

    # Ensure total seats (num eligible profs × per-prof cap) ≥ demand for
    # every course. For labs especially this means adding more fallback profs
    # so all 337 Big-Data-Lab students can be split across enough sections.
    for c in courses:
        cid = c["course_id"]
        demand = demand_by_course.get(cid, 0)
        if demand == 0:
            continue
        cap = per_prof_cap(cid)
        current_profs = [r[0] for r in elig_rows if r[1] == cid]
        total_seats = len(current_profs) * cap
        h = int(hashlib.md5(cid.encode()).hexdigest()[:8], 16)
        i = 0
        while total_seats < demand * 1.1 and i < len(all_prof_ids):
            pid = all_prof_ids[(h + (i + 11) * 7) % len(all_prof_ids)]
            if pid not in current_profs:
                elig_rows.append([pid, cid, 99, "junior", "no"])
                current_profs.append(pid)
                total_seats += cap
            i += 1

    for pid, cid, *_rest in elig_rows:
        cap = per_prof_cap(cid)
        cap_rows.append([pid, cid, cap, 1, cap])

    write_csv(CSV / "professors.csv", [
        "professor_id", "professor_code", "professor_name", "department_id",
        "designation", "max_weekly_load", "active_status",
    ], prof_rows)
    write_csv(CSV / "professor_course_eligibility.csv",
              ["professor_id", "course_id", "priority", "experience_level", "preferred_to_teach"],
              elig_rows)
    write_csv(CSV / "professor_capacity_rules.csv",
              ["professor_id", "course_id", "max_students_per_section", "max_sections", "preferred_section_size"],
              cap_rows)

# ------------------------------ Time slots ------------------------------

def _theory_slot(day, hour):
    return {"day": day, "start_time": f"{hour:02d}:00", "end_time": f"{hour+1:02d}:00"}

def _lab_slot(day, hour, duration=2):
    return {"day": day, "start_time": f"{hour:02d}:00", "end_time": f"{hour+duration:02d}:00"}

def write_time_slots():
    # slot_id, slot_code (same), slot_family, session_index, day_of_week, start_time, end_time
    rows = []

    # THEORY_3: 3 meetings/week. Patterns: MWF @ 9/10/11/14/15/16 and TuTh can't do 3 meetings.
    theory_3 = [
        ("A1", [("MON", 9), ("WED", 9), ("FRI", 9)]),
        ("B1", [("MON", 10), ("WED", 10), ("FRI", 10)]),
        ("C1", [("MON", 11), ("WED", 11), ("FRI", 11)]),
        ("A2", [("MON", 14), ("WED", 14), ("FRI", 14)]),
        ("B2", [("MON", 15), ("WED", 15), ("FRI", 15)]),
        ("C2", [("MON", 16), ("WED", 16), ("FRI", 16)]),
    ]
    # THEORY_2: 2 meetings/week. TuTh patterns.
    theory_2 = [
        ("D1", [("TUE", 9), ("THU", 9)]),
        ("E1", [("TUE", 10), ("THU", 10)]),
        ("F1", [("TUE", 11), ("THU", 11)]),
        ("D2", [("TUE", 14), ("THU", 14)]),
        ("E2", [("TUE", 15), ("THU", 15)]),
        ("F2", [("TUE", 16), ("THU", 16)]),
    ]
    # THEORY_1: 1 meeting/week, 1h.
    theory_1 = [
        ("S1", [("FRI", 12)]),
        ("S2", [("TUE", 12)]),
        ("S3", [("MON", 12)]),
        ("S4", [("WED", 12)]),
        ("S5", [("THU", 12)]),
        ("S6", [("FRI", 17)]),
    ]
    # LAB_2 (4h/week, 2 blocks of 2h) — legacy
    lab_2 = [
        ("L1", [("MON", 14), ("WED", 14)], 2),
        ("L2", [("TUE", 14), ("THU", 14)], 2),
        ("L3", [("MON", 16), ("WED", 16)], 2),
        ("L4", [("TUE", 16), ("THU", 16)], 2),
    ]
    # LAB_1 (2h/week, 1 block) — 1-credit labs
    lab_1 = [
        ("LA", [("MON", 9)], 2),
        ("LB", [("MON", 11)], 2),
        ("LC", [("MON", 14)], 2),
        ("LD", [("MON", 16)], 2),
        ("LE", [("TUE", 9)], 2),
        ("LF", [("TUE", 11)], 2),
        ("LG", [("TUE", 14)], 2),
        ("LH", [("TUE", 16)], 2),
        ("LI", [("WED", 9)], 2),
        ("LJ", [("WED", 11)], 2),
        ("LK", [("WED", 14)], 2),
        ("LL", [("WED", 16)], 2),
        ("LM", [("THU", 9)], 2),
        ("LN", [("THU", 11)], 2),
        ("LO", [("THU", 14)], 2),
        ("LP", [("THU", 16)], 2),
        ("LQ", [("FRI", 9)], 2),
        ("LR", [("FRI", 14)], 2),
    ]

    def emit(code, family, meetings, dur=1):
        for idx, (day, h) in enumerate(meetings):
            rows.append([
                f"{code}_{idx+1}", code, family, idx + 1, day,
                f"{h:02d}:00", f"{h+dur:02d}:00",
            ])

    for code, mt in theory_3: emit(code, "THEORY_3", mt, 1)
    for code, mt in theory_2: emit(code, "THEORY_2", mt, 1)
    for code, mt in theory_1: emit(code, "THEORY_1", mt, 1)
    for code, mt, dur in lab_2: emit(code, "LAB_2", mt, dur)
    for code, mt, dur in lab_1: emit(code, "LAB_1", mt, 2)

    write_csv(CSV / "time_slots.csv", [
        "time_slot_id", "slot_code", "slot_family", "session_index", "day_of_week",
        "start_time", "end_time",
    ], rows)

# ------------------------------ Course offerings ------------------------------

def write_course_offerings():
    """
    For the CSE Sem 5 cohort: all 7 divisions get:
      - 3 core theory (rotate across 6 to spread load): CS001 AI, CS003 Big Data, CS004 Cyber
      - 3 core labs: CS007 AI Lab, CS009 BDA Lab, CS010 Cyber Lab
      - 1 Industry-4.0 (CS023 Mechanical theory) + lab (CS027)
      - 1 open elective chosen per batch
    That yields 8 offerings per batch × 7 batches = 56 course-offering records.
    """
    batches = load_csv(CSV / "batches.csv")
    courses = {c["course_id"]: c for c in load_csv(CSV / "courses.csv")}

    core_theory = ["CS001", "CS003", "CS004", "CS005", "CS006"]      # 3cr theory
    core_labs = ["CS007", "CS009", "CS010", "CS011", "CS012"]        # 1cr labs
    industry_theory = ["CS023", "CS024", "CS025", "CS026"]
    industry_labs = ["CS027", "CS028", "CS029", "CS030"]
    electives = ["CS013", "CS014", "CS015", "CS017", "CS020"]

    rows = []
    offering_ix = 1
    # Deterministic per-batch picks
    for i, b in enumerate(batches):
        bid = b["batch_id"]
        picks = []
        # Pick 3 core theory + 3 core labs — rotated per batch for variety
        picks += [core_theory[j % len(core_theory)] for j in (i, i + 1, i + 2)]
        picks += [core_labs[j % len(core_labs)] for j in (i, i + 1, i + 2)]
        # Industry-4.0 (1 theory, 1 lab)
        picks += [industry_theory[i % len(industry_theory)], industry_labs[i % len(industry_labs)]]
        # Elective
        picks += [electives[i % len(electives)]]
        # Dedupe while preserving order
        seen, clean = set(), []
        for p in picks:
            if p in seen:
                continue
            seen.add(p); clean.append(p)

        for cid in clean:
            course = courses[cid]
            off_id = f"OFF_{TERM}_{bid}_{cid}"
            rows.append([
                off_id, TERM, cid, bid,
                int(course["expected_enrollment"]),
                "yes" if course["course_type_category"].lower().startswith("open") else "no",
                1, 1, course["room_type_required"], "open",
            ])
            offering_ix += 1

    write_csv(CSV / "course_offerings.csv", [
        "course_offering_id", "term_id", "course_id", "batch_id",
        "expected_enrollment", "is_elective", "min_sections", "max_sections",
        "special_room_requirement", "status",
    ], rows)

# ------------------------------ Professor availability ------------------------------

def write_professor_availability():
    profs = load_csv(CSV / "professors.csv")
    rows = []
    # Make ~1/3 of profs express preferences, 1/5 mark one unavailable slot.
    slot_codes = ["A1", "B1", "C1", "D1", "E1", "F1", "A2", "B2", "C2", "D2", "E2", "F2"]
    for i, p in enumerate(profs):
        pid = p["professor_id"]
        if i % 3 == 0:
            rows.append([pid, TERM, RNG.choice(slot_codes), "preferred"])
        if i % 5 == 0:
            rows.append([pid, TERM, RNG.choice(slot_codes), "unavailable"])
    write_csv(CSV / "professor_availability.csv",
              ["professor_id", "term_id", "slot_code", "availability_type"], rows)

# ------------------------------ Student selections (edge cases) ------------------------------

def write_student_selections():
    """
    Distribute selection state across cohorts to exercise every edge case:
      · Div-1: EVERY student has FULLY selected all 8 offerings  (ready for scheduling)
      · Div-2: HALF the students fully, HALF partial (3 of 8)     (partial)
      · Div-3: HALF partial (5 of 8), HALF none                   (partial + none)
      · Div-4: ALL students have ZERO selections                   (pending cohort)
      · Div-5: fully for the first 20, none for rest               (mix)
      · Div-6: partial (4 of 8) for all                            (cohort-wide partial)
      · Div-7: fully for all, but we'll exhaust one professor's
                seats on Cyber Security (P6) by pinning many
                students to them first — demonstrates seat full
    Professor picks rotate round-robin through eligible list per course.
    """
    students = load_csv(CSV / "students.csv")
    offerings = load_csv(CSV / "course_offerings.csv")
    elig = load_csv(CSV / "professor_course_eligibility.csv")
    caps = load_csv(CSV / "professor_capacity_rules.csv")

    offerings_by_batch = defaultdict(list)
    for o in offerings:
        offerings_by_batch[o["batch_id"]].append(o)

    elig_by_course = defaultdict(list)
    for e in elig:
        elig_by_course[e["course_id"]].append(e["professor_id"])

    # Per-course per-prof capacity (seat limit)
    cap_by = {}
    for r in caps:
        cap_by[(r["professor_id"], r["course_id"])] = int(r["max_students_per_section"])

    # Track remaining seats per (prof, course) as we assign.
    remaining = dict(cap_by)

    def pick_prof(course_id, preferred_prof=None):
        prof_ids = elig_by_course.get(course_id, [])
        if preferred_prof and remaining.get((preferred_prof, course_id), 0) > 0:
            remaining[(preferred_prof, course_id)] -= 1
            return preferred_prof
        for pid in prof_ids:
            key = (pid, course_id)
            if remaining.get(key, 0) > 0:
                remaining[key] -= 1
                return pid
        return None  # all seats booked

    from datetime import datetime, timedelta
    base_ts = datetime(2026, 4, 15, 9, 0)
    selection_rows = []
    ts = 0

    def selection_row(student_id, off, prof_id):
        nonlocal ts
        ts += 1
        stamp = (base_ts + timedelta(seconds=ts * 37)).isoformat()
        selection_rows.append([
            student_id, TERM, off["course_offering_id"], off["course_id"],
            prof_id or "", "student_choice", 1, stamp,
        ])

    # Per-batch ordering by student id for determinism
    by_batch = defaultdict(list)
    for s in students:
        by_batch[s["batch_id"]].append(s)
    for b in by_batch:
        by_batch[b].sort(key=lambda s: s["student_id"])

    # Div-1: fully selected
    div1 = "CSE_2023_SEM5_DIV1"
    for s in by_batch.get(div1, []):
        for off in offerings_by_batch.get(div1, []):
            pid = pick_prof(off["course_id"])
            selection_row(s["student_id"], off, pid)

    # Div-2: half fully, half partial (3 of 8)
    div2 = "CSE_2023_SEM5_DIV2"
    sel2 = by_batch.get(div2, [])
    half = len(sel2) // 2
    for s in sel2[:half]:
        for off in offerings_by_batch.get(div2, []):
            pid = pick_prof(off["course_id"])
            selection_row(s["student_id"], off, pid)
    for s in sel2[half:]:
        for off in offerings_by_batch.get(div2, [])[:3]:
            pid = pick_prof(off["course_id"])
            selection_row(s["student_id"], off, pid)

    # Div-3: half partial (5 of 8), half none
    div3 = "CSE_2023_SEM5_DIV3"
    sel3 = by_batch.get(div3, [])
    half = len(sel3) // 2
    for s in sel3[:half]:
        for off in offerings_by_batch.get(div3, [])[:5]:
            pid = pick_prof(off["course_id"])
            selection_row(s["student_id"], off, pid)
    # second half: zero selections

    # Div-4: zero selections (cohort pending)

    # Div-5: first 20 fully, rest none
    div5 = "CSE_2023_SEM5_DIV5"
    for s in by_batch.get(div5, [])[:20]:
        for off in offerings_by_batch.get(div5, []):
            pid = pick_prof(off["course_id"])
            selection_row(s["student_id"], off, pid)

    # Div-6: partial (4 of 8) for all
    div6 = "CSE_2023_SEM5_DIV6"
    for s in by_batch.get(div6, []):
        for off in offerings_by_batch.get(div6, [])[:4]:
            pid = pick_prof(off["course_id"])
            selection_row(s["student_id"], off, pid)

    # Div-7: full for all, with forced seat exhaustion on Cyber Security (P6).
    # Cyber Security theory is CS004 in batch offerings depending on rotation.
    # To ensure seat exhaustion, preferentially hammer P6 on any Cyber Security offering.
    div7 = "CSE_2023_SEM5_DIV7"
    for s in by_batch.get(div7, []):
        for off in offerings_by_batch.get(div7, []):
            preferred = "P6" if off["course_id"] == "CS004" else None
            pid = pick_prof(off["course_id"], preferred_prof=preferred)
            selection_row(s["student_id"], off, pid)

    write_csv(CSV / "student_course_selections.csv", [
        "student_id", "term_id", "course_offering_id", "course_id",
        "professor_id", "selection_type", "priority_rank", "submission_timestamp",
    ], selection_rows)

    # Report seat status to stdout
    exhausted = [(k, cap_by[k]) for k, v in remaining.items() if v == 0]
    print(f"  [selections] total rows={len(selection_rows)} profs with any exhausted course={len({k[0] for k in exhausted})}")

# ------------------------------ Main ------------------------------

def main():
    print("Generating missing data ...")
    dedupe_departments()
    write_buildings()
    write_rooms()
    write_courses()
    write_professors_and_eligibility()
    write_time_slots()
    write_course_offerings()
    write_professor_availability()
    write_student_selections()
    print("Done.")

if __name__ == "__main__":
    main()
