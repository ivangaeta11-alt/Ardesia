import { INK_VERSION, DEFAULT_PEN_TUNING, normalizePenTuning, drawSmoothStroke, smoothCenterline } from './ink.js';
import { renderInk, normalizeInkConfig } from './ink-engine.js';
import { createEngineRenderer } from './ink-engine-adapters.js';
import { perfRecord } from './perf.js';
export const PAGE_W = 397, PAGE_H = 561.5;
export const COLORS = ['#253a36', '#285b4b', '#466baf', '#b75454', '#9b71b2', '#d6a341'];
export const TEMPLATES = ['dots', 'ruled', 'grid', 'blank'];
const engineRasterCache = new WeakMap();
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export function newPage(template = 'dots') { return { id: uid(), template, objects: [] }; }
export function newNotebook(title = 'Quaderno senza titolo', cover = '#285b4b', template = 'dots') {
  return { id: uid(), title, cover, updated: Date.now(), pages: [newPage(template)] };
}
export function initialLibrary() { const book = newNotebook('Il mio primo quaderno'); return { version: 1, activeBook: book.id, activePage: book.pages[0].id, books: [book] }; }
export function pointDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
export function hitsObject(object, a, b, radius) {
  if (object.type === 'text') {
    const width = Math.max(...object.text.split('\n').map(line => line.length)) * object.size * .65;
    const height = object.text.split('\n').length * object.size * 1.3;
    const left = object.x - radius, right = object.x + width + radius, top = object.y - radius, bottom = object.y + height + radius;
    if ([a, b].some(p => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom)) return true;
    return [[{ x: left, y: top }, { x: right, y: top }], [{ x: right, y: top }, { x: right, y: bottom }], [{ x: right, y: bottom }, { x: left, y: bottom }], [{ x: left, y: bottom }, { x: left, y: top }]].some(([c, d]) => segmentsNear(a, b, c, d, 0));
  }
  const handmadeInk = object.inkVersion === INK_VERSION || object.inkEngine === 'perfect-freehand';
  let points = handmadeInk && ['pen', 'highlighter'].includes(object.type) ? smoothCenterline(object) : object.points;
  const halfWidth = object.type === 'highlighter' ? object.size * 2.5 : object.size * (handmadeInk ? ( .3 + (object.inkTuning?.pressureSensitivity ?? DEFAULT_PEN_TUNING.pressureSensitivity)) / 2 : .5);
  if (object.type === 'rect') {
    const [p, q] = points; points = [p, { x: q.x, y: p.y }, q, { x: p.x, y: q.y }, p];
  }
  if (!points?.length) return false;
  if (points.length === 1) return pointDistance(points[0], a, b) <= radius + halfWidth;
  return points.slice(1).some((p, i) => segmentsNear(a, b, points[i], p, radius + halfWidth));
}
function segmentsNear(a, b, c, d, radius) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x) && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y) && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return true;
  return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b)) <= radius;
}
export function drawPaper(ctx, template, width = PAGE_W, height = PAGE_H) {
  ctx.save(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e8e5f5'; ctx.fillStyle = '#d8d3ec'; ctx.lineWidth = .65;
  if (template === 'dots') for (let y = 30; y < height; y += 24) for (let x = 25; x < width; x += 24) { ctx.beginPath(); ctx.arc(x, y, .9, 0, Math.PI * 2); ctx.fill(); }
  if (template === 'ruled' || template === 'grid') {
    const step = template === 'ruled' ? 32 : 24;
    ctx.beginPath(); for (let y = 40; y < height; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    if (template === 'grid') for (let x = 25; x < width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    ctx.stroke();
    if (template === 'ruled') { ctx.strokeStyle = '#ead6ec'; ctx.beginPath(); ctx.moveTo(62, 0); ctx.lineTo(62, height); ctx.stroke(); }
  }
  ctx.restore();
}
export function drawObject(ctx, object) {
  perfRecord('drawObjectCalls');
  ctx.save(); ctx.strokeStyle = object.color; ctx.fillStyle = object.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (object.type === 'text') { ctx.font = `${object.size}px "Segoe UI", sans-serif`; ctx.textBaseline = 'top'; object.text.split('\n').forEach((line, i) => ctx.fillText(line, object.x, object.y + i * object.size * 1.3)); ctx.restore(); return; }
  const pts = object.points;
  if (!pts?.length) { ctx.restore(); return; }
  ctx.lineWidth = object.size;
  // Existing backups may contain Perfect Freehand samples. Re-render those
  // from their saved centerline with CosaStudio's original handcrafted geometry.
  if (object.inkEngine && object.inkEngine !== 'perfect-freehand' && object.type === 'pen' && object.rawPoints?.length) {
    const transform = ctx.getTransform(), ratio = Math.max(.1, Math.min(4, Math.max(Math.abs(transform.a), Math.abs(transform.d)) || 1));
    const pad = Math.max(8, object.size * 6, (object.engineConfig?.maxWidth || object.engineConfig?.strokeWidth || 0) * 3);
    let minX = PAGE_W, minY = PAGE_H, maxX = 0, maxY = 0;
    for (const p of object.rawPoints) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad), right = Math.min(PAGE_W, maxX + pad), bottom = Math.min(PAGE_H, maxY + pad);
    const last = object.rawPoints.at(-1), key = `${object.inkEngine}:${ratio}:${object.color}:${object.size}:${left}:${top}:${right}:${bottom}:${JSON.stringify(object.engineConfig || {})}:${JSON.stringify(object.inkConfig || {})}:${object.rawPoints.length}:${last.x}:${last.y}:${last.p}:${last.t}`;
    let cache = engineRasterCache.get(object); if (!cache) engineRasterCache.set(object, cache = new Map());
    let canvas = cache.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil((right - left) * ratio)); canvas.height = Math.max(1, Math.ceil((bottom - top) * ratio));
      const renderer = createEngineRenderer(object.inkEngine, canvas, object.engineConfig || {}, object.inkConfig, object.color, object.size, ratio);
      renderer.renderStroke({ samples: object.rawPoints.map(p => ({ ...p, x: p.x - left, y: p.y - top })) }); renderer.dispose(); cache.set(key, canvas);
      if (cache.size > 3) cache.delete(cache.keys().next().value);
    }
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, left, top, right - left, bottom - top);
  }
  else if (object.inkConfig && object.type === 'pen') renderInk(ctx, object.points, normalizeInkConfig(object.inkConfig), object.color, object.size);
  else if ((object.inkVersion === INK_VERSION || object.inkEngine === 'perfect-freehand') && ['pen', 'highlighter'].includes(object.type)) drawSmoothStroke(ctx, object);
  else if (object.type === 'rect') { const [a, b] = pts; if (b) ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
  else if (object.type === 'line') { const [a, b] = pts; if (b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
  else if (object.type === 'highlighter') {
    ctx.globalAlpha = .28; ctx.lineWidth = object.size * 5; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, object.size * 2.5, 0, Math.PI * 2); ctx.fill(); }
    else { for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); }
  } else {
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, object.size * (.35 + pts[0].p * .9) / 2, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], p = pts[i]; ctx.lineWidth = object.size * (.35 + ((prev.p + p.p) / 2) * .9);
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
  }
  ctx.restore();
}
export class History {
  constructor() { this.entries = new Map(); }
  state(id) { if (!this.entries.has(id)) this.entries.set(id, { undo: [], redo: [] }); return this.entries.get(id); }
  push(page) { const state = this.state(page.id); state.undo.push(clone(page.objects)); if (state.undo.length > 60) state.undo.shift(); state.redo = []; }
  move(page, direction) { const state = this.state(page.id), target = state[direction]; if (!target.length) return false; state[direction === 'undo' ? 'redo' : 'undo'].push(clone(page.objects)); page.objects = target.pop(); return true; }
}
export function validateLibrary(data) {
  const fail = () => { throw new Error('Il file non è un backup Ardesia valido.'); };
  if (data?.version !== 1 || !Array.isArray(data.books) || !data.books.length || data.books.length > 200) fail();
  const ids = new Set(); let pointCount = 0;
  const id = value => { if (typeof value !== 'string' || !value || value.length > 100 || ids.has(value)) fail(); ids.add(value); };
  const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const coord = value => Number.isFinite(value) && Math.abs(value) <= 20000;
  for (const book of data.books) {
    id(book.id); if (typeof book.title !== 'string' || book.title.length > 120 || !color(book.cover) || !Array.isArray(book.pages) || !book.pages.length || book.pages.length > 1000) fail();
    for (const page of book.pages) {
      id(page.id); if (!TEMPLATES.includes(page.template) || !Array.isArray(page.objects) || page.objects.length > 20000) fail();
      for (const object of page.objects) {
        if (!['pen', 'highlighter', 'line', 'rect', 'text'].includes(object.type) || !color(object.color) || !Number.isFinite(object.size) || object.size < .5 || object.size > 100) fail();
        if (object.inkTuning !== undefined) object.inkTuning = normalizePenTuning(object.inkTuning);
        if (object.type === 'text') { if (!coord(object.x) || !coord(object.y) || typeof object.text !== 'string' || object.text.length > 10000) fail(); }
        else {
          if (!Array.isArray(object.points) || !object.points.length || (['line', 'rect'].includes(object.type) && object.points.length !== 2)) fail();
          pointCount += object.points.length; if (pointCount > 4000000) fail();
          for (const p of object.points) if (!p || !coord(p.x) || !coord(p.y) || !Number.isFinite(p.p) || p.p < 0 || p.p > 1) fail();
          if (object.rawPoints !== undefined) {
            if (object.type !== 'pen' || !Array.isArray(object.rawPoints) || !object.rawPoints.length || object.rawPoints.length > 2000000) fail();
            pointCount += object.rawPoints.length;
            if (pointCount > 4000000) fail();
            for (const p of object.rawPoints) if (!p || !coord(p.x) || !coord(p.y) || !Number.isFinite(p.p) || p.p < 0 || p.p > 1 || !Number.isFinite(p.t)) fail();
          }
          if (object.inkEngine !== undefined) {
            if (object.type !== 'pen' || !['cosastudio', 'perfect-freehand', 'signature-pad', 'paperjs'].includes(object.inkEngine) || !object.engineConfig || typeof object.engineConfig !== 'object') fail();
          }
          if (object.inkConfig !== undefined) {
            if (object.type !== 'pen' || !object.inkConfig || typeof object.inkConfig !== 'object') fail();
            try { object.inkConfig = normalizeInkConfig(object.inkConfig); } catch { fail(); }
          }
        }
      }
    }
  }
  const active = data.books.find(book => book.id === data.activeBook) || data.books[0];
  if (data.writing?.penTuning) data.writing.penTuning = normalizePenTuning(data.writing.penTuning);
  data.activeBook = active.id; data.activePage = active.pages.find(page => page.id === data.activePage)?.id || active.pages[0].id;
  return data;
}
