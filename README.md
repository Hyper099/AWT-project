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

## User flows

### Student (single-page portal)

Login with `23bcp001` / `ts@23bcp001`. Everything — profile, registration, timetable preview, and the final allotment — lives on one page (`/student`).

- Click an **available** slot in the weekly grid to add a course.
- **Selected** cells show courses you have registered. Click to drop.
- **Conflict** cells are hatched and disabled.
- After the admin runs the scheduler, the grid switches to **allotted** mode: each cell shows the room, building, and instructor. A **Download** button appears for PDF / CSV export.

### Instructor

Login with `p1` / `welcome@P1`. The `/instructor` page shows eligible courses, slot preferences (preferred + unavailable), and the instructor's allotted teaching timetable once the admin runs the scheduler.

### Admin

Login with `admin` / `admin@123`. The `/admin` page has a single call-to-action: **Run scheduler**. This:

1. Assigns sections, rooms, and instructors via the three-phase scheduling algorithm.
2. Persists the result to `timetableentries`.
3. **Sends an email** to every registered student that their timetable is ready.

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

- Student: `23bcp001` / `ts@23bcp001`
- Instructor: `p1` / `welcome@P1`
- Admin: `admin` / `admin@123`

## Notes

- Slot catalog: `backend/src/scheduler/slots.js`
- Seed / sample data: `backend/src/seed/sampleData.js`
- Scheduling algorithm details: `docs/ALGORITHM.md`
- The role string on the backend is still `professor` for backwards compatibility; the UI surfaces it as **Instructor**.
