// Pure helpers for the Flows and Model views: scales, SVG geometry and display text. No DOM.

const DAY_MS = 86400000;
const R_MIN = 12;
const R_MAX = 34;
const W_MIN = 1.5;
const W_MAX = 6;
const BEND = 0.2; // control-point offset as a share of the arrow length
const LEAVING = [0xE8, 0x59, 0x0C];
const ARRIVING = [0x0C, 0x85, 0x99];

export const hourText = (h) => `${String(h).padStart(2, '0')}:00`;

export function signed(v) {
  const r = Math.round(Math.abs(v) * 10) / 10; // round the magnitude so +x and -x match
  if (r === 0) return '0';
  return (v > 0 ? '+' : '−') + r.toFixed(1);
}

const share = (v, max) => (max ? Math.min(1, Math.abs(v) / Math.abs(max)) : 0);

// Area-proportional: the radius grows with the square root of |net|.
export const zoneRadius = (v, max) => R_MIN + (R_MAX - R_MIN) * Math.sqrt(share(v, max));
export const arrowWidth = (amount, max) => W_MIN + (W_MAX - W_MIN) * share(amount, max);

export function heatColor(v, max) {
  const t = share(v, max);
  const end = v < 0 ? LEAVING : ARRIVING;
  return '#' + end.map((c) => Math.round(255 + (c - 255) * t).toString(16).padStart(2, '0')).join('');
}

// Quadratic curve from the edge of circle 1 (centre a, radius ra) to the edge of circle 2, bent to the left.
export function arrowPath(a, b, ra, rb) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d <= ra + rb) return null;
  const ux = dx / d, uy = dy / d, len = d - ra - rb;
  const r = (v) => +v.toFixed(1);
  const sx = a.x + ux * ra, sy = a.y + uy * ra, ex = b.x - ux * rb, ey = b.y - uy * rb;
  const cx = (sx + ex) / 2 - uy * BEND * len, cy = (sy + ey) / 2 + ux * BEND * len;
  return `M${r(sx)} ${r(sy)} Q${r(cx)} ${r(cy)} ${r(ex)} ${r(ey)}`;
}

export function hasFlowData(f) {
  const days = ['weekday', 'weekend'];
  return days.some((d) => (f?.net?.[d] ?? []).some((row) => row.some((v) => v !== 0)))
    || days.some((d) => (f?.arrows?.[d] ?? []).some((hour) => hour.length > 0));
}

// [[x, y], ...] with x, y in 0..1 -> SVG points inside box, y pointing up.
export function polyPoints(points, box) {
  const r = (v) => +v.toFixed(1);
  return points.map(([x, y]) => `${r(box.x + x * box.w)},${r(box.y + box.h - y * box.h)}`).join(' ');
}

export const fmtMetric = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
export const fmtCount = (n) => (Number.isFinite(n) ? n.toLocaleString('en-GB') : '—');

export const isTrained = (model) => Boolean(model?.targets?.empty || model?.targets?.full);

const dateFmt = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Budapest', day: 'numeric', month: 'short', year: 'numeric'});
const span = (w) => {
  const from = Date.parse(w?.from), to = Date.parse(w?.to);
  return Number.isFinite(from) && Number.isFinite(to) ? {from, to} : null;
};

export function testWindowText(w) {
  const s = span(w);
  return s && dateFmt.formatRange(s.from, s.to);
}

export function testWindowDays(w) {
  const s = span(w);
  return s && Math.max(1, Math.round((s.to - s.from) / DAY_MS));
}
