import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLibrary, newNotebook, newPage, validateLibrary, History, hitsObject, pointDistance, clone } from '../src/core.js';

test('a new library always has a valid active notebook and page', () => {
  const data = initialLibrary(); assert.equal(validateLibrary(data), data); assert.equal(data.books[0].pages[0].id, data.activePage);
});
test('undo and redo preserve independent page history and branch correctly', () => {
  const a = newPage(), b = newPage(); const history = new History();
  history.push(a); a.objects.push({ text: 'first' }); history.push(a); a.objects.push({ text: 'second' });
  history.push(b); b.objects.push({ text: 'other page' });
  assert.equal(history.move(a, 'undo'), true); assert.deepEqual(a.objects, [{ text: 'first' }]);
  assert.equal(history.move(a, 'redo'), true); assert.equal(a.objects.length, 2);
  history.move(a, 'undo'); history.push(a); a.objects.push({ text: 'new branch' });
  assert.equal(history.move(a, 'redo'), false); assert.equal(b.objects[0].text, 'other page');
  history.move(b, 'undo'); assert.equal(b.objects.length, 0); assert.equal(a.objects.length, 2);
});
test('history snapshots do not alias live data and are capped', () => {
  const p = newPage(), history = new History(); p.objects = [{ points: [{ x: 1 }] }]; history.push(p); p.objects[0].points[0].x = 5;
  history.move(p, 'undo'); assert.equal(p.objects[0].points[0].x, 1);
  for (let i = 0; i < 80; i++) history.push(p); assert.equal(history.state(p.id).undo.length, 60);
});
test('distance handles endpoints and zero length', () => {
  assert.equal(pointDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
  assert.equal(pointDistance({ x: 5, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 2);
  assert.equal(pointDistance({ x: 14, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
});
const stroke = { type: 'pen', size: 3, color: '#253a36', points: [{ x: 10, y: 10, p: .5 }, { x: 110, y: 10, p: .5 }] };
test('eraser intersects fast crossing sweeps, dots, rectangles and text', () => {
  assert.ok(hitsObject(stroke, { x: 50, y: 0 }, { x: 50, y: 20 }, 2));
  assert.equal(hitsObject(stroke, { x: 50, y: 40 }, { x: 50, y: 50 }, 2), false);
  assert.ok(hitsObject({ ...stroke, points: [stroke.points[0]] }, { x: 9, y: 9 }, { x: 9, y: 9 }, 2));
  const rect = { ...stroke, type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
  assert.equal(hitsObject(rect, { x: 50, y: 50 }, { x: 50, y: 50 }, 2), false);
  assert.ok(hitsObject(rect, { x: 50, y: 99 }, { x: 50, y: 99 }, 2));
  const text = { type: 'text', text: 'hello', x: 0, y: 0, size: 20 };
  assert.ok(hitsObject(text, { x: -20, y: 10 }, { x: 100, y: 10 }, 2));
  assert.equal(hitsObject(text, { x: 100, y: 100 }, { x: 120, y: 120 }, 2), false);
});
test('backup validation repairs stale selection and retains actual strokes', () => {
  const data = initialLibrary(); data.activeBook = 'missing'; data.activePage = 'missing'; data.books[0].pages[0].objects.push(clone(stroke));
  validateLibrary(data); assert.equal(data.activeBook, data.books[0].id); assert.equal(data.activePage, data.books[0].pages[0].id); assert.deepEqual(data.books[0].pages[0].objects[0], stroke);
});
test('backup rejects invalid structure, colors, IDs, sizes, coordinates, pressure and shape points', () => {
  const mutations = [
    data => data.version = 99,
    data => data.books = [],
    data => data.books[0].pages = [],
    data => data.books[0].cover = 'red; malicious',
    data => data.books[0].title = 'a'.repeat(121),
    data => data.books[0].pages[0].id = data.books[0].id,
    data => data.books[0].pages[0].template = 'anything',
    data => data.books[0].pages[0].objects[0].size = Infinity,
    data => data.books[0].pages[0].objects[0].size = -1,
    data => data.books[0].pages[0].objects[0].points[0].x = NaN,
    data => data.books[0].pages[0].objects[0].points[0].p = 2,
    data => data.books[0].pages[0].objects[0].points = [null],
    data => { const o = data.books[0].pages[0].objects[0]; o.type = 'rect'; o.points.pop(); },
    data => data.books[0].pages[0].objects[0].type = 'unknown'
  ];
  for (const mutate of mutations) { const data = initialLibrary(); data.books[0].pages[0].objects.push(clone(stroke)); mutate(data); assert.throws(() => validateLibrary(data), /backup/); }
});
test('backup accepts supported object types and titles with markup as plain strings', () => {
  const data = initialLibrary(); data.books.push(newNotebook('<script>alert(1)</script>'));
  data.books[0].pages[0].objects = ['pen', 'highlighter', 'rect', 'line'].map(type => ({ ...clone(stroke), type }));
  data.books[0].pages[0].objects.push({ type: 'text', text: 'first\nsecond', size: 24, x: 20, y: 20, color: '#253a36' });
  assert.doesNotThrow(() => validateLibrary(data));
});
