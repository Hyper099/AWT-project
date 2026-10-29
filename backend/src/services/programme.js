/**
 * Programme rules for one student: which of their batch's offerings they must
 * take. Offerings without an elective group are compulsory; from each elective
 * group the student takes exactly one option (a theory course and its lab).
 *
 * Semester 5 batches have no groups, so every offering is compulsory there.
 */

/** Groups a batch's offerings into compulsory offerings and elective baskets. */
export function programmeStructure(offerings) {
  const core = [];
  const groups = new Map(); // group → Map(option → offerings)
  for (const o of offerings) {
    if (!o.electiveGroup) { core.push(o); continue; }
    if (!groups.has(o.electiveGroup)) groups.set(o.electiveGroup, new Map());
    const options = groups.get(o.electiveGroup);
    const option = o.electiveOption || o.courseId;
    if (!options.has(option)) options.set(option, []);
    options.get(option).push(o);
  }
  return { core, groups };
}

/**
 * Compares a student's registrations with their programme.
 *
 * Returns
 *   complete       every compulsory offering and one whole option per group
 *   requiredCount  offerings the student must hold (unchosen groups count
 *                  their smallest option)
 *   selectedCount  registrations that count towards the requirement
 *   groups         [{ group, chosen, options: [{ option, courseIds }] }]
 *   conflicts      groups where more than one option was registered
 */
export function programmeProgress(offerings, registrations) {
  const { core, groups } = programmeStructure(offerings);
  const registered = new Set(registrations.map((r) => r.courseId));
  let requiredCount = core.length;
  let selectedCount = core.filter((o) => registered.has(o.courseId)).length;
  let complete = selectedCount === core.length;
  const groupRows = [];
  const conflicts = [];

  for (const [group, options] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const chosen = [...options.entries()]
      .filter(([, offs]) => offs.some((o) => registered.has(o.courseId)))
      .map(([option]) => option);
    if (chosen.length > 1) conflicts.push({ group, options: chosen });
    if (chosen.length === 1) {
      const offs = options.get(chosen[0]);
      requiredCount += offs.length;
      const held = offs.filter((o) => registered.has(o.courseId)).length;
      selectedCount += held;
      if (held < offs.length) complete = false;
    } else {
      requiredCount += Math.min(...[...options.values()].map((offs) => offs.length));
      complete = false;
    }
    groupRows.push({
      group,
      chosen: chosen.length === 1 ? chosen[0] : null,
      options: [...options.entries()].map(([option, offs]) => ({ option, courseIds: offs.map((o) => o.courseId) })),
    });
  }

  return { complete, requiredCount, selectedCount, groups: groupRows, conflicts };
}

/** Slots an offering may use: its allowed list, or every slot of the course's family in its semester. */
export function slotsForOffering(offering, course, slots) {
  if (offering?.allowedSlots?.length) {
    const allowed = new Set(offering.allowedSlots);
    return slots.filter((s) => allowed.has(s.slotCode));
  }
  const family = course?.slotFamily || 'THEORY_3';
  const semester = course?.semester ?? 5;
  return slots.filter((s) => s.family === family && (s.semester ?? 5) === semester);
}
