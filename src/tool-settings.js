export const SIZE_SPECS = {
  pen: { title: 'Spessore penna', label: 'Spessore', min: .5, max: 12, step: .05, default: 2, presets: [.5, 1, 1.5, 2, 3, 5, 8] },
  highlighter: { title: 'Larghezza evidenziatore', label: 'Larghezza', min: 2.5, max: 60, step: .25, default: 10, presets: [3, 5, 10, 15, 25, 40, 60] },
  eraser: { title: 'Diametro gomma', label: 'Diametro', min: 4, max: 96, step: 1, default: 24, presets: [4, 8, 12, 24, 40, 64, 96] }
};
export const sizeFamily = tool => tool === 'highlighter' || tool === 'eraser' ? tool : 'pen';
export function normalizeSize(tool, value) {
  const spec = SIZE_SPECS[sizeFamily(tool)];
  if (!Number.isFinite(value)) return spec.default;
  const clamped = Math.max(spec.min, Math.min(spec.max, value));
  return Number((Math.round((clamped - spec.min) / spec.step) * spec.step + spec.min).toFixed(2));
}
export function restoreToolSizes(writing = {}) {
  // Earlier versions shared a pen-sized setting. Preserve its effective marker
  // width when migrating; the new eraser starts with its own diameter.
  const legacy = Number.isFinite(writing?.size) && writing.size >= .5 && writing.size <= 12 ? writing.size : 2;
  const saved = writing?.sizes || {};
  return {
    pen: normalizeSize('pen', Number.isFinite(saved.pen) ? saved.pen : legacy),
    highlighter: normalizeSize('highlighter', Number.isFinite(saved.highlighter) ? saved.highlighter : legacy * 5),
    eraser: normalizeSize('eraser', Number.isFinite(saved.eraser) ? saved.eraser : 24)
  };
}
export const brushSize = (tool, sizes) => tool === 'highlighter' ? sizes.highlighter / 5 : sizes.pen;
export const eraserRadius = sizes => sizes.eraser / 2;
export const formatSize = value => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value);

export function cursorTool(selected, gesture, event) {
  if (gesture) return gesture;
  if (selected === 'hand') return selected;
  if (event?.pointerType === 'pen' && ((event.buttons & 34) !== 0 || event.type === 'pointerdown' && event.button === 5)) return 'eraser';
  return selected;
}
export function cursorShape(tool, color, sizes, scale = 1) {
  if (!['pen', 'highlighter', 'eraser'].includes(tool)) return null;
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const diameter = tool === 'pen' ? Math.max(4, Math.min(7, sizes.pen * zoom)) : Math.max(4, sizes[tool] * zoom);
  return { mode: tool, diameter, color: tool === 'eraser' ? '#64756c' : /^#[0-9a-f]{6}$/i.test(color) ? color : '#253a36' };
}
