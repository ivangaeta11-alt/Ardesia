import { cursorShape, cursorTool } from './tool-settings.js';

// A DOM indicator remains visible when Windows hides its native pen cursor on
// contact. It does not draw into either ink layer or enter exported content.
export class ToolCursor {
  constructor(layer, surface, viewport, getState, pageWidth = 794) {
    this.layer = layer; this.node = layer.firstElementChild; this.surface = surface; this.viewport = viewport; this.getState = getState; this.pageWidth = pageWidth;
    this.last = null; this.bounds = null; this.signature = ''; this.listeners = [];
    this.on(surface, 'pointerenter', e => { this.refreshGeometry(); this.move(e); });
    for (const type of ['pointermove', 'pointerrawupdate', 'pointerdown', 'pointerup']) this.on(surface, type, e => this.move(e));
    this.on(surface, 'pointerleave', e => { if (e.pointerId === this.last?.pointerId) { this.last = null; this.hide(); } });
    this.on(surface, 'pointercancel', e => { if (e.pointerId === this.last?.pointerId) { this.last = null; this.hide(); } });
    this.on(document, 'pointermove', e => {
      if (e.target !== surface && e.pointerType !== 'touch' && (this.getState().pointerId == null || this.getState().pointerId === e.pointerId)) { this.last = null; this.hide(); }
    }, true);
    this.on(viewport, 'scroll', () => this.refreshGeometry(), { passive: true });
    this.on(window, 'resize', () => this.refreshGeometry());
    this.on(window, 'blur', () => { this.last = null; this.hide(); });
    this.on(document, 'visibilitychange', () => { if (document.hidden) { this.last = null; this.hide(); } });
  }
  on(target, event, handler, options) { target.addEventListener(event, handler, options); this.listeners.push(() => target.removeEventListener(event, handler, options)); }
  refreshGeometry() {
    const paper = this.surface.getBoundingClientRect(), view = this.viewport.getBoundingClientRect();
    this.scale = paper.width / this.pageWidth;
    this.bounds = { left: Math.max(paper.left, view.left + this.viewport.clientLeft), top: Math.max(paper.top, view.top + this.viewport.clientTop), right: Math.min(paper.right, view.left + this.viewport.clientLeft + this.viewport.clientWidth), bottom: Math.min(paper.bottom, view.top + this.viewport.clientTop + this.viewport.clientHeight) };
    const b = this.bounds;
    Object.assign(this.layer.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${Math.max(0, b.right - b.left)}px`, height: `${Math.max(0, b.bottom - b.top)}px` });
    this.refresh();
  }
  move(event) {
    const state = this.getState();
    if (state.pointerId != null && state.pointerId !== event.pointerId) return;
    if (event.pointerType === 'touch') { this.hide(); return; }
    this.last = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, buttons: event.buttons, button: event.button, type: event.type };
    if (!this.bounds) this.refreshGeometry(); else this.refresh();
  }
  refresh() {
    const state = this.getState(), event = this.last, b = this.bounds;
    if (!event || !b || state.blocked || event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) { this.hide(); return; }
    const mode = cursorTool(state.tool, state.gesture, event), shape = cursorShape(mode, state.color, state.sizes, this.scale);
    if (!shape) { this.hide(); return; }
    const key = `${mode}:${shape.diameter}:${shape.color}`;
    if (key !== this.signature) {
      this.signature = key; this.node.dataset.mode = mode;
      this.node.style.width = `${shape.diameter}px`; this.node.style.height = `${shape.diameter}px`;
      this.node.style.setProperty('--cursor-color', shape.color);
    }
    const transform = `translate3d(${event.clientX - b.left - shape.diameter / 2}px,${event.clientY - b.top - shape.diameter / 2}px,0)`;
    if (transform !== this.position) { this.node.style.transform = transform; this.position = transform; }
    if (this.layer.hidden) this.layer.hidden = false;
    if (this.surface.dataset.customCursor !== 'true') this.surface.dataset.customCursor = 'true';
  }
  hide() { if (!this.layer.hidden) this.layer.hidden = true; if (this.surface.dataset.customCursor !== 'false') this.surface.dataset.customCursor = 'false'; }
  destroy() { for (const remove of this.listeners) remove(); this.last = null; this.hide(); }
}
