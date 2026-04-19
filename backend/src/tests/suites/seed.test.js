import Student from '../../models/Student.js';
import Course from '../../models/Course.js';
import Slot from '../../models/Slot.js';
import Room from '../../models/Room.js';
import CourseOffering from '../../models/CourseOffering.js';
import ProfessorCapacity from '../../models/ProfessorCapacity.js';
import Building from '../../models/Building.js';
import { getDistanceMatrix, resetDistanceMatrix } from '../../scheduler/distance.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function loadsBaseCollections() {
  const [stu, cou, slo, roo, off, cap, bld] = await Promise.all([
    Student.countDocuments(), Course.countDocuments(), Slot.countDocuments(),
    Room.countDocuments(), CourseOffering.countDocuments(), ProfessorCapacity.countDocuments(),
    Building.countDocuments(),
  ]);
  assert(stu > 10, `too few students: ${stu}`);
  assert(cou >= 30, `too few courses: ${cou}`);
  assert(slo > 10, `too few slots: ${slo}`);
  assert(roo > 50, `too few rooms: ${roo}`);
  assert(off > 0, `no course offerings loaded`);
  assert(cap > 0, `no capacity rules loaded`);
  assert(bld >= 6, `too few buildings: ${bld}`);
}

async function slotFamiliesPresent() {
  const families = await Slot.distinct('family');
  for (const fam of ['THEORY_3', 'THEORY_2', 'LAB_1']) {
    assert(families.includes(fam), `slot family missing: ${fam}`);
  }
}

async function distanceMatrixLoaded() {
  resetDistanceMatrix();
  const mat = getDistanceMatrix();
  assert(mat.A1 && mat.A1.B1 > 0, 'expected A1→B1 distance from CSV');
  assert(mat.A1.A1 === 0, 'self-distance must be zero');
}

async function coursesHaveFamily() {
  const withoutFamily = await Course.countDocuments({ slotFamily: { $in: [null, ''] } });
  assert(withoutFamily === 0, `${withoutFamily} courses missing slot_family`);
}

export default {
  name: 'seed',
  cases: [
    ['loads base collections from CSV', loadsBaseCollections],
    ['slot families are present', slotFamiliesPresent],
    ['distance matrix loads from CSV', distanceMatrixLoaded],
    ['courses carry slot_family', coursesHaveFamily],
  ],
};
