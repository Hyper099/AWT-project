# Campus Timetable & Course Registration

A clean, institution-managed timetable system: students pick courses on a weekly grid, an admin runs a scheduler that assigns rooms/instructors, students get emailed, and everyone sees the final allotment. Monochrome UI, minimal friction.

Split into two apps:

- `frontend/` — React + Vite client
- `backend/` — Express + MongoDB API
- `data/` — CSV / XLSX source files used for seeding

Each app manages its own dependencies. There is no shared npm workspace at the `vtop-system` root.

## Structure

```text
vtop-system/
├── backend/        # Express API + scheduler + email + export
├── frontend/       # React + Vite client
├── data/           # CSVs used by the seeder
└── docs/           # Algorithm notes
```

## Architecture

- Frontend on `http://localhost:5173`
- Backend on `http://localhost:5050` (Frontend proxies `/api` to this)
- MongoDB database name: `vtop_system`

## Run locally

Prerequisites: Node.js 20+, MongoDB running locally.

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run seed
npm run dev
```

Optional scripts:

- `npm run schedule` — run the scheduler from the CLI
- `npm start` — production-style start

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Semesters

The odd term runs two semester cohorts side by side. They share rooms and
faculty, so the scheduler works across both.

| | Semester 5 | Semester 7 |
|---|---|---|
| Source | `todos/todo3.md` rules | `B.Tech_CE_2023_Sem 7_Div_5.xlsx` (published timetable) |
| Cohort | 7 divisions, 472 students (`23BCP…`) | Div-5 (G9, G10), 64 sample students (`22BCP601`–`22BCP664`) |
| Bell schedule | on the hour, 09:00–18:00, lunch 13:00 | the sheet's periods: 09:00, 10:00, 11:10, 12:10, 13:10, 14:10, 15:10, 16:15, 17:15 |
| Slots | `A1`…`LR`, any slot of the course's family | `7T1`–`7T7`, `7L1`–`7L6`, each course at its fixed time |
| Programme | 9 courses assigned per division (17 credits) | ML + IoT with labs, and one option from each of three elective baskets (14 credits) |

Semester 7 is imported from the spreadsheet:

```bash
pip install openpyxl
python import_semester_timetable.py "B.Tech_CE_2023_Sem 7_Div_5.xlsx"
```

The importer reads the header, periods, timetable cells, faculty and subject tables and writes
`semesters.csv`, `semester_periods.csv`, and the semester's rows in `time_slots.csv`, `courses.csv`,
`course_offerings.csv`, `professors.csv`, instructor eligibility/capacity and `rooms.csv`. Elective
baskets come from courses that run in parallel plus the sheet's "LUNCH BREAK for X Students" notes.
What the sheet lacks is generated as sample data and listed at the top of the script: students and
logins, their elective choices, seat limits, credits (weekly lectures; 1 per lab) and lab length (two
periods). The 08:00 minor column is not imported. Re-running it replaces the semester's rows.

Semester 5 selections were rebuilt around Semester 7's fixed times, because seven instructors teach
in both semesters:

```bash
npm --prefix backend run seed
node backend/src/scripts/allocate-all.js --semester 5
node backend/src/scripts/export-selections.js --semester 5
npm --prefix backend run audit     # programmes complete, no clashes, every section gets a room
```

## User flows

### Student (single-page portal)

Login with `23bcp001` / `ts@23bcp001` (Semester 5) or `22bcp601` / `ts@22bcp601` (Semester 7). Everything — profile, registration, timetable preview, and the final allotment — lives on one page (`/student`). The grid uses the student's own semester's periods and slots.

- Click an **available** slot in the weekly grid to add a course.
- **Selected** cells show courses you have registered. Click to drop.
- **Conflict** cells are hatched and disabled.
- Semester 7: courses run only in their sheet slots, and choosing one option in an elective basket hides the others until it is dropped.
- After the admin runs the scheduler, the grid switches to **allotted** mode: each cell shows the room, building, and instructor. A **Download** button appears for PDF / CSV export.

### Instructor

Login with `p1` / `welcome@P1`, or `p12` / `welcome@P12` for an instructor who teaches in both semesters. The `/instructor` page shows eligible courses, slot preferences (preferred + unavailable), and the instructor's allotted teaching timetable once the admin runs the scheduler, with one tab per semester.

### Admin

Login with `admin` / `admin@123`. The `/admin` page lists the semesters running this term; selecting one scopes the status, **Make Slots**, **Publish Timetable** and the resets to it. Publishing:

1. Assigns rooms and buildings to every section in scope (other semesters' published rooms and instructors are treated as busy).
2. Persists the result to `timetableentries`, replacing only that semester's entries.
3. **Sends an email** to every student in scope whose timetable is complete.

The dashboard reports assigned sections, total cost, and email send counts.

## Email notifications

The scheduler triggers `services/notifyStudents.js` after each run. Transport selection:

- **Dev / unconfigured**: emails are logged to the server console (no external SMTP call). You'll see `[mail:dev]` lines in the backend log after running the scheduler.
- **Production**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and optionally `SMTP_SECURE`, `MAIL_FROM`, `APP_URL`) in `backend/.env` to use real SMTP via nodemailer.

## Timetable download

Students with an allotted timetable can export it in two formats. The API endpoints (auth required):

- `GET /api/student/timetable/download?format=pdf` — A4 PDF via pdfkit
- `GET /api/student/timetable/download?format=csv` — plain CSV

Both include: student name, student ID, term, and per-meeting rows with day, start/end, course code + title, slot, room, building, and instructor.

Additional new endpoints:

- `GET /api/student/timetable/status` — `{ allotted, termId, totalRegistered, totalScheduled }`

## Default accounts

- Student (Semester 5): `23bcp001` / `ts@23bcp001`
- Student (Semester 7): `22bcp601` / `ts@22bcp601`
- Instructor: `p1` / `welcome@P1` (Semester 5), `p12` / `welcome@P12` (Semesters 5 and 7)
- Admin: `admin` / `admin@123`

## API for semesters

- `GET /api/semesters`, `GET /api/semesters/:n` — semesters with periods, batches and slots
- `GET /api/courses/slots?semester=N` — one semester's slots
- `GET /api/student/grid` — the student's semester periods and slots
- `GET /api/student/programme` — core courses, elective baskets, progress and credits
- `GET /api/professor/semesters` — semesters the instructor teaches in
- `GET /api/admin/semesters` — per-semester registration and timetable summary
- `semester` is accepted by `POST /api/admin/allot-slots`, `/admin/reset-selections`, `/admin/reset-allocation`, `/admin/allocate-all` and `/api/scheduler/generate-timetable`

## Tests and CI

`npm --prefix backend test` runs the suites against a separate `vtop_system_test` database,
including HTTP tests that log in as a student of each semester, an instructor and the admin.
`.github/workflows/ci.yml` runs the tests, a seed + audit of the full data set, and the frontend
build on every push and pull request, with MongoDB as a service container.

## Notes

- Slot catalog: `backend/src/scheduler/slots.js`
- Seed / sample data: `backend/src/seed/sampleData.js`
- Scheduling algorithm details: `docs/ALGORITHM.md`
- The role string on the backend is still `professor` for backwards compatibility; the UI surfaces it as **Instructor**.
