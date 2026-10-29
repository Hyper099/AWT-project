import { loadData } from '../../seed/loadData.js';

/**
 * Loads the project CSVs into the connected test database through the same
 * loader `npm run seed` uses, scoped to keep the suite fast: the first 60
 * students (Div-1), enrolled in Semester 5 last year and Semester 7 now. Selections
 * are left out; suites create them with the allocator or the API.
 */
export const FIXTURE_SEM5_STUDENTS = 60;

export async function seedFixture({ users = false } = {}) {
  let sem5 = 0;
  await loadData({
    students: (r) => (String(r.semester) === '5' ? sem5++ < FIXTURE_SEM5_STUDENTS : true),
    selections: false,
    users,
    bcryptRounds: 4,
  });
}
