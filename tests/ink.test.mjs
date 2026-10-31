import test from 'node:test';
import assert from 'node:assert/strict';
import { StrokeInput, appendInkPoint, inputSamples, canvasResolution, quadraticSamples, smoothStrokePath, smoothCenterline, INK_VERSION, DEFAULT_PEN_TUNING } from '../src/ink.js';
import { clone, initialLibrary, validateLibrary, hitsObject } from '../src/core.js';

const rms = values => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
function noisyLine(mode, scale = 1, speed = 0) {
  const input = new StrokeInput(mode, scale);
  return Array.from({ length: 240 }, (_, i) => {
    const raw = { x: (100 + i * speed / 240) / scale, y: (100 + (i % 2 ? -.8 : .8)) / scale, p: i % 2 ? .45 : .55 };
    const filtered = input.sample(raw, i * 1000 / 240);
    return { x: filtered.x * scale, y: filtered.y * scale, p: filtered.p, rawX: raw.x * scale };
  });
}
test('natural filter attenuates small jitter while following a fast stroke', () => {
  const direct = noisyLine('direct').slice(60), natural = noisyLine('natural').slice(60), fast = noisyLine('natural', 1, 1200).at(-1);
  assert.ok(rms(natural.map(p => p.y - 100)) < rms(direct.map(p => p.y - 100)) * .3);
  assert.ok(fast.rawX - fast.x < 6, `Fast-stroke lag: ${fast.rawX - fast.x} CSS px`);
  assert.ok(rms(natural.map(p => p.p - .5)) < .015);
});
test('steady gives stronger filtering and direct preserves the sampled position', () => {
  const natural = noisyLine('natural').slice(60), steady = noisyLine('steady').slice(60), direct = noisyLine('direct', 1, 100);
  assert.ok(rms(steady.map(p => p.y - 100)) < rms(natural.map(p => p.y - 100)));
  direct.forEach(p => assert.equal(p.x, p.rawX));
});
test('stabilization is invariant to document zoom', () => {
  const normal = noisyLine('natural', 1, 450), zoomed = noisyLine('natural', 2.5, 450);
  normal.forEach((p, i) => { assert.ok(Math.abs(p.x - zoomed[i].x) < 1e-9); assert.ok(Math.abs(p.y - zoomed[i].y) < 1e-9); });
});
test('lift reaches the real endpoint, retains pressure and handles duplicate timestamps', () => {
  const input = new StrokeInput('steady'); input.sample({ x: 0, y: 0, p: .5 }, 10);
  assert.equal(input.sample({ x: 3, y: 0, p: .2 }, 10), null);
  const move = input.sample({ x: 10, y: 0, p: .7 }, 14);
  const last = input.sample({ x: 12, y: 1, p: 0 }, 18, true);
  assert.equal(last.x, 12); assert.equal(last.y, 1); assert.equal(last.p, move.p);
  assert.ok(move.x < 10);
});
test('sample spacing follows screen pixels and preserves pressure-only changes and lift', () => {
  const points = [{ x: 0, y: 0, p: .5 }];
  assert.equal(appendInkPoint(points, { x: .07, y: 0, p: .5 }, 1), false);
  assert.equal(appendInkPoint(points, { x: .07, y: 0, p: .5 }, 2.5), true);
  assert.equal(appendInkPoint(points, { x: .07, y: 0, p: .7 }, 2.5), true);
  assert.equal(appendInkPoint(points, { x: .09, y: 0, p: .7 }, 1, true), true);
});
test('input uses each coalesced sample once and handles empty and unsupported lists', () => {
  const samples = [{ timeStamp: 1 }, { timeStamp: 2 }], parent = { getCoalescedEvents: () => samples };
  assert.equal(inputSamples(parent), samples);
  const empty = { getCoalescedEvents: () => [] }, unsupported = {};
  assert.deepEqual(inputSamples(empty), [empty]); assert.deepEqual(inputSamples(unsupported), [unsupported]);
});
test('canvas resolution grows with zoom and monitor density within the memory budget', () => {
  assert.equal(canvasResolution(794, 1).width, 794);
  assert.equal(canvasResolution(794 * 2.5, 1).width, 1985);
  assert.equal(canvasResolution(794, 2).width, 1588);
  for (const dpr of [1, 1.25, 2, 3, 4]) {
    const raster = canvasResolution(794 * 2.5, dpr);
    assert.ok(raster.width * raster.height < 24_020_000);
    assert.equal(raster.x, raster.width / 794); assert.equal(raster.y, raster.height / 1123);
  }
});

class RecordingPath {
  constructor(source) { this.commands = source ? [...source.commands] : []; }
  moveTo(...args) { this.commands.push(['move', ...args]); }
  lineTo(...args) { this.commands.push(['line', ...args]); }
  quadraticCurveTo(...args) { this.commands.push(['quad', ...args]); }
  arc(...args) { this.commands.push(['arc', ...args]); }
  closePath() { this.commands.push(['close']); }
}
const inkObject = type => ({ type, inkVersion: INK_VERSION, size: 2, color: '#253a36', points: Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 2, y: 30 + Math.sin(i * .3) * 10, p: .4 + i / 100 })) });
test('incremental pen and marker paths exactly match the final path after reload or export', () => {
  for (const type of ['pen', 'highlighter']) {
    const original = inkObject(type), live = { ...original, points: [] };
    for (const point of original.points) { live.points.push(point); smoothStrokePath(live, RecordingPath); }
    const before = clone(original);
    assert.deepEqual(smoothStrokePath(live, RecordingPath).commands, smoothStrokePath(original, RecordingPath).commands);
    assert.deepEqual(original, before);
  }
});
test('completed paths are reused without rebuilding or changing their geometry', () => {
  const object = inkObject('pen');
  const first = smoothStrokePath(object, RecordingPath);
  const second = smoothStrokePath(object, RecordingPath);
  assert.equal(second, first);
  assert.deepEqual(second.commands, first.commands);
});
test('curve geometry handles dots, repeated points, small widths, crossings and sharp turns', () => {
  const source = [{ x: 10, y: 10, p: 0 }, { x: 10, y: 10, p: 1 }, { x: 50, y: 40, p: .1 }, { x: 10, y: 10, p: .9 }, { x: 50, y: 10, p: .4 }];
  for (let length = 1; length <= source.length; length++) for (const size of [.5, 2, 12]) {
    const object = { ...inkObject('pen'), size, points: source.slice(0, length) };
    const path = smoothStrokePath(object, RecordingPath);
    assert.ok(path.commands.length > 0);
    for (const command of path.commands) assert.ok(command.slice(1).every(Number.isFinite));
    const center = smoothCenterline(object);
    assert.deepEqual(center[0], source[0]); assert.deepEqual(center.at(-1), source[length - 1]);
    assert.ok(hitsObject(object, source[length - 1], source[length - 1], .1));
  }
});
test('default saved geometry is unchanged and tuning changes geometry parameters', () => {
  const points = [{ x: 10, y: 10, p: .3 }, { x: 20, y: 11, p: .8 }, { x: 30, y: 18, p: .5 }];
  const plain = { type: 'pen', size: 2, points }, defaults = { ...plain, inkTuning: DEFAULT_PEN_TUNING };
  assert.deepEqual(smoothStrokePath(plain, RecordingPath).commands, smoothStrokePath(defaults, RecordingPath).commands);
  const varied = { ...plain, inkTuning: { ...DEFAULT_PEN_TUNING, geometryStep: .25, pressureSensitivity: .3 } };
  assert.notDeepEqual(smoothStrokePath(plain, RecordingPath).commands, smoothStrokePath(varied, RecordingPath).commands);
});
test('backup round trip retains both legacy and smooth strokes without converting old input', () => {
  const data = initialLibrary(), legacy = { ...inkObject('pen') }; delete legacy.inkVersion;
  data.books[0].pages[0].objects.push(legacy, inkObject('pen'), inkObject('highlighter'));
  const loaded = validateLibrary(JSON.parse(JSON.stringify(data)));
  assert.equal(loaded.books[0].pages[0].objects[0].inkVersion, undefined);
  assert.equal(loaded.books[0].pages[0].objects[1].inkVersion, 2);
});
test('quadratic resampling preserves position and pressure endpoints', () => {
  const a = { x: 0, y: 0, p: .1 }, b = { x: 20, y: 0, p: .9 }, control = { x: 10, y: 20, p: .5 };
  const result = quadraticSamples(a, control, b, 1);
  assert.deepEqual(result[0], a); assert.deepEqual(result.at(-1), b);
  assert.ok(result.every(p => p.p >= .1 && p.p <= .9 && p.y >= 0 && p.y <= 10.01));
});
