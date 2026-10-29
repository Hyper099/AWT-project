#!/usr/bin/env python3
"""
Import a published divisional timetable (the PDEU .xlsx export) as a new
semester cohort in the seed CSVs.

    python import_semester_timetable.py "B.Tech_CE_2023_Sem 7_Div_5.xlsx"

What the spreadsheet provides, and what it becomes:
  - Header ("Semester : 7 (5)", "Odd Semester 2026 ...")
        -> semester number, division, term (matched by name in terms.csv)
  - Time row (column headings)          -> semester_periods.csv
  - Timetable cells "G9G10 (20CP406T) F1-302, KASH-L"
        -> time_slots.csv (one slot per distinct weekly meeting pattern),
           course_offerings.csv (allowed_slots = the slots a course meets in)
  - Faculty table                       -> professors.csv (new codes only)
  - Subject table                       -> courses.csv
  - Courses running in parallel, and the "LUNCH BREAK for X Students" notes
        -> elective baskets (choose one option per basket)

What the spreadsheet does not provide, so is generated as sample data:
  - the student list, logins and each student's elective choices
  - per-instructor seat limits
  - credits (taken as weekly lectures for theory, 1 for a lab)
  - lab duration (each lab is taken to run two periods, as the period after
    every lab is empty in the sheet)
  - rooms named in the sheet that are missing from rooms.csv (added as labs
    or lecture rooms depending on what they host)

The minor-course column (08:00) is out of scope and ignored.

Re-running is safe: every row this script owns for the semester is replaced.
"""
from __future__ import annotations

import csv
import os
import random
import re
import sys
from collections import defaultdict

import openpyxl

ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_DIR = os.path.join(ROOT, "data", "csv")
DAYS = {"monday": "MON", "tuesday": "TUE", "wednesday": "WED", "thursday": "THU", "friday": "FRI"}
DAY_ORDER = {d: i for i, d in enumerate(["MON", "TUE", "WED", "THU", "FRI"])}
CELL_RE = re.compile(r"^(G[\dG]+)\s*\(([0-9A-Z]+)\)\s*([^,]+),\s*([A-Z]+)-([LP])$")
LUNCH_RE = re.compile(r"LUNCH BREAK for (.+) Students", re.I)
ROMAN = ["I", "II", "III", "IV", "V", "VI"]

# Sample-data parameters (not in the spreadsheet).
DEPARTMENT = "CSE"
STUDENTS_PER_GROUP = 32
THEORY_SEATS_PER_SECTION = 70
LAB_SEATS_PER_SECTION = 35
NEW_ROOM_CAPACITY = {"lab": 35, "lecture": 60}


# ---------------------------------------------------------------- csv helpers
def read_csv(name):
    path = os.path.join(CSV_DIR, name)
    if not os.path.exists(path):
        return [], []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_csv(name, fields, rows):
    with open(os.path.join(CSV_DIR, name), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def replace_rows(name, keep, new_rows, default_fields=None):
    """Drop rows where keep(row) is False, append new_rows, write back."""
    fields, rows = read_csv(name)
    fields = fields or default_fields
    write_csv(name, fields, [r for r in rows if keep(r)] + new_rows)
    return len(new_rows)


# ------------------------------------------------------------- time parsing
def parse_clock(text, after=None):
    """'9.00', '1.05', '13:10' -> minutes. Hours before 8 are afternoon."""
    m = re.match(r"\s*(\d{1,2})\s*[.:]\s*(\d{1,2})", text)
    h, mi = int(m.group(1)), int(m.group(2))
    if h < 8:
        h += 12
    total = h * 60 + mi
    if after is not None and total <= after:
        total += 12 * 60
    return total


def parse_period(header):
    parts = re.split(r"\s+to\s+", str(header).split("\n")[0].strip(), flags=re.I)
    start = parse_clock(parts[0])
    end = parse_clock(parts[1], after=start)
    return start, end


def hhmm(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def initials(title):
    words = [w for w in re.split(r"[\s\-]+", title) if w and w[0].isalpha() and w.lower() not in {"and", "of", "the"}]
    return "".join(w[0].upper() for w in words)


# ---------------------------------------------------------------- the sheet
def read_sheet(path):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = [[c for c in r] for r in ws.iter_rows(values_only=True)]
    text = lambda v: str(v).strip() if v is not None else ""

    sem_match = next(re.search(r"Semester\s*:\s*(\d+)\s*\((\d+)\)", text(r[0])) for r in rows if "Semester :" in text(r[0]))
    term_name = next(re.match(r"(.+?Semester \d{4})", text(r[0])).group(1) for r in rows if re.match(r".+Semester \d{4}", text(r[0])))
    program = next(text(r[0]) for r in rows if text(r[0]).startswith("B.Tech"))

    header_idx = next(i for i, r in enumerate(rows) if text(r[0]).lower() == "day")
    header = rows[header_idx]
    periods = {}  # column -> (start, end)
    for col, h in enumerate(header[1:], start=1):
        if not h or "minor" in str(h).lower():
            continue
        start, end = parse_period(h)
        if end - start >= 50:  # breaks are 10-15 minutes
            periods[col] = (start, end)
    period_cols = sorted(periods)

    classes, lunch_notes = [], []
    day = None
    for r in rows[header_idx + 1:]:
        first = text(r[0]).lower()
        if first.startswith("faculty"):
            break
        if first in DAYS:
            day = DAYS[first]
        elif first:
            day = None  # Saturday or anything else the system does not schedule
        if day is None:
            continue
        for col in period_cols:
            cell = text(r[col]) if col < len(r) else ""
            if not cell:
                continue
            m = CELL_RE.match(cell)
            if m:
                groups = re.findall(r"G\d+", m.group(1))
                kind = "lab" if m.group(5) == "P" else "theory"
                start, end = periods[col]
                if kind == "lab":  # a lab runs this period and the next one
                    nxt = period_cols[period_cols.index(col) + 1]
                    end = periods[nxt][1]
                classes.append(dict(day=day, start=start, end=end, groups=tuple(groups), code=m.group(2),
                                    room=m.group(3).strip(), faculty=m.group(4), kind=kind))
                continue
            lm = LUNCH_RE.search(cell)
            if lm:
                lunch_notes.append(dict(day=day, start=periods[col][0],
                                        abbrevs=[a.strip() for a in re.split(r"\band\b|,", lm.group(1)) if a.strip()]))

    tbl = next(i for i, r in enumerate(rows) if text(r[0]).lower().startswith("faculty abbr"))
    faculty, subjects = {}, {}
    for r in rows[tbl + 1:]:
        if text(r[0]) and text(r[2]):
            faculty[text(r[0])] = text(r[2])
        if text(r[5]) and text(r[7]):
            subjects[text(r[5])] = text(r[7])
        if not any(text(c) for c in r):
            break
    return dict(semester=int(sem_match.group(1)), division=int(sem_match.group(2)), term_name=term_name,
                program=program, periods=[periods[c] for c in period_cols], classes=classes,
                lunch_notes=lunch_notes, faculty=faculty, subjects=subjects)


# ------------------------------------------------------------- derivations
def build_model(sheet):
    sem = sheet["semester"]
    classes = sheet["classes"]

    # One section = (course, groups, instructor); its meetings form a pattern.
    sections = defaultdict(list)
    for c in classes:
        sections[(c["code"], c["groups"], c["faculty"], c["kind"])].append((c["day"], c["start"], c["end"]))
    for v in sections.values():
        v.sort(key=lambda m: (DAY_ORDER[m[0]], m[1]))

    # A slot per distinct meeting pattern, named in weekly order.
    patterns = sorted({tuple(v) for v in sections.values()}, key=lambda p: (DAY_ORDER[p[0][0]], p[0][1]))
    theory_pat = [p for p in patterns if any(tuple(v) == p and k[3] == "theory" for k, v in sections.items())]
    lab_pat = [p for p in patterns if p not in theory_pat]
    slot_code = {}
    for i, p in enumerate(theory_pat, 1):
        slot_code[p] = f"{sem}T{i}"
    for i, p in enumerate(lab_pat, 1):
        slot_code[p] = f"{sem}L{i}"
    slots = []
    for p, code in slot_code.items():
        lab = code[len(str(sem))] == "L"
        family = f"LAB_{len(p)}" if lab else f"THEORY_{len(p)}"
        slots.append(dict(code=code, family=family, meetings=p))
    slots.sort(key=lambda s: (s["code"][len(str(sem))], int(s["code"][len(str(sem)) + 1:])))

    # Courses.
    course_slots = defaultdict(set)
    course_sections = defaultdict(list)
    for (code, groups, fac, kind), meetings in sections.items():
        course_slots[code].add(slot_code[tuple(meetings)])
        course_sections[code].append(dict(groups=groups, faculty=fac, slot=slot_code[tuple(meetings)], kind=kind))
    kind_of = {code: v[0]["kind"] for code, v in course_sections.items()}
    missing = set(sheet["subjects"]) ^ set(kind_of)
    if missing:
        raise SystemExit(f"subject table and timetable disagree on: {sorted(missing)}")

    # Elective baskets: theory courses that meet at the same time for the
    # same students are alternatives; so are courses linked by a lunch note
    # ("LUNCH BREAK for DF Students" during PR means PR and DF are a choice).
    parent = {c: c for c in kind_of if kind_of[c] == "theory"}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)

    by_slot = defaultdict(list)
    for code, secs in course_sections.items():
        for s in secs:
            if s["kind"] == "theory":
                by_slot[(s["slot"], s["groups"])].append(code)
    for codes in by_slot.values():
        for c in codes[1:]:
            union(codes[0], c)
    abbrev = {}
    for code in parent:
        abbrev[code] = initials(sheet["subjects"][code])
    for note in sheet["lunch_notes"]:
        here = {c["code"] for c in classes if c["day"] == note["day"] and c["start"] == note["start"] and c["kind"] == "theory"}
        for a in note["abbrevs"]:
            named = [c for c, ini in abbrev.items() if ini.startswith(a.upper())]
            if len(named) != 1:
                raise SystemExit(f"lunch note abbreviation {a!r} matches {named}")
            for h in here:
                union(h, named[0])

    clusters = defaultdict(list)
    for code in parent:
        clusters[find(code)].append(code)
    first_meeting = {code: min((DAY_ORDER[m[0]], m[1]) for s in course_sections[code]
                               for m in sections[(code, s["groups"], s["faculty"], s["kind"])]) for code in kind_of}
    baskets = sorted((sorted(v, key=lambda c: first_meeting[c]) for v in clusters.values() if len(v) > 1),
                     key=lambda v: first_meeting[v[0]])
    basket_of = {}
    for i, codes in enumerate(baskets):
        for c in codes:
            basket_of[c] = f"Elective {ROMAN[i]}"
    theory_of = {}
    for code in kind_of:
        if kind_of[code] == "lab":
            twin = code[:-1] + "T"
            if twin not in kind_of:
                raise SystemExit(f"lab {code} has no theory course {twin}")
            theory_of[code] = twin

    return dict(slots=slots, course_slots=course_slots, course_sections=course_sections,
                kind_of=kind_of, baskets=baskets, basket_of=basket_of, theory_of=theory_of,
                meetings_per_week={c: len(sections[(c, s["groups"], s["faculty"], s["kind"])])
                                   for c, v in course_sections.items() for s in v[:1]})


# ------------------------------------------------------------- sample people
FIRST = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Shaurya",
         "Atharv", "Kabir", "Dhruv", "Harsh", "Yash", "Rudra", "Parth", "Om", "Dev", "Jay",
         "Aadhya", "Ananya", "Diya", "Saanvi", "Ira", "Myra", "Kiara", "Riya", "Khushi", "Prisha",
         "Nisha", "Pooja", "Krisha", "Hetvi", "Janvi", "Mahi", "Tanvi", "Shreya", "Isha", "Nidhi"]
LAST = ["Patel", "Shah", "Mehta", "Desai", "Joshi", "Trivedi", "Pandya", "Bhatt", "Parmar", "Chauhan",
        "Modi", "Thakkar", "Raval", "Vyas", "Soni", "Gandhi", "Dave", "Rana", "Solanki", "Jadeja",
        "Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Kulkarni", "Agarwal", "Mishra", "Singh"]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    sheet = read_sheet(sys.argv[1])
    model = build_model(sheet)
    sem, div = sheet["semester"], sheet["division"]

    _, terms = read_csv("terms.csv")
    term = next((t for t in terms if t["term_name"].lower() == sheet["term_name"].lower()), None)
    if not term:
        raise SystemExit(f"term {sheet['term_name']!r} is not in terms.csv")
    term_id = term["term_id"]

    _, batches = read_csv("batches.csv")
    others = [b for b in batches if int(b["semester"]) != sem]
    # Cohorts move up one semester a year, so semester N joined N/2 years
    # before the reference cohort already in the system.
    ref = others[0]
    joined = int(ref["academic_year"]) - (sem - int(ref["semester"])) // 2
    batch_id = f"{DEPARTMENT}_{joined}_SEM{sem}_DIV{div}"
    groups = sorted({g for c in sheet["classes"] for g in c["groups"]}, key=lambda g: int(g[1:]))
    strength = STUDENTS_PER_GROUP * len(groups)
    in_sem = lambda r: str(r.get("semester", "")) == str(sem)

    # ---- semesters and periods
    credits = {}
    for code, kind in model["kind_of"].items():
        credits[code] = 1 if kind == "lab" else model["meetings_per_week"][code]
    core = [c for c in model["kind_of"] if c not in model["basket_of"] and model["theory_of"].get(c, c) not in model["basket_of"]]
    required = sum(credits[c] for c in core)
    for codes in model["baskets"]:
        option_credits = [credits[t] + sum(credits[l] for l, tw in model["theory_of"].items() if tw == t) for t in codes]
        required += min(option_credits)
    replace_rows("semesters.csv", lambda r: not in_sem(r), [dict(
        semester=sem, semester_name=f"Semester {sem}", term_id=term_id, credits_required=required,
        timetable_source=os.path.basename(sys.argv[1]))],
        ["semester", "semester_name", "term_id", "credits_required", "timetable_source"])
    replace_rows("semester_periods.csv", lambda r: not in_sem(r), [
        dict(semester=sem, period_no=i, start_time=hhmm(s), end_time=hhmm(e), kind="class")
        for i, (s, e) in enumerate(sheet["periods"], 1)],
        ["semester", "period_no", "start_time", "end_time", "kind"])

    # ---- slots
    slot_rows = []
    for s in model["slots"]:
        for i, (day, start, end) in enumerate(s["meetings"], 1):
            slot_rows.append(dict(time_slot_id=f"{s['code']}_{i}", slot_code=s["code"], slot_family=s["family"],
                                  session_index=i, day_of_week=day, start_time=hhmm(start), end_time=hhmm(end),
                                  semester=sem))
    replace_rows("time_slots.csv", lambda r: not in_sem(r), slot_rows)

    # ---- professors (append codes the system does not know yet)
    pfields, profs = read_csv("professors.csv")
    by_code = {p["professor_code"]: p["professor_id"] for p in profs}
    next_id = max(int(p["professor_id"][1:]) for p in profs) + 1
    for abbr, name in sheet["faculty"].items():
        if abbr not in by_code:
            profs.append(dict(professor_id=f"P{next_id}", professor_code=abbr, professor_name=name,
                              department_id=DEPARTMENT, designation="Assistant Professor",
                              max_weekly_load=12, active_status="active"))
            by_code[abbr] = f"P{next_id}"
            next_id += 1
    write_csv("professors.csv", pfields, profs)

    # ---- availability: the sheet shows when each instructor does teach, so
    # sample "unavailable" rows overlapping those classes are dropped.
    meetings_of = defaultdict(list)
    for r in slot_rows + [r for r in read_csv("time_slots.csv")[1] if not in_sem(r)]:
        meetings_of[r["slot_code"]].append((r["day_of_week"], parse_clock(r["start_time"]), parse_clock(r["end_time"])))
    teaching = defaultdict(list)
    for c in sheet["classes"]:
        teaching[by_code[c["faculty"]]].append((c["day"], c["start"], c["end"]))
    overlaps = lambda a, b: a[0] == b[0] and a[1] < b[2] and b[1] < a[2]
    afields, avail = read_csv("professor_availability.csv")
    contradicted = [a for a in avail if a["availability_type"] == "unavailable" and any(
        overlaps(m, t) for m in meetings_of.get(a["slot_code"], []) for t in teaching.get(a["professor_id"], []))]
    write_csv("professor_availability.csv", afields, [a for a in avail if a not in contradicted])

    # ---- courses
    _, courses = read_csv("courses.csv")
    kept = [c for c in courses if not in_sem(c)]
    next_course = max(int(c["course_id"][2:]) for c in kept) + 1
    course_id = {}
    for code in sorted(model["kind_of"]):
        course_id[code] = f"CS{next_course:03d}"
        next_course += 1
    course_rows = []
    for code in sorted(model["kind_of"]):
        lab = model["kind_of"][code] == "lab"
        basket = model["basket_of"].get(model["theory_of"].get(code, code))
        course_rows.append(dict(
            course_id=course_id[code], course_code=code, course_title=sheet["subjects"][code],
            department_id=DEPARTMENT, course_type_category="Program Elective" if basket else "Core",
            credits=credits[code], weekly_hours=2 if lab else credits[code], needs_lab="yes" if lab else "no",
            room_type_required="Lab" if lab else "Lecture", course_type="lab" if lab else "theory",
            slot_family=next(s["family"] for s in model["slots"] if s["code"] in model["course_slots"][code]),
            expected_enrollment=strength if not basket else -(-strength // len(next(b for b in model["baskets"] if model["theory_of"].get(code, code) in b))),
            active_status="active", semester=sem))
    replace_rows("courses.csv", lambda r: not in_sem(r), course_rows)
    sem_course_ids = set(course_id.values())

    # ---- offerings
    off_rows = []
    for code in sorted(model["kind_of"]):
        theory = model["theory_of"].get(code, code)
        basket = model["basket_of"].get(theory)
        n_sections = len(model["course_sections"][code])
        off_rows.append(dict(
            course_offering_id=f"OFF_{term_id}_{batch_id}_{course_id[code]}", term_id=term_id,
            course_id=course_id[code], batch_id=batch_id,
            expected_enrollment=next(r["expected_enrollment"] for r in course_rows if r["course_id"] == course_id[code]),
            is_elective="yes" if basket else "no", min_sections=n_sections, max_sections=n_sections,
            special_room_requirement="Lab" if model["kind_of"][code] == "lab" else "Lecture", status="open",
            elective_group=basket or "", elective_option=course_id[theory] if basket else "",
            allowed_slots="|".join(sorted(model["course_slots"][code]))))
    replace_rows("course_offerings.csv", lambda r: r["batch_id"] != batch_id, off_rows)

    # ---- instructor eligibility and seat limits
    elig, caps = [], []
    for code, secs in sorted(model["course_sections"].items()):
        per_prof = defaultdict(set)
        for s in secs:
            per_prof[by_code[s["faculty"]]].add(s["slot"])
        for pid, slots_taught in sorted(per_prof.items()):
            seats = LAB_SEATS_PER_SECTION if model["kind_of"][code] == "lab" else THEORY_SEATS_PER_SECTION
            elig.append(dict(professor_id=pid, course_id=course_id[code], eligibility_type="primary",
                             max_sections=len(slots_taught)))
            caps.append(dict(professor_id=pid, course_id=course_id[code], max_students_per_section=seats,
                             max_sections=len(slots_taught), preferred_section_size=seats))
    replace_rows("professor_course_eligibility.csv", lambda r: r["course_id"] not in sem_course_ids, elig)
    replace_rows("professor_capacity_rules.csv", lambda r: r["course_id"] not in sem_course_ids, caps)

    # ---- rooms named in the sheet that rooms.csv lacks
    rfields, rooms = read_csv("rooms.csv")
    known = {r["room_id"] for r in rooms}
    _, buildings = read_csv("buildings.csv")
    building_ids = {b["building_id"][0]: b["building_id"] for b in buildings}
    for c in sheet["classes"]:
        rid = re.sub(r"^([A-Z])\d?-", r"\1", c["room"])  # F1-302 / F-104 -> F302 / F104
        if rid in known or rid[0] not in building_ids:
            continue
        kind = "lab" if c["kind"] == "lab" else "lecture"
        rooms.append(dict(room_id=rid, building_id=building_ids[rid[0]], room_name=f"SOT {kind.title()} {rid[1:]}",
                          capacity=NEW_ROOM_CAPACITY[kind], room_type=kind, floor_number=rid[1],
                          has_projector="yes", has_lab_equipment="yes" if kind == "lab" else "no",
                          is_accessible="yes", active_status="active"))
        known.add(rid)
    write_csv("rooms.csv", rfields, rooms)

    # ---- batch, students, logins (sample data)
    replace_rows("batches.csv", lambda r: r["batch_id"] != batch_id, [dict(
        batch_id=batch_id, batch_name=f"Computer Sem {sem} Div-{div}", department_id=DEPARTMENT, semester=sem,
        strength=strength, program_name="BTech", section_name=f"Div-{div}", academic_year=joined,
        active_status="active", branch_name="Computer", group_set="|".join(groups))])

    rng = random.Random(f"{batch_id}")
    _, existing = read_csv("students.csv")
    taken = {s["student_id"] for s in existing if s["batch_id"] != batch_id}
    prefix = f"{str(joined)[2:]}BCP"
    students, number = [], 600 + 1
    used_names = set()
    for g in groups:
        for _ in range(STUDENTS_PER_GROUP):
            while f"{prefix}{number:03d}" in taken:
                number += 1
            sid = f"{prefix}{number:03d}"
            number += 1
            while True:
                name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
                if name not in used_names:
                    used_names.add(name)
                    break
            students.append(dict(student_id=sid, student_code=sid, student_name=name, department_id=DEPARTMENT,
                                 batch_id=batch_id, semester=sem, email=f"{sid.lower()}@students.scheduler.local",
                                 status="active", program_name="BTech", year_of_joining=joined,
                                 branch_name="Computer", division_name=f"Div-{div}", group_name=g,
                                 username=sid.lower()))
    replace_rows("students.csv", lambda r: r["batch_id"] != batch_id, students)
    replace_rows("student_credentials.csv", lambda r: r["batch_id"] != batch_id, [dict(
        student_id=s["student_id"], student_name=s["student_name"], batch_id=batch_id,
        division_name=s["division_name"], group_name=s["group_name"], username=s["username"],
        password=f"ts@{s['username']}") for s in students])

    # ---- selections (sample data): core courses in the student's group
    # section, and electives spread evenly across each basket's options.
    sel_rows = []
    group_index = {g: i for i, g in enumerate(groups)}
    for n, s in enumerate(students):
        picks = list(core)
        for b, codes in enumerate(model["baskets"]):
            theory = codes[(n + b) % len(codes)]
            picks += [theory] + [l for l, t in model["theory_of"].items() if t == theory]
        for k, code in enumerate(sorted(picks, key=lambda c: course_id[c])):
            sec = next(x for x in model["course_sections"][code] if s["group_name"] in x["groups"])
            minute = n * len(picks) + k
            sel_rows.append(dict(
                student_id=s["student_id"], term_id=term_id,
                course_offering_id=f"OFF_{term_id}_{batch_id}_{course_id[code]}", course_id=course_id[code],
                professor_id=by_code[sec["faculty"]], slot_code=sec["slot"], selection_type="student_choice",
                priority_rank=1,
                submission_timestamp=f"2026-07-1{group_index[s['group_name']]}T{9 + minute // 3600:02d}:{minute // 60 % 60:02d}:{minute % 60:02d}"))
    sem_students = {s["student_id"] for s in students}
    replace_rows("student_course_selections.csv",
                 lambda r: r["student_id"] not in sem_students and r["course_id"] not in sem_course_ids, sel_rows)

    print(f"semester {sem} division {div} -> term {term_id}, batch {batch_id}")
    print(f"  slots {len(model['slots'])}, courses {len(course_rows)}, baskets "
          + ", ".join(f"{model['basket_of'][c[0]]}: {'/'.join(c)}" for c in model["baskets"]))
    for a in contradicted:
        print(f"  dropped sample availability: {a['professor_id']} unavailable in {a['slot_code']} (teaches then per the sheet)")
    print(f"  students {len(students)} (sample), selections {len(sel_rows)}, credits required {required}")


if __name__ == "__main__":
    main()
