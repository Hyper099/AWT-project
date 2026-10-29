import Semester from '../models/Semester.js';
import Student from '../models/Student.js';
import { DEFAULT_TERM_ID } from '../constants/term.js';

/**
 * A student belongs to one batch per term (23BCP students were in Semester 5
 * last year and are in Semester 7 now). These helpers give the student as
 * they were in a given term: batchId, semester, division and group from that
 * term's enrolment.
 */

export function inTerm(student, termId) {
  if (!student) return null;
  const e = (student.enrolments || []).find((x) => x.termId === termId);
  if (!e) return null;
  return { ...student, batchId: e.batchId, semester: e.semester, division: e.division, group: e.group, termId };
}

export async function studentInTerm(studentId, termId) {
  return inTerm(await Student.findOne({ studentId }).lean(), termId);
}

export async function studentsInTerm(termId, { semester = null, batchId = null } = {}) {
  const docs = await Student.find({ 'enrolments.termId': termId }).lean();
  return docs.map((s) => inTerm(s, termId))
    .filter((s) => (!semester || s.semester === Number(semester)) && (!batchId || s.batchId === batchId));
}

/** The term a semester runs in; an explicit termId wins. */
export async function resolveTerm({ termId = null, semester = null } = {}) {
  if (termId) return termId;
  if (semester) {
    const sem = await Semester.findOne({ semester: Number(semester) }).lean();
    if (sem?.termId) return sem.termId;
  }
  return DEFAULT_TERM_ID;
}
