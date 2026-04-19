import { readCsv, dataDir } from '../seed/csvLoader.js';

/**
 * Travel-cost utilities. Distances come from data/csv/building_distances.csv
 * when available (authoritative), otherwise fall back to Euclidean on x/y.
 */

let distanceMatrix = null; // { from: { to: metres } }

function loadDistanceMatrix() {
  const rows = readCsv(dataDir(), 'building_distances.csv');
  const mat = {};
  for (const r of rows) {
    const from = r.from_building_id;
    const to = r.to_building_id;
    const d = Number(r.distance_meters);
    if (!from || !to || !Number.isFinite(d)) continue;
    if (!mat[from]) mat[from] = {};
    mat[from][to] = d;
  }
  return mat;
}

export function getDistanceMatrix() {
  if (!distanceMatrix) distanceMatrix = loadDistanceMatrix();
  return distanceMatrix;
}

/** Reset cached matrix — useful for tests. */
export function resetDistanceMatrix() {
  distanceMatrix = null;
}

export function buildingDistance(a, b) {
  if (!a || !b) return 0;
  if (a.buildingId === b.buildingId) return 0;
  const mat = getDistanceMatrix();
  const fromRow = mat[a.buildingId];
  if (fromRow && Number.isFinite(fromRow[b.buildingId])) return fromRow[b.buildingId];
  // Legacy fallback: Euclidean if coordinates are present.
  if (Number.isFinite(a.x) && Number.isFinite(b.x)) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return 0;
}

export function walkMinutes(distanceMetres, sameBuilding = false) {
  if (sameBuilding) return 0.5;
  return distanceMetres / 80; // 80 m/min
}

export function dayTravelCost(meetings, buildingsById) {
  const sorted = [...meetings].sort((a, b) => a.startMinute - b.startMinute);
  let totalDist = 0;
  let tightTransfers = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = cur.startMinute - prev.endMinute;
    const a = buildingsById[prev.buildingId];
    const b = buildingsById[cur.buildingId];
    const dist = buildingDistance(a, b);
    totalDist += dist;
    const walk = walkMinutes(dist, a && b && a.buildingId === b.buildingId);
    if (gap >= 0 && walk > gap) tightTransfers++;
  }
  return { totalDist, tightTransfers };
}
