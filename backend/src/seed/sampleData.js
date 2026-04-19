// Sample/assumed data for entities not populated in the provided CSVs.
// ASSUMPTIONS (documented):
//   - 5 academic buildings laid out on a rough campus grid (metres).
//   - 24 classrooms across buildings; 8 lab rooms.
//   - ~20 courses spanning CSE/ICT/ECE sem 5; mixed theory/lab.
//   - 18 professors, each eligible for 2-4 courses.
//   - Lab courses require lab rooms. Theory courses fit 60-90 students.

export const BUILDINGS = [
  { buildingId: 'AB1', name: 'Academic Block 1', x: 0, y: 0 },
  { buildingId: 'AB2', name: 'Academic Block 2', x: 180, y: 20 },
  { buildingId: 'AB3', name: 'Academic Block 3', x: 60, y: 220 },
  { buildingId: 'LAB', name: 'Lab Complex', x: 300, y: 140 },
  { buildingId: 'LIB', name: 'Library & Seminar Hall', x: 120, y: 120 },
];

function makeRooms() {
  const rooms = [];
  // Theory rooms: 6 per AB, 2 per AB3, 2 in LIB
  const theoryPlan = [
    ['AB1', 6], ['AB2', 6], ['AB3', 4], ['LIB', 2],
  ];
  let idx = 1;
  for (const [b, count] of theoryPlan) {
    for (let i = 1; i <= count; i++) {
      const capacity = [60, 72, 90, 120][i % 4];
      rooms.push({ roomId: `${b}-${100 + i}`, name: `${b}-${100 + i}`, buildingId: b, floor: Math.ceil(i / 3), capacity, type: 'theory' });
      idx++;
    }
  }
  // Lab rooms
  for (let i = 1; i <= 8; i++) {
    rooms.push({ roomId: `LAB-L${i}`, name: `LAB-L${i}`, buildingId: 'LAB', floor: Math.ceil(i / 4), capacity: 36, type: 'lab' });
  }
  return rooms;
}
export const ROOMS = makeRooms();

export const COURSES = [
  { courseId: 'CS301', code: 'CS301', title: 'Operating Systems', department: 'CSE', credits: 4, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 72, preferredBuilding: 'AB1' },
  { courseId: 'CS302', code: 'CS302', title: 'Computer Networks', department: 'CSE', credits: 4, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 72, preferredBuilding: 'AB1' },
  { courseId: 'CS303', code: 'CS303', title: 'Database Systems', department: 'CSE', credits: 4, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 72, preferredBuilding: 'AB1' },
  { courseId: 'CS304', code: 'CS304', title: 'Theory of Computation', department: 'CSE', credits: 3, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 72, preferredBuilding: 'AB1' },
  { courseId: 'CS305', code: 'CS305', title: 'Software Engineering', department: 'CSE', credits: 3, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 72, preferredBuilding: 'AB1' },
  { courseId: 'CS351', code: 'CS351', title: 'OS Lab', department: 'CSE', credits: 2, weeklyHours: 4, type: 'lab', semester: 5, expectedEnrollment: 36, requiresLabRoom: true, preferredBuilding: 'LAB' },
  { courseId: 'CS352', code: 'CS352', title: 'Networks Lab', department: 'CSE', credits: 2, weeklyHours: 4, type: 'lab', semester: 5, expectedEnrollment: 36, requiresLabRoom: true, preferredBuilding: 'LAB' },
  { courseId: 'CS353', code: 'CS353', title: 'DBMS Lab', department: 'CSE', credits: 2, weeklyHours: 4, type: 'lab', semester: 5, expectedEnrollment: 36, requiresLabRoom: true, preferredBuilding: 'LAB' },
  { courseId: 'IT301', code: 'IT301', title: 'Information Security', department: 'ICT', credits: 3, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 60, preferredBuilding: 'AB2' },
  { courseId: 'IT302', code: 'IT302', title: 'Web Technologies', department: 'ICT', credits: 3, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 60, preferredBuilding: 'AB2' },
  { courseId: 'IT351', code: 'IT351', title: 'Web Tech Lab', department: 'ICT', credits: 2, weeklyHours: 4, type: 'lab', semester: 5, expectedEnrollment: 30, requiresLabRoom: true, preferredBuilding: 'LAB' },
  { courseId: 'EC301', code: 'EC301', title: 'Digital Signal Processing', department: 'ECE', credits: 4, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 60, preferredBuilding: 'AB2' },
  { courseId: 'EC302', code: 'EC302', title: 'Microprocessors', department: 'ECE', credits: 4, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 60, preferredBuilding: 'AB2' },
  { courseId: 'EC351', code: 'EC351', title: 'Microproc Lab', department: 'ECE', credits: 2, weeklyHours: 4, type: 'lab', semester: 5, expectedEnrollment: 30, requiresLabRoom: true, preferredBuilding: 'LAB' },
  { courseId: 'HU301', code: 'HU301', title: 'Engineering Economics', department: 'HU', credits: 2, weeklyHours: 2, type: 'theory', semester: 5, expectedEnrollment: 90, isElective: true, preferredBuilding: 'LIB' },
  { courseId: 'HU302', code: 'HU302', title: 'Technical Communication', department: 'HU', credits: 2, weeklyHours: 2, type: 'theory', semester: 5, expectedEnrollment: 90, isElective: true, preferredBuilding: 'LIB' },
  { courseId: 'MA301', code: 'MA301', title: 'Applied Probability', department: 'MA', credits: 3, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 90, preferredBuilding: 'AB3' },
  { courseId: 'MA302', code: 'MA302', title: 'Discrete Math', department: 'MA', credits: 3, weeklyHours: 3, type: 'theory', semester: 5, expectedEnrollment: 90, preferredBuilding: 'AB3' },
];

export const PROFESSORS = [
  { professorId: 'P01', name: 'Dr. Anjali Rao', department: 'CSE', eligibleCourses: ['CS301', 'CS304', 'CS351'], preferredSlots: ['A1', 'B1'], unavailableSlots: ['C2'], homeBuilding: 'AB1' },
  { professorId: 'P02', name: 'Dr. Rohit Mehta', department: 'CSE', eligibleCourses: ['CS302', 'CS352'], preferredSlots: ['C1', 'D1'], unavailableSlots: [], homeBuilding: 'AB1' },
  { professorId: 'P03', name: 'Dr. Neha Iyer', department: 'CSE', eligibleCourses: ['CS303', 'CS353', 'CS305'], preferredSlots: ['E1', 'F1'], unavailableSlots: ['A1'], homeBuilding: 'AB1' },
  { professorId: 'P04', name: 'Dr. Vikram Shah', department: 'CSE', eligibleCourses: ['CS304', 'CS305', 'MA302'], preferredSlots: ['B1', 'E1'], unavailableSlots: [], homeBuilding: 'AB1' },
  { professorId: 'P05', name: 'Dr. Farida Khan', department: 'CSE', eligibleCourses: ['CS351', 'CS352', 'CS353'], preferredSlots: ['L1', 'L2'], unavailableSlots: [], homeBuilding: 'LAB' },
  { professorId: 'P06', name: 'Dr. Priya Menon', department: 'ICT', eligibleCourses: ['IT301', 'IT302', 'IT351'], preferredSlots: ['A1', 'D1'], unavailableSlots: [], homeBuilding: 'AB2' },
  { professorId: 'P07', name: 'Dr. Sahil Kapoor', department: 'ICT', eligibleCourses: ['IT301', 'IT302'], preferredSlots: ['B1', 'E1'], unavailableSlots: [], homeBuilding: 'AB2' },
  { professorId: 'P08', name: 'Dr. Rina Das', department: 'ICT', eligibleCourses: ['IT351'], preferredSlots: ['L3', 'L4'], unavailableSlots: [], homeBuilding: 'LAB' },
  { professorId: 'P09', name: 'Dr. Arjun Bose', department: 'ECE', eligibleCourses: ['EC301', 'EC302'], preferredSlots: ['C1', 'F1'], unavailableSlots: [], homeBuilding: 'AB2' },
  { professorId: 'P10', name: 'Dr. Kavita Nair', department: 'ECE', eligibleCourses: ['EC301', 'EC302', 'EC351'], preferredSlots: ['A1', 'L2'], unavailableSlots: [], homeBuilding: 'AB2' },
  { professorId: 'P11', name: 'Dr. Mihir Dutta', department: 'ECE', eligibleCourses: ['EC351'], preferredSlots: ['L4', 'L6'], unavailableSlots: [], homeBuilding: 'LAB' },
  { professorId: 'P12', name: 'Dr. Meera Joshi', department: 'HU', eligibleCourses: ['HU301', 'HU302'], preferredSlots: ['D2', 'E2'], unavailableSlots: [], homeBuilding: 'LIB' },
  { professorId: 'P13', name: 'Dr. Aniket Gupta', department: 'HU', eligibleCourses: ['HU301', 'HU302'], preferredSlots: ['A2', 'B2'], unavailableSlots: [], homeBuilding: 'LIB' },
  { professorId: 'P14', name: 'Dr. Tara Singh', department: 'MA', eligibleCourses: ['MA301', 'MA302'], preferredSlots: ['C2', 'F2'], unavailableSlots: [], homeBuilding: 'AB3' },
  { professorId: 'P15', name: 'Dr. Karan Patel', department: 'MA', eligibleCourses: ['MA301', 'MA302'], preferredSlots: ['A2', 'D2'], unavailableSlots: [], homeBuilding: 'AB3' },
  { professorId: 'P16', name: 'Dr. Leena Verma', department: 'CSE', eligibleCourses: ['CS301', 'CS302', 'CS303'], preferredSlots: ['D1', 'F1'], unavailableSlots: [], homeBuilding: 'AB1' },
  { professorId: 'P17', name: 'Dr. Ravi Bhat', department: 'CSE', eligibleCourses: ['CS304', 'MA301'], preferredSlots: ['B1', 'C1'], unavailableSlots: [], homeBuilding: 'AB1' },
  { professorId: 'P18', name: 'Dr. Swati Pillai', department: 'ICT', eligibleCourses: ['IT301', 'IT351'], preferredSlots: ['E1', 'L3'], unavailableSlots: [], homeBuilding: 'AB2' },
];

/** Generate plausible registrations: each batch registers all its dept's core courses + 1 elective. */
export function generateRegistrations(students) {
  const termId = 'TERM_2026_ODD';
  const regs = [];
  const coreByDept = {
    CSE: ['CS301', 'CS302', 'CS303', 'CS304', 'CS351', 'CS352'],
    ICT: ['IT301', 'IT302', 'IT351', 'MA301'],
    ECE: ['EC301', 'EC302', 'EC351', 'MA301'],
    Biotech: ['HU301', 'MA301'],
  };
  const electives = ['HU301', 'HU302'];

  // Placeholder slotCodes; the scheduler's output ultimately determines the section slot.
  // We assign a deterministic provisional slotCode so registrations compile; when the
  // scheduler runs it overwrites TimetableEntry, and we sync registrations to match.
  const slotByCourse = {
    CS301: 'A1', CS302: 'B1', CS303: 'C1', CS304: 'D1', CS305: 'E1',
    CS351: 'L1', CS352: 'L2', CS353: 'L3',
    IT301: 'A1', IT302: 'B1', IT351: 'L2',
    EC301: 'D1', EC302: 'E1', EC351: 'L4',
    HU301: 'A2', HU302: 'B2',
    MA301: 'F1', MA302: 'F2',
  };

  for (const s of students) {
    const dept = s.department;
    const core = coreByDept[dept] || coreByDept.CSE;
    const elective = electives[parseInt(s.studentId.replace(/\D/g, ''), 10) % electives.length];
    const courseIds = [...core, elective];
    for (const cid of courseIds) {
      regs.push({ studentId: s.studentId, courseId: cid, slotCode: slotByCourse[cid] || 'A1', termId });
    }
  }
  return regs;
}
