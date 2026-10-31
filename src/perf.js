const enabledByUrl = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';
const values = Object.create(null);
let active = false, lastFrame = 0, frameHandle = 0, observer = null;
const $ = id => document.getElementById(id);

function record(name, value = 1) {
  if (!active) return;
  const entry = values[name] || (values[name] = { count: 0, total: 0, max: 0, samples: [] });
  entry.count++; entry.total += value; entry.max = Math.max(entry.max, value);
  if (entry.samples.length < 1200) entry.samples.push(value);
}
function frame(time) {
  if (!active) return;
  if (lastFrame) record('frameMs', time - lastFrame);
  lastFrame = time; frameHandle = requestAnimationFrame(frame);
}
function percentile(samples, q) { if (!samples?.length) return 0; const sorted = [...samples].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]; }
function display() {
  if (!enabledByUrl) return;
  const specs = [
    ['frameMs', 'Frame ms'], ['paperRenderMs', 'renderPaper ms'], ['drawObjectCalls', 'drawObject calls'],
    ['objectsDrawn', 'Oggetti per renderPaper'], ['geometrySegments', 'Segmenti geometrici costruiti'],
    ['pathCopies', 'Copie Path2D'], ['canvasResizeCount', 'Riallocazioni Canvas'], ['canvasPixels', 'Pixel Canvas riallocati']
  ];
  for (const [key, label] of specs) {
    const entry = values[key] || { count: 0, total: 0, max: 0, samples: [] };
    const output = $(`perf-${key}`); if (!output) continue;
if (key === 'frameMs' || key === 'paperRenderMs') output.textContent = entry.count ? `media ${(entry.total / entry.count).toFixed(2)} | p95 ${percentile(entry.samples, .95).toFixed(2)} | max ${entry.max.toFixed(2)}` : 'N/D';
else output.textContent = entry.count ? `${Math.round(entry.total).toLocaleString('it-IT')} | ${entry.count} misure` : 'N/D';
    output.parentElement.querySelector('span').textContent = label;
  }
}
function start() {
  for (const key of Object.keys(values)) delete values[key];
  active = true; lastFrame = 0; frameHandle = requestAnimationFrame(frame);
  if ('PerformanceObserver' in window) {
    try { observer = new PerformanceObserver(list => { for (const item of list.getEntries()) record('longTasks', item.duration); }); observer.observe({ type: 'longtask', buffered: false }); } catch { observer = null; }
  }
  if ($('perf-state')) $('perf-state').textContent = 'Raccolta attiva';
}
function stop() {
  active = false; cancelAnimationFrame(frameHandle); observer?.disconnect(); observer = null; display();
  if ($('perf-state')) $('perf-state').textContent = 'Raccolta conclusa';
}
export const perfNow = () => active ? performance.now() : 0;
export const perfRecord = record;
export function installPerfPanel() {
  if (!enabledByUrl) return;
  const panel = $('perf-panel'); if (!panel) return;
  panel.hidden = false; $('perf-start').onclick = start; $('perf-stop').onclick = stop;
  window.__ardesiaPerf = { start, stop, snapshot: () => Object.fromEntries(Object.entries(values).map(([key, e]) => [key, { count: e.count, average: e.count ? e.total / e.count : 0, p95: percentile(e.samples, .95), max: e.max }])) };
}
