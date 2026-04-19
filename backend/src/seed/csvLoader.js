import fs from 'node:fs';
import path from 'node:path';

/** Minimal CSV parser — handles quoted fields with commas and doubled quotes. */
function parseRow(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseRow(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] === undefined ? '' : cells[i]; });
    return obj;
  });
}

export function readCsv(dir, filename, { required = false } = {}) {
  const p = path.join(dir, filename);
  if (!fs.existsSync(p)) {
    if (required) throw new Error(`[csvLoader] required file missing: ${filename}`);
    return [];
  }
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

export function dataDir() {
  const envDir = process.env.DATA_DIR;
  const base = envDir || path.resolve(process.cwd(), '..', 'data');
  const withCsv = path.join(base, 'csv');
  return fs.existsSync(withCsv) ? withCsv : base;
}
