import { PAGE_W, PAGE_H, COLORS, uid, clone, newPage, newNotebook, initialLibrary, drawPaper, drawObject, hitsObject, History, validateLibrary } from './core.js';
import { openDatabase, readLibrary, saveLibrary } from './storage.js';
import { INK_VERSION, DEFAULT_PEN_TUNING, normalizePenTuning, StrokeInput, appendInkPoint, inputSamples, canvasResolution } from './ink.js';
import { LiveInkRenderer } from './live-ink.js';
import { PenPreview } from './pen-preview.js';
import { PenTrainingUI } from './pen-training.js';
import { restoreToolSizes, brushSize, eraserRadius } from './tool-settings.js';
import { ToolCursor } from './tool-cursor.js';
import { SizePicker } from './size-picker.js';
import { perfNow, perfRecord, installPerfPanel } from './perf.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const history = new History();
let library, tool = 'pen', color = COLORS[0], size = 2, zoom = 1, fit = true;
const smoothing = 'natural';
let toolSizes = restoreToolSizes(), toolCursor, sizePicker;
let gesture = null, activeStroke = null, frame = 0, saving = false, dirty = false, saveTimer, thumbnailTimer, toastTimer, installEvent;
let storageReady = false, revision = 0, raster = canvasResolution(PAGE_W, devicePixelRatio, PAGE_W, PAGE_H), textPosition, zoomRasterTimer;
// Keep both layers in the browser's normal compositor. A desynchronized,
// transparent overlay can be presented as black by some Windows GPU paths.
const ink = $('ink'), drawing = $('drawing'), ctx = ink.getContext('2d', { alpha: false, desynchronized: false }), live = drawing.getContext('2d', { alpha: true, desynchronized: false });
const liveRenderer = new LiveInkRenderer(live);
let lastLivePaint = -Infinity;
let penTraining;
let trainingMode = false, trainingLibrary = null, trainingTuning = DEFAULT_PEN_TUNING, trainingConfigChanged = false, savedTrainingHistory = null, savedTrainingToolSizes = null, savedTrainingSize = null, savedTrainingTool = null, savedTrainingColor = null, savedTrainingSearch = '', savedTrainingZoom = 1, savedTrainingFit = true, savedTrainingScroll = { left: 0, top: 0 };
const book = () => library.books.find(item => item.id === library.activeBook);
const page = () => book().pages.find(item => item.id === library.activePage);
const penTuning = () => trainingMode ? trainingTuning : normalizePenTuning(library?.writing?.penTuning || DEFAULT_PEN_TUNING);
const setStatus = (text, error = false) => { $('save-status').innerHTML = `<span class="status-dot" style="background:${error ? '#b66b55' : '#75a586'}"></span>${esc(text)}`; $('save-status').title = text; };
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4200); }
function changed() {
  if (trainingMode) return;
book().updated = Date.now(); revision++; dirty = true; setStatus(storageReady ? 'Salvataggio in corso' : 'Modalità temporanea. Esporta un backup.', !storageReady);
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 350);
}
async function flushSave() {
  if (trainingMode || saving || !dirty || !storageReady) return;
  if (activeStroke) { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 150); return; }
  saving = true; const savedRevision = revision;
  try {
    await saveLibrary(clone(library));
    if (revision === savedRevision) { dirty = false; setStatus('Salvato sul dispositivo'); }
} catch { setStatus('Salvataggio non riuscito. Esporta un backup.', true); toast('Spazio o salvataggio non disponibile. Esporta un backup per conservare i quaderni.'); }
  finally { saving = false; if (dirty && revision !== savedRevision) void flushSave(); }
}
function renderBooks() {
  const query = $('search').value.trim().toLocaleLowerCase('it');
  $('book-count').textContent = library.books.length;
  const books = library.books.filter(item => item.title.toLocaleLowerCase('it').includes(query));
  $('books').innerHTML = books.length ? books.map(item => `<button class="book-item ${item.id === library.activeBook ? 'active' : ''}" data-book="${esc(item.id)}" ${item.id === library.activeBook ? 'aria-current="true"' : ''}><span class="mini-cover" style="background:${item.cover}">${icon('book')}</span><span class="book-info"><strong>${esc(item.title)}</strong><small>${item.pages.length} ${item.pages.length === 1 ? 'pagina' : 'pagine'}</small></span>${item.id === library.activeBook ? '<span class="book-dot"></span>' : ''}</button>`).join('') : '<p class="empty-search">Nessun quaderno trovato.</p>';
}
function thumbnail(canvas, targetPage) {
  canvas.width = 136; canvas.height = 192;
  const c = canvas.getContext('2d'); c.scale(136 / PAGE_W, 192 / PAGE_H); drawPaper(c, targetPage.template); targetPage.objects.forEach(obj => drawObject(c, obj));
}
function renderPages() {
  $('pages').innerHTML = book().pages.map((item, i) => `<button class="page-item ${item.id === library.activePage ? 'active' : ''}" data-page="${esc(item.id)}" aria-label="Pagina ${i + 1}" ${item.id === library.activePage ? 'aria-current="page"' : ''}><span class="thumb"><canvas aria-hidden="true"></canvas></span><span class="page-number">${String(i + 1).padStart(2, '0')}</span></button>`).join('');
  $('pages').querySelectorAll('canvas').forEach((canvas, i) => thumbnail(canvas, book().pages[i]));
  $('page-count').textContent = String(book().pages.length).padStart(2, '0');
}
function updateThumb() { const canvas = [...$('pages').querySelectorAll('.page-item')].find(el => el.dataset.page === page().id)?.querySelector('canvas'); if (canvas) thumbnail(canvas, page()); }
function queueThumbnail(pageId) {
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(() => { if (page().id !== pageId) return; if (activeStroke) queueThumbnail(pageId); else updateThumb(); }, 120);
}
function updateHistory() { const h = history.state(page().id); $('undo').disabled = !h.undo.length; $('redo').disabled = !h.redo.length; }
function updatePageInfo() {
  const n = book().pages.findIndex(item => item.id === page().id) + 1;
  $('page-label').textContent = `PAGINA ${String(n).padStart(2, '0')}`;
  $('template').value = page().template;
  $('object-count').textContent = `${page().objects.length} ${page().objects.length === 1 ? 'elemento' : 'elementi'}`;
  updateHistory();
}
function renderPaper() {
  const started = perfNow(), objectCount = page().objects.length;
  ctx.setTransform(raster.x, 0, 0, raster.y, 0, 0); ctx.clearRect(0, 0, PAGE_W, PAGE_H); drawPaper(ctx, page().template); page().objects.forEach(object => drawObject(ctx, object)); updatePageInfo();
  if (started) { perfRecord('pageRenders'); perfRecord('objectsDrawn', objectCount); perfRecord('paperRenderMs', performance.now() - started); }
}
function renderLive() {
  const preview = gesture?.pointerType === 'pen' && activeStroke?.type === 'pen' ? gesture.preview.points(activeStroke.points.at(-1), performance.now()) : [];
  liveRenderer.render(activeStroke, preview);
  lastLivePaint = performance.now();
}
function queueLive() {
  // Paint small dirty regions at input time. At very high input rates, batch the
  // remaining events; requestAnimationFrame is a fallback, not the only gate.
  if (performance.now() - lastLivePaint >= 4) { if (frame) cancelAnimationFrame(frame); frame = 0; renderLive(); }
  else if (!frame) frame = requestAnimationFrame(() => { frame = 0; renderLive(); });
}
function redrawCanvases() { if (library) { renderPaper(); renderLive(); } }
function setupCanvases(cssWidth = PAGE_W) {
  const next = canvasResolution(cssWidth, devicePixelRatio, PAGE_W, PAGE_H);
  if (ink.width === next.width && ink.height === next.height) return false;
  raster = next;
  [ink, drawing].forEach(canvas => { canvas.width = next.width; canvas.height = next.height; });
  perfRecord('canvasResizeCount'); perfRecord('canvasPixels', next.width * next.height * 2);
  liveRenderer.setScale(next.x, next.y);
  return true;
}
function renderAll() {
  $('book-title').value = book().title; $('breadcrumb-title').textContent = book().title; document.title = book().title;
  renderBooks(); renderPages(); renderPaper(); resizePage();
}
function resizePage(deferRaster = false) {
  const available = Math.max(200, $('stage').clientWidth - (innerWidth <= 700 ? 16 : innerWidth <= 900 ? 44 : innerWidth <= 1200 ? 60 : 96));
  const width = fit ? Math.min(PAGE_W, available) : PAGE_W * zoom;
  if (gesture && Math.abs(gesture.rect.width - width) > .5) endGesture();
  $('paper-wrap').style.width = `${width}px`; $('paper-wrap').style.maxWidth = 'none';
  $('page-meta')?.style.setProperty('width', `${width}px`); $('page-meta').style.maxWidth = 'none';
  $('zoom-value').value = `${Math.round(width / PAGE_W * 100)}%`;
  clearTimeout(zoomRasterTimer);
  const commitRaster = () => {
    if (setupCanvases(width) && library) { renderPaper(); renderLive(); }
  };
  if (deferRaster) zoomRasterTimer = setTimeout(commitRaster, 140);
  else commitRaster();
  toolCursor?.refreshGeometry();
}
function selectPage(id) { endGesture(); library.activePage = id; renderPages(); renderPaper(); $('stage').scrollTop = 0; changed(); }
function setSidebarOpen(open) {
  $('sidebar').classList.toggle('open', open);
  $('sidebar-backdrop').hidden = !open;
  $('toggle-sidebar').setAttribute('aria-expanded', String(open));
}
function selectBook(id) { endGesture(); library.activeBook = id; library.activePage = book().pages[0].id; renderAll(); $('stage').scrollTop = 0; setSidebarOpen(false); changed(); }
function setTool(next) {
  endGesture(); tool = next; size = brushSize(tool, toolSizes);
  document.querySelectorAll('[data-tool]').forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', selected); });
drawing.className = tool; const labels = { pen: 'Penna', highlighter: 'Evidenziatore', eraser: 'Gomma (cancella un tratto intero)', text: 'Testo (tocca il foglio)', line: 'Linea (trascina sul foglio)', rect: 'Rettangolo (trascina sul foglio)', hand: 'Sposta (trascina il foglio)' };
  $('tool-status').textContent = labels[tool];
  sizePicker?.update(); toolCursor?.refresh();
}
function renderColors() {
  $('colors').innerHTML = COLORS.map((c, i) => `<button class="color ${c === color ? 'active' : ''}" style="--swatch:${c}" data-color="${c}" aria-label="${['Grafite', 'Verde bosco', 'Blu', 'Terracotta', 'Lavanda', 'Ocra'][i]}" aria-pressed="${c === color}"></button>`).join('') + `<label class="custom-color" title="Colore personalizzato"><input type="color" id="custom-color" value="${color}" aria-label="Colore personalizzato"></label>`;
  $('custom-color').addEventListener('input', e => { color = e.target.value; document.querySelectorAll('[data-color]').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); }); sizePicker?.update(); toolCursor?.refresh(); });
  sizePicker?.update(); toolCursor?.refresh();
}
function point(e) {
  const rect = gesture?.rect || drawing.getBoundingClientRect();
  return { x: Math.max(0, Math.min(PAGE_W, (e.clientX - rect.left) / rect.width * PAGE_W)), y: Math.max(0, Math.min(PAGE_H, (e.clientY - rect.top) / rect.height * PAGE_H)), p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : .5 };
}
function erase(a, b) { const objects = page().objects.filter(object => !hitsObject(object, a, b, eraserRadius(toolSizes))); if (objects.length !== page().objects.length) { if (!gesture.modified) history.push(page()); page().objects = objects; gesture.modified = true; renderPaper(); } }
function pointerDown(e) {
  if (!library || (e.button !== 0 && !(e.pointerType === 'pen' && [2, 5].includes(e.button)))) return;
  if (gesture && e.pointerType === 'pen' && gesture.pointerType === 'touch') endGesture();
  if (gesture) return;
  if (e.pointerType === 'touch' && (e.width > 35 || e.height > 35)) return;
  e.preventDefault(); drawing.setPointerCapture(e.pointerId);
  const move = tool === 'hand' || (e.pointerType === 'touch' && $('pen-only').checked);
  const eraseMode = tool === 'eraser' || e.button === 5 || (e.buttons & 32) !== 0 || (e.pointerType === 'pen' && (e.buttons & 2) !== 0);
  const rect = drawing.getBoundingClientRect();
  gesture = { pointerId: e.pointerId, pointerType: e.pointerType, type: move ? 'hand' : eraseMode ? 'eraser' : tool, last: point(e), rect, startX: e.clientX, startY: e.clientY, scrollX: $('stage').scrollLeft, scrollY: $('stage').scrollTop, modified: false };
  if (move) return;
  if (tool === 'text' && !eraseMode) { textPosition = point(e); endGesture(); textDialog(); return; }
  if (eraseMode) { erase(gesture.last, gesture.last); return; }
  const tuning = penTuning();
  gesture.input = new StrokeInput(smoothing, rect.width / PAGE_W, tuning);
  gesture.preview = new PenPreview(rect.width / PAGE_W); gesture.preview.add(point(e), e.timeStamp);
  const firstPoint = point(e), firstInkPoint = gesture.input.sample(firstPoint, e.timeStamp);
  activeStroke = { type: tool, color, size, inkVersion: INK_VERSION, inkTuning: tuning, points: [firstInkPoint] };
  if (tool === 'rect' || tool === 'line') activeStroke.points.push(point(e));
  queueLive();
}
function pointerMove(e, final = false) {
  if (!gesture || e.pointerId !== gesture.pointerId) return;
  if (e.cancelable) e.preventDefault();
  if (gesture.type === 'hand') { $('stage').scrollTo(gesture.scrollX - (e.clientX - gesture.startX), gesture.scrollY - (e.clientY - gesture.startY)); return; }
  if (gesture.type === 'eraser') { const p = point(e); erase(gesture.last, p); gesture.last = p; return; }
  if (!activeStroke) return;
  if (['line', 'rect'].includes(gesture.type)) activeStroke.points[1] = point(e);
  else {
    const samples = final ? [e] : inputSamples(e);
    for (const sample of samples) {
      const p = point(sample);
      const processed = gesture.input.sample(p, sample.timeStamp, final);
      appendInkPoint(activeStroke.points, processed, gesture.input.scale, final);
      if (!final) gesture.preview.add(p, sample.timeStamp);
    }
  }
  if (!final) {
    capturePredictions(e);
    if (gesture.pointerType === 'pen' && activeStroke.type === 'pen') {
      clearTimeout(gesture.previewTimer); const current = gesture;
      gesture.previewTimer = setTimeout(() => { if (gesture === current) queueLive(); }, 26);
    }
  }
  queueLive();
}
function capturePredictions(e) {
  if (!gesture || gesture.pointerId !== e.pointerId || gesture.pointerType !== 'pen' || activeStroke?.type !== 'pen') return false;
  const predicted = e.getPredictedEvents?.() || [];
  if (!predicted.length) return false;
  gesture.preview.browserPrediction(predicted.map(sample => ({ ...point(sample), t: sample.timeStamp })), e.timeStamp);
  return true;
}
function endGesture() {
  if (!gesture) return;
  const old = gesture; gesture = null;
  clearTimeout(old.previewTimer);
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (drawing.hasPointerCapture(old.pointerId)) drawing.releasePointerCapture(old.pointerId);
  if (activeStroke) {
    const finished = activeStroke;
    history.push(page()); page().objects.push(finished); activeStroke = null;
    // Composite just the finished stroke; a busy page need not be rebuilt each time.
    ctx.setTransform(raster.x, 0, 0, raster.y, 0, 0); drawObject(ctx, finished);
    renderLive(); updatePageInfo(); changed();
    // Thumbnail generation can be more expensive than the pen lift itself.
    queueThumbnail(page().id);
  }
  else if (old.type === 'eraser') {
    if (old.modified) { updateThumb(); changed(); }
    updateHistory();
  }
}
function beginTraining(tuning) {
  endGesture(); if (dirty && storageReady) void flushSave(); clearTimeout(saveTimer); trainingLibrary = library; trainingConfigChanged = false;
  savedTrainingToolSizes = { ...toolSizes }; savedTrainingSize = size; savedTrainingTool = tool; savedTrainingColor = color; savedTrainingSearch = $('search').value; savedTrainingZoom = zoom; savedTrainingFit = fit; savedTrainingScroll = { left: $('stage').scrollLeft, top: $('stage').scrollTop }; savedTrainingHistory = history.entries; history.entries = new Map(); trainingMode = true; trainingTuning = normalizePenTuning(tuning);
  library = initialLibrary(); book().title = 'Allenamento penna'; library.writing = { size: toolSizes.pen, sizes: { ...toolSizes } };
  $('search').value = ''; setTool('pen');
  history.entries.clear(); document.body.classList.add('training-active');
  $('export').hidden = true; $('book-menu').hidden = true; $('import').hidden = true; $('new-book').hidden = true;
$('training-mode-bar').hidden = false; setStatus('Sessione temporanea, non salvata'); renderAll(); toast('Modalità allenamento: scrivi sulla lavagna completa. Le prove non verranno aggiunte ai tuoi quaderni.');
}
function changeTrainingTrial(tuning, clearPage = false) {
  trainingTuning = normalizePenTuning(tuning); endGesture();
  if (clearPage && trainingMode) { const template = page().template; book().pages = [newPage(template)]; library.activePage = book().pages[0].id; history.entries.clear(); renderAll(); }
}
function leaveTraining() {
  endGesture(); trainingMode = false; library = trainingLibrary; trainingLibrary = null; trainingTuning = DEFAULT_PEN_TUNING;
  toolSizes = savedTrainingToolSizes || restoreToolSizes(library.writing); size = savedTrainingSize ?? brushSize(tool, toolSizes); tool = savedTrainingTool || tool; color = savedTrainingColor || color; zoom = savedTrainingZoom; fit = savedTrainingFit; savedTrainingToolSizes = null; savedTrainingSize = null; savedTrainingTool = savedTrainingColor = null;
  history.entries = savedTrainingHistory || new Map(); savedTrainingHistory = null; document.body.classList.remove('training-active', 'training-rating');
  $('training-mode-bar').hidden = true; $('export').hidden = false; $('book-menu').hidden = false; $('import').hidden = false; $('new-book').hidden = false;
 $('search').value = savedTrainingSearch; savedTrainingSearch = ''; renderColors(); setTool(tool); renderAll(); requestAnimationFrame(() => $('stage').scrollTo(savedTrainingScroll)); savedTrainingScroll = { left: 0, top: 0 }; setStatus(storageReady ? 'Salvato sul dispositivo' : 'Modalità temporanea. Esporta un backup.', !storageReady);
  if (trainingConfigChanged && storageReady) { revision++; dirty = true; void flushSave(); }
}
function openDialog(content) { endGesture(); sizePicker?.close(); toolCursor?.hide(); $('dialog-content').innerHTML = content; if (!$('dialog').open) $('dialog').showModal(); }
function closeDialog() { $('dialog').close(); }
function newBookDialog() {
  let cover = COLORS[1];
  openDialog(`<h2>Nuovo quaderno</h2><label class="field">Nome<input id="new-title" maxlength="120" placeholder="Nome del quaderno" required autofocus></label><div class="field">Colore della copertina<div class="cover-colors">${COLORS.map(c => `<button type="button" class="cover-choice ${c === cover ? 'active' : ''}" data-cover="${c}" style="--swatch:${c}" aria-label="Copertina ${c}" aria-pressed="${c === cover}"></button>`).join('')}</div></div><div class="dialog-actions"><button class="button" value="cancel" formnovalidate>Annulla</button><button class="primary" type="button" id="create-book">Crea quaderno ${icon('plus')}</button></div>`);
  $('dialog-content').querySelectorAll('[data-cover]').forEach(button => button.onclick = () => { cover = button.dataset.cover; $('dialog-content').querySelectorAll('[data-cover]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', b === button); }); });
  const create = () => { const title = $('new-title').value.trim(); if (!title) { $('new-title').reportValidity(); return; } const item = newNotebook(title, cover); library.books.push(item); closeDialog(); selectBook(item.id); toast('Quaderno creato.'); };
  $('create-book').onclick = create; $('new-title').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }; $('new-title').focus();
}
function textDialog() {
openDialog(`<h2>Inserisci testo</h2><label class="field">Testo<textarea id="note-text" maxlength="10000" placeholder="Testo della nota" autofocus></textarea></label><label class="field">Dimensione<select id="text-size"><option value="16">Piccola (16)</option><option value="24" selected>Media (24)</option><option value="36">Grande (36)</option><option value="48">Titolo (48)</option></select></label><div class="dialog-actions"><button class="button" value="cancel">Annulla</button><button type="button" class="primary" id="add-text">Inserisci nota</button></div>`);
  $('add-text').onclick = () => { const text = $('note-text').value.trim(); if (!text) return; history.push(page()); page().objects.push({ type: 'text', x: textPosition.x, y: textPosition.y, text, size: Number($('text-size').value), color }); renderPaper(); updateThumb(); changed(); closeDialog(); }; $('note-text').focus();
}
function confirmDialog(title, description, action, label = 'Elimina') { openDialog(`<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="dialog-actions"><button class="button" value="cancel">Annulla</button><button type="button" class="primary" id="confirm-action">${esc(label)}</button></div>`); $('confirm-action').onclick = () => { action(); closeDialog(); }; }
function menuDialog(title, actions) { openDialog(`<h2>${esc(title)}</h2>${actions.map((item, i) => `<button type="button" class="action-row ${item.danger ? 'danger' : ''}" data-action="${i}">${icon(item.icon)}<div><span>${esc(item.label)}</span><small>${esc(item.description)}</small></div></button>`).join('')}`); $('dialog-content').querySelectorAll('[data-action]').forEach(button => button.onclick = () => { closeDialog(); actions[Number(button.dataset.action)].run(); }); }
function pageMenu() {
  menuDialog('Opzioni pagina', [
    { icon: 'copy', label: 'Duplica pagina', description: 'Crea una copia subito dopo questa pagina.', run: () => { const copy = clone(page()); copy.id = uid(); const index = book().pages.indexOf(page()); book().pages.splice(index + 1, 0, copy); selectPage(copy.id); renderBooks(); } },
    { icon: 'eraser', label: 'Svuota pagina', description: 'Rimuove tutti i tratti. Puoi annullare con Ctrl+Z.', run: () => confirmDialog('Svuotare la pagina?', 'Il tipo di carta resterà invariato.', () => { history.push(page()); page().objects = []; renderPaper(); updateThumb(); changed(); }, 'Svuota pagina') },
    { icon: 'trash', label: 'Elimina pagina', description: 'La rimozione della pagina è definitiva.', danger: true, run: () => { if (book().pages.length === 1) { toast('Mantieni almeno una pagina. Puoi svuotarla dal menu.'); return; } confirmDialog('Eliminare questa pagina?', 'Non potrai annullare questa operazione.', () => { const index = book().pages.indexOf(page()); history.entries.delete(page().id); book().pages.splice(index, 1); selectPage(book().pages[Math.min(index, book().pages.length - 1)].id); renderBooks(); }); } }
  ]);
}
function bookMenu() {
  menuDialog('Opzioni quaderno', [
{ icon: 'copy', label: 'Duplica quaderno', description: 'Copia tutte le pagine in un nuovo quaderno.', run: () => { const copy = clone(book()); copy.id = uid(); copy.title = (copy.title + ' (copia)').slice(0, 120); copy.pages.forEach(p => p.id = uid()); library.books.push(copy); selectBook(copy.id); } },
    { icon: 'download', label: 'Backup della libreria', description: 'Salva una copia modificabile di tutti i quaderni.', run: exportBackup },
    { icon: 'trash', label: 'Elimina quaderno', description: 'Rimuovi definitivamente il quaderno e le sue pagine.', danger: true, run: () => confirmDialog('Eliminare il quaderno?', `Verranno eliminate tutte le pagine di “${book().title}”. Esporta un backup se vuoi conservarle.`, () => { book().pages.forEach(p => history.entries.delete(p.id)); library.books = library.books.filter(b => b.id !== book().id); if (!library.books.length) library.books.push(newNotebook()); selectBook(library.books[0].id); }) }
  ]);
}
function download(blob, name) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
const safeName = text => text.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 90) || 'Ardesia';
function exportBackup() { endGesture(); download(new Blob([JSON.stringify(library)], { type: 'application/json' }), `Ardesia-backup-${new Date().toISOString().slice(0, 10)}.ardesia`); toast('Backup esportato. Conservalo in un luogo sicuro.'); }
function renderExport(targetPage, scale = 2) { const canvas = document.createElement('canvas'); canvas.width = PAGE_W * scale; canvas.height = PAGE_H * scale; const c = canvas.getContext('2d'); c.scale(scale, scale); drawPaper(c, targetPage.template); targetPage.objects.forEach(o => drawObject(c, o)); return canvas; }
async function printBook() {
  if (book().pages.length > 100) { toast('Per stampare, usa quaderni con un massimo di 100 pagine.'); return; }
toast('Preparazione delle pagine per la stampa'); $('print-pages').replaceChildren();
  try {
    for (const p of book().pages) { const img = new Image(); img.alt = `Pagina ${book().pages.indexOf(p) + 1}`; img.src = renderExport(p, 1.5).toDataURL('image/png'); await img.decode(); $('print-pages').append(img); }
    window.print();
  } catch { toast('Stampa non riuscita. Prova a esportare le singole pagine in PNG.'); }
}
function exportDialog() {
  menuDialog('Esporta', [
    { icon: 'page', label: 'PDF / Stampa quaderno', description: 'Tutte le pagine A4. Scegli “Salva come PDF” nella stampa.', run: printBook },
    { icon: 'download', label: 'Pagina come immagine', description: 'Esporta il foglio attuale in PNG ad alta risoluzione.', run: () => renderExport(page()).toBlob(blob => { if (blob) download(blob, `${safeName(book().title)}-pagina-${book().pages.indexOf(page()) + 1}.png`); else toast('Esportazione non riuscita.'); }, 'image/png') },
    { icon: 'book', label: 'Backup modificabile', description: 'Tutti i quaderni, da importare di nuovo in Ardesia.', run: exportBackup }
  ]);
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) { toast('Il backup supera il limite di 30 MB.'); return; }
  try {
    const data = validateLibrary(JSON.parse(await file.text()));
    if (data.books.length + library.books.length > 200) { toast('Il limite della libreria è 200 quaderni.'); return; }
    confirmDialog('Importa backup', `Verranno aggiunti ${data.books.length} ${data.books.length === 1 ? 'quaderno' : 'quaderni'}. Quelli presenti saranno conservati.`, () => { data.books.forEach(item => { item.id = uid(); item.pages.forEach(p => p.id = uid()); library.books.push(item); }); selectBook(data.books[0].id); toast('Backup importato.'); }, 'Importa');
  } catch (error) { toast(error instanceof SyntaxError ? 'Il file selezionato non contiene un backup valido.' : error.message); }
}
function helpDialog() {
  openDialog(`<h2>Guida</h2><ul class="help-list"><li><strong>Scrittura.</strong> Scegli un colore e regola lo spessore dal pulsante px. La penna rileva la pressione comunicata dalla tavoletta.</li><li><strong>Touch.</strong> Con “Solo penna” attivo, il tocco sposta il foglio. Il mouse continua a scrivere. Disattivalo per disegnare con le dita.</li><li><strong>Gomma e cronologia.</strong> La gomma elimina un tratto intero. Annulla e ripristina sono disponibili per ogni pagina durante la sessione.</li><li><strong>Salvataggio locale.</strong> Il salvataggio è automatico nel browser di questo dispositivo. Esporta backup regolari: cancellare i dati del browser elimina anche i quaderni.</li><li><strong>Installazione.</strong> Apri Ardesia in Edge o Chrome e usa “Installa app” o la voce di installazione nel menu del browser. Dopo il primo caricamento completo funziona anche offline.</li></ul><p class="warning">Ardesia non include sincronizzazione cloud, riconoscimento della scrittura o importazione PDF.</p><div class="shortcuts"><span><kbd>P</kbd> Penna</span><span><kbd>H</kbd> Evidenziatore</span><span><kbd>E</kbd> Gomma</span><span><kbd>T</kbd> Testo</span><span><kbd>V</kbd> Sposta</span><span><kbd>Ctrl Z</kbd> Annulla</span><span><kbd>Ctrl Y</kbd> Ripristina</span><span><kbd>Ctrl S</kbd> Salva</span></div>`);
}
function undoRedo(direction) { endGesture(); if (history.move(page(), direction)) { renderPaper(); updateThumb(); changed(); } }
function setZoom(delta) { endGesture(); const current = $('paper-wrap').getBoundingClientRect().width / PAGE_W; fit = false; zoom = Math.max(.25, Math.min(2.5, Math.round((current + delta) * 100) / 100)); resizePage(true); }
function bindEvents() {
  $('books').onclick = e => { const button = e.target.closest('[data-book]'); if (button) selectBook(button.dataset.book); };
  $('pages').onclick = e => { const button = e.target.closest('[data-page]'); if (button) selectPage(button.dataset.page); };
  $('search').oninput = renderBooks; $('new-book').onclick = newBookDialog;
  document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => setTool(button.dataset.tool));
  $('colors').onclick = e => { const button = e.target.closest('[data-color]'); if (button) { color = button.dataset.color; renderColors(); } };
  const saveWriting = () => { library.writing = { ...library.writing, size: toolSizes.pen, sizes: { ...toolSizes } }; changed(); };
  sizePicker = new SizePicker(() => ({ tool, sizes: toolSizes, color }), (family, value) => {
    endGesture(); toolSizes[family] = value; size = brushSize(tool, toolSizes); saveWriting(); toolCursor?.refresh();
  }, open => { if (open) toolCursor?.hide(); else toolCursor?.refresh(); });
  $('book-title').oninput = e => { const title = e.target.value.trim(); if (!title) return; book().title = title; $('breadcrumb-title').textContent = title; document.title = title; renderBooks(); changed(); };
  $('book-title').onblur = () => $('book-title').value = book().title;
  $('add-page').onclick = () => { endGesture(); const item = newPage(page().template); book().pages.push(item); selectPage(item.id); renderBooks(); $('pages').lastElementChild?.scrollIntoView({ block: 'nearest' }); };
  $('template').onchange = e => { endGesture(); page().template = e.target.value; renderPaper(); updateThumb(); changed(); };
  $('undo').onclick = () => undoRedo('undo'); $('redo').onclick = () => undoRedo('redo');
  drawing.addEventListener('pointerdown', pointerDown);
  const rawInput = 'onpointerrawupdate' in window;
  drawing.addEventListener(rawInput ? 'pointerrawupdate' : 'pointermove', e => pointerMove(e));
  // pointermove supplies predictions only. Real coordinates still come from
  // exactly one event stream, so raw samples cannot be recorded twice.
  if (rawInput) drawing.addEventListener('pointermove', e => { if (capturePredictions(e)) queueLive(); });
  drawing.addEventListener('pointerup', e => { if (gesture?.pointerId === e.pointerId) { pointerMove(e, true); endGesture(); } });
  drawing.addEventListener('pointercancel', e => { if (gesture?.pointerId === e.pointerId) endGesture(); });
  drawing.addEventListener('lostpointercapture', e => { if (gesture?.pointerId === e.pointerId) endGesture(); });
  drawing.addEventListener('contextmenu', e => e.preventDefault());
  $('export').onclick = exportDialog; $('book-menu').onclick = bookMenu; $('page-menu').onclick = pageMenu;
  $('import').onclick = () => $('import-file').click(); $('import-file').onchange = e => { void importFile(e.target.files[0]); e.target.value = ''; };
  $('help').onclick = helpDialog; $('toggle-sidebar').onclick = () => setSidebarOpen(!$('sidebar').classList.contains('open'));
  $('sidebar-backdrop').onclick = () => setSidebarOpen(false);
  $('stage').addEventListener('click', () => setSidebarOpen(false));
  $('zoom-out').onclick = () => setZoom(-.1); $('zoom-in').onclick = () => setZoom(.1); $('zoom-fit').onclick = () => { endGesture(); fit = true; resizePage(); };
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Schermo intero non disponibile in questa finestra.'); } };
  $('stage').addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(e.deltaY > 0 ? -.05 : .05); } }, { passive: false });
  document.addEventListener('keydown', e => {
    if ($('dialog').open || $('pen-training-dialog').open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) { if (['z', 'y', 's'].includes(key)) { e.preventDefault(); if (key === 'z') undoRedo(e.shiftKey ? 'redo' : 'undo'); if (key === 'y') undoRedo('redo'); if (key === 's') { endGesture(); void flushSave(); } } return; }
    const shortcuts = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', l: 'line', r: 'rect', v: 'hand' }; if (shortcuts[key]) setTool(shortcuts[key]); if (e.key === '?') helpDialog();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { endGesture(); void flushSave(); } else requestAnimationFrame(redrawCanvases); });
  window.addEventListener('focus', () => requestAnimationFrame(redrawCanvases));
  for (const canvas of [ink, drawing]) {
    canvas.addEventListener('contextlost', () => {
      // Do not cancel contextlost: the browser must be allowed to restore it.
      canvas.style.visibility = 'hidden'; endGesture();
toast('Ripristino della visualizzazione');
    });
    canvas.addEventListener('contextrestored', () => {
      requestAnimationFrame(() => { redrawCanvases(); canvas.style.visibility = ''; });
    });
  }
  window.addEventListener('pagehide', () => { endGesture(); void flushSave(); });
  window.addEventListener('beforeunload', e => { if (dirty || activeStroke) { endGesture(); void flushSave(); e.preventDefault(); e.returnValue = ''; } });
  new ResizeObserver(() => resizePage()).observe($('stage'));
  window.addEventListener('resize', resizePage);
  $('stage').addEventListener('scroll', () => { if (gesture && gesture.type !== 'hand') endGesture(); }, { passive: true });
  toolCursor = new ToolCursor($('cursor-layer'), drawing, $('stage'), () => ({ tool, gesture: gesture?.type, pointerId: gesture?.pointerId, color, sizes: toolSizes, blocked: !library || $('dialog').open || !$('size-panel').hidden }), PAGE_W);
  toolCursor.refreshGeometry();
  installPerfPanel();
  $('dialog-form').onsubmit = e => { if (e.submitter?.value !== 'cancel') e.preventDefault(); };
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('install').hidden = false; });
$('install').onclick = async () => { if (installEvent) { await installEvent.prompt(); const choice = await installEvent.userChoice; if (choice.outcome === 'accepted') $('install').hidden = true; installEvent = null; } };
window.addEventListener('appinstalled', () => { $('install').hidden = true; toast('Ardesia è installata. Buona scrittura.'); });
async function acquireEditor() {
  if (!navigator.locks) return;
  await new Promise((resolve, reject) => {
    navigator.locks.request('ardesia-editor', { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('Ardesia è già aperta in un’altra finestra. Chiudila e ricarica questa pagina per proteggere i tuoi appunti.')); return; }
      resolve(); await new Promise(() => {});
    }).catch(reject);
  });
}
async function init() {
  try { await acquireEditor(); } catch (error) { openDialog(`<h2>Un quaderno alla volta.</h2><p>${esc(error.message)}</p><button type="button" class="primary" id="reload">Ricarica Ardesia</button>`); $('reload').onclick = () => location.reload(); $('dialog').addEventListener('cancel', e => e.preventDefault()); $('dialog').querySelector('.dialog-top button').hidden = true; return; }
  try { await openDatabase(); storageReady = true; const saved = await readLibrary(); library = saved ? validateLibrary(saved) : initialLibrary(); }
  catch {
    library = initialLibrary(); storageReady = false;
setStatus('Modalità temporanea. Esporta un backup.', true);
    toast('Dati locali non accessibili. Gli appunti di questa sessione sono temporanei: esporta un backup.');
  }
  toolSizes = restoreToolSizes(library.writing); size = brushSize(tool, toolSizes);
  penTraining = new PenTrainingUI({ getTuning: penTuning, onStart: beginTraining, onTrial: changeTrainingTrial, onExit: leaveTraining, onKeep: tuning => { trainingLibrary.writing = { ...trainingLibrary.writing, penTuning: normalizePenTuning(tuning) }; trainingConfigChanged = true; }, onReset: tuning => { trainingLibrary.writing = { ...trainingLibrary.writing, penTuning: normalizePenTuning(tuning) }; trainingConfigChanged = true; }, notify: toast });
  setupCanvases(); renderColors(); renderAll(); bindEvents();
  if (storageReady) { dirty = true; void flushSave(); navigator.storage?.persist?.().catch(() => {}); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => toast('Modalità offline non disponibile. Il quaderno resta utilizzabile online.'));
}
void init();
