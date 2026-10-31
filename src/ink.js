// Screen-space filtering keeps the feel consistent at every document zoom.
// Adaptive low-pass principle: Casiez, Roussel & Vogel, CHI 2012 (1 Euro filter).
import { perfRecord } from './perf.js';
export const INK_VERSION = 2;
export const DEFAULT_PEN_TUNING = Object.freeze({ minCutoff: 12, beta: .045, derivativeCutoff: 10, pressureCutoff: 20, pressureSensitivity: .9, geometryStep: .45 });
export const PEN_TUNING_RANGES = Object.freeze({ minCutoff: [6, 24], beta: [.01, .10], derivativeCutoff: [6, 18], pressureCutoff: [8, 32], pressureSensitivity: [.3, 1.5], geometryStep: [.25, .75] });
export function normalizePenTuning(value = {}) {
  return Object.fromEntries(Object.entries(PEN_TUNING_RANGES).map(([key, [min, max]]) => [key, Number.isFinite(value[key]) ? Math.max(min, Math.min(max, value[key])) : DEFAULT_PEN_TUNING[key]]));
}
const MODES = { direct: null, natural: { cutoff: 12, beta: .045 }, steady: { cutoff: 5, beta: .025 } };
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
const mix = (a, b, amount) => a + (b - a) * amount;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });

export class StrokeInput {
  constructor(mode = 'natural', scale = 1, tuning = null) { this.mode = MODES[mode] === undefined ? MODES.natural : MODES[mode]; this.scale = Math.max(.01, scale); this.tuning = normalizePenTuning(tuning || (this.mode ? { ...DEFAULT_PEN_TUNING, minCutoff: this.mode.cutoff, beta: this.mode.beta } : DEFAULT_PEN_TUNING)); this.last = null; }
  sample(point, time, final = false) {
    const raw = { x: point.x * this.scale, y: point.y * this.scale, p: point.p };
    if (!this.last) {
      this.last = { raw, filtered: { ...raw }, time, vx: 0, vy: 0 };
      return { ...point };
    }
    const previous = this.last;
    if (!final && time <= previous.time) return null;
    const dt = Math.max(.001, Math.min(.067, (time - previous.time) / 1000));
    const derivativeAlpha = alpha(this.tuning.derivativeCutoff, dt);
    const vx = mix(previous.vx, (raw.x - previous.raw.x) / dt, derivativeAlpha);
    const vy = mix(previous.vy, (raw.y - previous.raw.y) / dt, derivativeAlpha);
    const positionAlpha = this.mode ? alpha(this.tuning.minCutoff + this.tuning.beta * Math.hypot(vx, vy), dt) : 1;
    const filtered = {
      x: final ? raw.x : mix(previous.filtered.x, raw.x, positionAlpha),
      y: final ? raw.y : mix(previous.filtered.y, raw.y, positionAlpha),
      // A pointerup has zero pressure because the pen is no longer touching.
      // Keep the last contact pressure instead of producing an artificial needle.
      p: final ? previous.filtered.p : mix(previous.filtered.p, raw.p, alpha(this.tuning.pressureCutoff, dt))
    };
    this.last = { raw, filtered, time, vx, vy };
    return { x: filtered.x / this.scale, y: filtered.y / this.scale, p: filtered.p };
  }
}

export function appendInkPoint(points, point, scale = 1, final = false) {
  if (!point) return false;
  const last = points.at(-1);
  if (!last || Math.hypot(last.x - point.x, last.y - point.y) * scale >= (final ? .01 : .15) || Math.abs(last.p - point.p) >= .015) {
    points.push(point); return true;
  }
  return false;
}

// Never combine rawupdate and pointermove samples: they describe the same input.
export function inputSamples(event) {
  const coalesced = event.getCoalescedEvents?.();
  if (coalesced?.length) return coalesced;
  return [event];
}

export function canvasResolution(cssWidth, pixelRatio = 1, pageWidth = 794, pageHeight = 1123) {
  // Two full-page layers use at most about 192 MB of RGBA surfaces. At 250%
  // this preserves native detail on a 2x screen; higher densities hit the cap.
  const ratio = Math.max(1, Math.min(4, Number.isFinite(pixelRatio) ? pixelRatio : 1));
  const scale = Math.min(Math.max(.25, cssWidth / pageWidth) * ratio, Math.sqrt(24_000_000 / (pageWidth * pageHeight)));
  const width = Math.max(1, Math.ceil(pageWidth * scale)), height = Math.max(1, Math.ceil(pageHeight * scale));
  return { width, height, x: width / pageWidth, y: height / pageHeight };
}

export function quadraticSamples(a, control, b, step) {
  const length = Math.hypot(control.x - a.x, control.y - a.y) + Math.hypot(b.x - control.x, b.y - control.y);
  const count = Math.max(1, Math.ceil(length / step));
  const points = [a];
  for (let i = 1; i <= count; i++) {
    const t = i / count, u = 1 - t;
    points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y, p: u * u * a.p + 2 * u * t * control.p + t * t * b.p });
  }
  return points;
}

const pathCache = new WeakMap();
const centerlineCache = new WeakMap();
export function smoothCenterline(object) {
  const points = object.points, cached = centerlineCache.get(object);
  if (cached?.source === points && cached.count === points.length) return cached.points;
  const line = points.length ? [points[0]] : [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = i === 0 ? points[0] : midpoint(points[i - 1], points[i]);
    line.push(...quadraticSamples(start, points[i], midpoint(points[i], points[i + 1]), 3).slice(1));
  }
  if (points.length > 1) line.push(points.at(-1));
  centerlineCache.set(object, { source: points, count: points.length, points: line });
  return line;
}
// Keep the finest pen taps rasterizable even at the minimum contact pressure.
const radius = (point, size, sensitivity = .9) => Math.max(.25, size * (.3 + sensitivity * Math.sqrt(Math.max(0, Math.min(1, point.p)))) / 2);
function disk(path, point, r) { path.moveTo(point.x + r, point.y); path.arc(point.x, point.y, r, 0, 2 * Math.PI); path.closePath(); }
function ribbon(path, a, control, b, size, tuning = DEFAULT_PEN_TUNING) {
  const samples = quadraticSamples(a, control, b, Math.max(.2, Math.min(1.5, size * tuning.geometryStep)));
  perfRecord('geometrySegments', samples.length - 1);
  disk(path, samples[0], radius(samples[0], size, tuning.pressureSensitivity));
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1], q = samples[i], dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
    const r0 = radius(p, size, tuning.pressureSensitivity), r1 = radius(q, size, tuning.pressureSensitivity);
    if (length > 1e-8) {
      const nx = -dy / length, ny = dx / length;
      // Every subpath has the same winding. One fill gives a seamless union,
      // including tight loops and crossings, without repeated alpha blending.
      path.moveTo(p.x - nx * r0, p.y - ny * r0); path.lineTo(q.x - nx * r1, q.y - ny * r1);
      path.lineTo(q.x + nx * r1, q.y + ny * r1); path.lineTo(p.x + nx * r0, p.y + ny * r0); path.closePath();
    }
    disk(path, q, r1);
  }
}

function pieceBounds(points, object) {
  const pad = object.type === 'highlighter' ? object.size * 2.5 : Math.max(.25, object.size * .6);
  return { left: Math.min(...points.map(p => p.x)) - pad, top: Math.min(...points.map(p => p.y)) - pad, right: Math.max(...points.map(p => p.x)) + pad, bottom: Math.max(...points.map(p => p.y)) + pad };
}

// Each stable piece depends only on confirmed points. Preview points are supplied
// separately for the replaceable tail and never enter the saved stroke.
export function stableStrokePiece(object, index, Path = globalThis.Path2D) {
  const points = object.points, control = points[index];
  const tuning = normalizePenTuning(object.inkTuning || DEFAULT_PEN_TUNING);
  const a = index === 0 ? control : midpoint(points[index - 1], control), b = midpoint(control, points[index + 1]);
  const path = new Path();
  if (object.type === 'highlighter') { path.moveTo(a.x, a.y); path.quadraticCurveTo(control.x, control.y, b.x, b.y); }
  else ribbon(path, a, control, b, object.size, tuning);
  return { path, bounds: pieceBounds([a, control, b], object) };
}

export function strokeTailPiece(object, preview = [], Path = globalThis.Path2D) {
  const points = object.points, last = points.at(-1), path = new Path();
  const tuning = normalizePenTuning(object.inkTuning || DEFAULT_PEN_TUNING);
  if (!last) return { path, bounds: null, dot: false };
  const extra = [last, ...preview], marker = object.type === 'highlighter';
  let start = points.length > 1 ? midpoint(points.at(-2), last) : last;
  const controls = [start, ...extra];
  if (marker) path.moveTo(start.x, start.y);
  for (let i = 0; i < extra.length - 1; i++) {
    const end = midpoint(extra[i], extra[i + 1]);
    if (marker) path.quadraticCurveTo(extra[i].x, extra[i].y, end.x, end.y);
    else ribbon(path, start, extra[i], end, object.size, tuning);
    start = end;
  }
  const end = extra.at(-1);
  if (marker) path.lineTo(end.x, end.y); else ribbon(path, start, end, end, object.size, tuning);
  return { path, bounds: pieceBounds(controls, object), dot: marker && points.length === 1 && !preview.length };
}

// Midpoint quadratics only change their final half-segment as samples arrive.
// Cache the stable body so a long stroke is not reconstructed on every frame.
export function smoothStrokePath(object, Path = globalThis.Path2D) {
  const points = object.points, isMarker = object.type === 'highlighter';
  const tuning = normalizePenTuning(object.inkTuning || DEFAULT_PEN_TUNING), tuneKey = JSON.stringify(tuning);
  let cached = pathCache.get(object);
  if (!cached || cached.points !== points || cached.size !== object.size || cached.tuneKey !== tuneKey || cached.count > points.length - 1) {
    cached = { points, size: object.size, tuneKey, count: 0, path: new Path(), finalCount: -1, finalPath: null }; pathCache.set(object, cached);
    if (isMarker && points.length) cached.path.moveTo(points[0].x, points[0].y);
  }
  if (cached.finalCount === points.length && cached.finalPath) return cached.finalPath;
  for (let i = cached.count; i < points.length - 1; i++) {
    const start = i === 0 ? points[0] : midpoint(points[i - 1], points[i]), end = midpoint(points[i], points[i + 1]);
    if (isMarker) cached.path.quadraticCurveTo(points[i].x, points[i].y, end.x, end.y);
    else ribbon(cached.path, start, points[i], end, object.size, tuning);
    cached.count++;
  }
  perfRecord('pathCopies');
  const path = new Path(cached.path);
  if (points.length) {
    const last = points.at(-1), start = points.length > 1 ? midpoint(points.at(-2), last) : last;
    if (isMarker) { if (points.length > 1) path.lineTo(last.x, last.y); }
    else ribbon(path, start, last, last, object.size, tuning);
  }
  cached.finalCount = points.length;
  cached.finalPath = path;
  return path;
}

export function drawSmoothStroke(ctx, object) {
  if (!object.points.length) return;
  const path = smoothStrokePath(object);
  if (object.type === 'highlighter') {
    ctx.globalAlpha = .28; ctx.lineWidth = object.size * 5;
    if (object.points.length === 1) { const p = object.points[0]; ctx.beginPath(); ctx.arc(p.x, p.y, object.size * 2.5, 0, 2 * Math.PI); ctx.fill(); }
    else ctx.stroke(path);
  } else ctx.fill(path);
}
