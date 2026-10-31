import test from 'node:test';
import assert from 'node:assert/strict';
import { PenPreview } from '../src/pen-preview.js';
import { LiveInkRenderer, unionBounds } from '../src/live-ink.js';
import { INK_VERSION, StrokeInput, appendInkPoint } from '../src/ink.js';
import { initialLibrary, validateLibrary } from '../src/core.js';

const p = (x, y = 20, pressure = .5) => ({ x, y, p: pressure });
function straight(scale = 1) { const preview = new PenPreview(scale); [0, 4, 8].forEach((t, i) => preview.add(p((20 + i * 4) / scale, 20 / scale), t)); return preview; }
test('pen preview has a short bounded horizon, expires, and retains only actual contact on pause', () => {
  const preview = straight(), confirmed = p(26), result = preview.points(confirmed, 8);
  assert.equal(result[0].x, 28); assert.equal(result.at(-1).x, 34);
  assert.deepEqual(preview.points(confirmed, 40), [p(28)]);
  assert.deepEqual(preview.points(p(28), 40), []);
  const fast = new PenPreview(); [0, 4, 8].forEach((t, i) => fast.add(p(20 + i * 20), t));
  assert.equal(fast.points(p(60), 8).at(-1).x, 68);
});
test('browser prediction is capped and a newer real sample invalidates it', () => {
  const preview = straight();
  preview.browserPrediction([{ x: 32, y: 20, t: 12 }, { x: 36, y: 20, t: 16 }, { x: 1000, y: 20, t: 40 }], 8);
  assert.equal(preview.points(p(28), 8).at(-1).x, 36);
  preview.add(p(32), 12); assert.equal(preview.predicted.length, 0);
  preview.browserPrediction([{ x: 999, y: 20, t: 16 }], 8); assert.equal(preview.predicted.length, 0);
});
test('stops, reversals and tight corners do not receive a forward extension', () => {
  for (const samples of [[p(20), p(24), p(23)], [p(20), p(24), p(24, 24)], [p(20), p(24), p(25)]]) {
    const preview = new PenPreview(); samples.forEach((point, i) => preview.add(point, i * 4));
    assert.deepEqual(preview.points(samples.at(-1), 8), []);
  }
  const idle = new PenPreview(); [0, 4, 8].forEach(t => idle.add(p(20), t)); assert.deepEqual(idle.points(p(20), 8), []);
});
test('preview is screen-space invariant and never changes the confirmed stroke or its pressure', () => {
  const a = straight(), b = straight(2.5), confirmed = p(26, 20, .3), before = structuredClone(confirmed);
  const normal = a.points(confirmed, 8), zoomed = b.points(p(26 / 2.5, 20 / 2.5, .3), 8);
  normal.forEach((point, i) => { assert.ok(Math.abs(point.x - zoomed[i].x * 2.5) < 1e-9); assert.equal(point.p, .3); });
  assert.deepEqual(confirmed, before);
  const data = initialLibrary(), stroke = { type: 'pen', color: '#253a36', size: 2, inkVersion: INK_VERSION, points: [p(20), p(24), p(28)] };
  data.books[0].pages[0].objects.push(stroke); const saved = JSON.stringify(data);
  a.points(stroke.points.at(-1), 8); assert.equal(JSON.stringify(data), saved);
  assert.equal(validateLibrary(JSON.parse(saved)).books[0].pages[0].objects[0].points.length, 3);
});
test('preview tolerates invalid or duplicated samples and clamps page boundaries', () => {
  const preview = new PenPreview(); preview.add(p(NaN), 0); assert.equal(preview.samples.length, 0);
  preview.add(p(786), 0); preview.add(p(790), 4); preview.add(p(793), 8); preview.add(p(1000), 8);
  assert.equal(preview.samples.length, 3); assert.equal(preview.points(p(793), 8).at(-1).x, 794);
});

class Path {
  constructor() { this.commands = []; }
  moveTo(...args) { this.commands.push(['move', ...args]); }
  lineTo(...args) { this.commands.push(['line', ...args]); }
  quadraticCurveTo(...args) { this.commands.push(['quad', ...args]); }
  arc(...args) { this.commands.push(['arc', ...args]); }
  closePath() { this.commands.push(['close']); }
  addPath(path) { this.commands.push(...path.commands); }
}
class Context {
  constructor() { this.clears = []; this.paths = []; }
  save() {} restore() {} setTransform() {} beginPath() {} rect() {} clip() {}
  clearRect(...args) { this.clears.push(args); }
  fill(path) { if (path) this.paths.push(path); } stroke(path) { this.paths.push(path); } arc() {}
}
const stroke = points => ({ type: 'pen', inkVersion: INK_VERSION, color: '#253a36', size: 2, points });
test('tail repaint stays local as the confirmed stroke grows', () => {
  const ctx = new Context(), renderer = new LiveInkRenderer(ctx, Path);
  const object = stroke(Array.from({ length: 1900 }, (_, i) => p(20 + i % 1000 * .5, 40 + Math.floor(i / 1000) * 60 + Math.sin(i * .03) * 4)));
  renderer.render(object); object.points.push(p(470, 100 + Math.sin(1900 * .03) * 4));
  const work = renderer.render(object);
  assert.ok(work.pieces < 150, `Pieces revisited: ${work.pieces}`); assert.ok(work.area < 250, `Area: ${work.area}`);
  assert.ok(ctx.clears.at(-1).every(Number.isFinite));
});
test('spatial repaint includes older crossings and keeps piece order', () => {
  const renderer = new LiveInkRenderer(new Context(), Path);
  const object = stroke([p(10, 20), p(30, 20), p(50, 20), p(80, 80), p(10, 80), p(30, 20), p(40, 20)]);
  renderer.render(object);
  const result = renderer.query({ left: 19, top: 19, right: 31, bottom: 21 });
  assert.ok(result.includes(renderer.pieces[0])); assert.ok(result.includes(renderer.pieces.at(-1)));
  assert.ok(result.indexOf(renderer.pieces[0]) < result.indexOf(renderer.pieces.at(-1)));
});
test('preview replacement and stroke end clear all provisional pixels without modifying points', () => {
  const ctx = new Context(), renderer = new LiveInkRenderer(ctx, Path), object = stroke([p(20), p(24), p(28)]), before = structuredClone(object);
  renderer.render(object, [p(36)]); const extended = { ...renderer.painted };
  renderer.render(object, []); assert.ok(renderer.painted.right >= extended.right);
  renderer.render(null); assert.equal(renderer.pieces.length, 0); assert.equal(renderer.object, null);
  const clear = ctx.clears.at(-1); assert.ok(clear[0] + clear[2] >= extended.right);
  assert.deepEqual(object, before);
});
test('resize resets the active raster cache and repaint covers the stroke again', () => {
  const renderer = new LiveInkRenderer(new Context(), Path), object = stroke([p(20), p(24), p(28)]);
  renderer.render(object); renderer.setScale(2.5, 2.5); assert.equal(renderer.object, null);
  assert.equal(renderer.render(object).pieces, 3); assert.equal(renderer.sx, 2.5);
  assert.deepEqual(unionBounds({ left: 1, top: 2, right: 3, bottom: 4 }, { left: 0, top: 3, right: 5, bottom: 6 }), { left: 0, top: 2, right: 5, bottom: 6 });
});
