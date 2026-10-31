import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreToolSizes, normalizeSize, cursorShape, cursorTool, brushSize, eraserRadius, formatSize } from '../src/tool-settings.js';
import { hitsObject } from '../src/core.js';

test('migrating a shared width preserves pen and effective marker width with an independent eraser', () => {
  const sizes = restoreToolSizes({ size: 2.25 });
  assert.equal(sizes.pen, 2.25); assert.equal(brushSize('highlighter', sizes) * 5, 11.25);
  sizes.pen = 8; assert.equal(sizes.highlighter, 11.25); assert.equal(eraserRadius(sizes), 12);
  const loaded = restoreToolSizes(JSON.parse(JSON.stringify({ sizes })));
  assert.deepEqual(loaded, sizes);
});
test('saved dimensions and numeric input are bounded and retain fine increments', () => {
  assert.equal(normalizeSize('pen', .526), .55);
  assert.equal(normalizeSize('pen', 2.25), 2.25);
  assert.equal(normalizeSize('eraser', 25), 25);
  assert.deepEqual(restoreToolSizes({ size: NaN, sizes: { pen: -10, highlighter: 1000, eraser: Infinity } }), { pen: .5, highlighter: 60, eraser: 24 });
  assert.deepEqual(restoreToolSizes(null), { pen: 2, highlighter: 10, eraser: 24 });
  assert.equal(formatSize(2.25), '2,25');
});
test('eraser footprint uses its displayed diameter and is independent of pen width', () => {
  const sizes = restoreToolSizes(), line = { type: 'line', size: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, point = { x: 50, y: 14 };
  assert.equal(hitsObject(line, point, point, eraserRadius(sizes)), false);
  sizes.pen = 12; assert.equal(hitsObject(line, point, point, eraserRadius(sizes)), false);
  sizes.eraser = 32; assert.equal(hitsObject(line, point, point, eraserRadius(sizes)), true);
  assert.equal(cursorShape('eraser', '#000000', sizes, 2).diameter, eraserRadius(sizes) * 2 * 2);
});
test('pen cursor stays small, marker and eraser scale with zoom and use the correct color', () => {
  const sizes = restoreToolSizes();
  assert.deepEqual(cursorShape('pen', '#466baf', sizes), { mode: 'pen', color: '#466baf', diameter: 4 });
  sizes.pen = 12; assert.equal(cursorShape('pen', '#466baf', sizes, 2.5).diameter, 7);
  assert.equal(cursorShape('highlighter', '#d6a341', sizes, 2).diameter, 20);
  assert.equal(cursorShape('hand', '#000000', sizes), null);
});
test('temporary hardware eraser returns to the selected pen on release and hand mode remains navigation', () => {
  assert.equal(cursorTool('pen', undefined, { pointerType: 'pen', buttons: 32 }), 'eraser');
  assert.equal(cursorTool('pen', undefined, { pointerType: 'pen', buttons: 2 }), 'eraser');
  assert.equal(cursorTool('pen', undefined, { type: 'pointerup', pointerType: 'pen', buttons: 0, button: 5 }), 'pen');
  assert.equal(cursorTool('pen', 'eraser', { pointerType: 'pen', buttons: 0 }), 'eraser');
  assert.equal(cursorTool('hand', undefined, { pointerType: 'pen', buttons: 32 }), 'hand');
});
