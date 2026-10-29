const BASE = '/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

export const api = {
  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),

  courses: (token, q = '') => request(`/courses${q}`, { token }),
  slots: (token, semester) => request(`/courses/slots${semester ? `?semester=${semester}` : ''}`, { token }),
  semesters: (token) => request('/semesters', { token }),

  studentMe: (token) => request('/student/me', { token }),
  studentOfferings: (token) => request('/student/offerings', { token }),
  studentGrid: (token) => request('/student/grid', { token }),
  studentProgramme: (token) => request('/student/programme', { token }),
  studentRegs: (token) => request('/student/registrations', { token }),
  studentTimetable: (token) => request('/student/timetable', { token }),
  studentTimetableStatus: (token) => request('/student/timetable/status', { token }),
  studentProfessors: (token, courseId, slotCode) => {
    const q = new URLSearchParams({ courseId });
    if (slotCode) q.set('slotCode', slotCode);
    return request(`/student/professors?${q.toString()}`, { token });
  },
  register: (token, body) => request('/student/register', { method: 'POST', body, token }),
  unregister: (token, courseId) => request(`/student/register/${courseId}`, { method: 'DELETE', token }),

  profMe: (token) => request('/professor/me', { token }),
  profCourses: (token) => request('/professor/courses', { token }),
  profTimetable: (token) => request('/professor/timetable', { token }),
  profSemesters: (token) => request('/professor/semesters', { token }),
  profCourseSelect: (token, body) => request('/professor/courses/select', { method: 'POST', body, token }),

  generate: (token, termId = 'TERM_2026_ODD', { force = false, semester = null } = {}) =>
    request('/scheduler/generate-timetable', { method: 'POST', body: { termId, force, semester }, token }),

  adminBatches: (token) => request('/admin/batches', { token }),
  adminSemesters: (token, termId = 'TERM_2026_ODD') => request(`/admin/semesters?termId=${encodeURIComponent(termId)}`, { token }),
  adminStatus: (token, { termId = 'TERM_2026_ODD', batchId = null, semester = null } = {}) => {
    const q = new URLSearchParams({ termId });
    if (batchId) q.set('batchId', batchId);
    if (semester) q.set('semester', String(semester));
    return request(`/admin/status?${q.toString()}`, { token });
  },
  adminAllotSlots: (token, body) =>
    request('/admin/allot-slots', { method: 'POST', body, token }),
  adminResetSelections: (token, body) =>
    request('/admin/reset-selections', { method: 'POST', body, token }),
  adminResetAllocation: (token, body) =>
    request('/admin/reset-allocation', { method: 'POST', body, token }),
  adminAllocateAll: (token, body) =>
    request('/admin/allocate-all', { method: 'POST', body, token }),

  async downloadTimetable(token, format = 'pdf', termId = 'TERM_2026_ODD') {
    const res = await fetch(`${BASE}/student/timetable/download?format=${format}&termId=${encodeURIComponent(termId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `download failed (${res.status})`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/i);
    const filename = match ? match[1] : `timetable.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  },
};
