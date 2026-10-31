import { SIZE_SPECS, sizeFamily, normalizeSize, formatSize } from './tool-settings.js';

export class SizePicker {
  constructor(getState, onChange, onVisibility) {
    this.getState = getState; this.onChange = onChange; this.onVisibility = onVisibility;
    const el = id => document.getElementById(id);
    this.trigger = el('size-trigger'); this.panel = el('size-panel'); this.range = el('size'); this.number = el('size-number'); this.family = null;
    this.trigger.onclick = () => this.panel.hidden ? this.open() : this.close();
    this.trigger.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); this.open(); this.range.focus(); } });
    el('size-close').onclick = () => this.close(true);
    this.range.oninput = () => this.set(this.range.valueAsNumber);
    this.number.onchange = () => this.commitNumber(); this.number.onblur = () => this.commitNumber();
    this.number.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.commitNumber(); } });
    el('size-decrease').onclick = () => this.step(-1); el('size-increase').onclick = () => this.step(1);
    el('size-presets').onclick = e => { const button = e.target.closest('[data-size]'); if (button) this.set(Number(button.dataset.size)); };
    document.addEventListener('pointerdown', e => { if (!this.panel.hidden && !this.panel.contains(e.target) && !this.trigger.contains(e.target)) this.close(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !this.panel.hidden) { e.preventDefault(); this.close(true); } });
    window.addEventListener('resize', () => { if (!this.panel.hidden) this.position(); });
    document.querySelector('.writing-toolbar').addEventListener('scroll', () => { if (!this.panel.hidden) this.position(); }, { passive: true });
    this.update();
  }
  set(value, family = this.family || sizeFamily(this.getState().tool)) { const normalized = normalizeSize(family, value); if (this.getState().sizes[family] !== normalized) this.onChange(family, normalized); this.update(); }
  commitNumber() { if (Number.isFinite(this.number.valueAsNumber)) this.set(this.number.valueAsNumber, this.family); else this.update(); }
  step(direction) { this.commitNumber(); const state = this.getState(), family = sizeFamily(state.tool); this.set(state.sizes[family] + direction * SIZE_SPECS[family].step); }
  position() {
    const rect = this.trigger.getBoundingClientRect(), width = this.panel.offsetWidth;
    this.panel.style.left = `${Math.max(10, Math.min(rect.left - 20, innerWidth - width - 10))}px`;
    this.panel.style.top = `${Math.max(10, Math.min(rect.bottom + 12, innerHeight - this.panel.offsetHeight - 10))}px`;
  }
  open() { if (this.trigger.disabled) return; this.update(); this.panel.hidden = false; this.trigger.setAttribute('aria-expanded', 'true'); this.position(); this.onVisibility?.(true); }
  close(focus = false) {
    const wasOpen = !this.panel.hidden, family = this.family, value = this.number.valueAsNumber;
    this.panel.hidden = true; this.trigger.setAttribute('aria-expanded', 'false');
    if (wasOpen && family && Number.isFinite(value)) this.set(value, family);
    this.onVisibility?.(false); if (focus) this.trigger.focus();
  }
  update() {
    const state = this.getState(), family = sizeFamily(state.tool), spec = SIZE_SPECS[family], value = state.sizes[family];
    const disabled = ['hand', 'text'].includes(state.tool);
    this.trigger.disabled = disabled;
    if (disabled && !this.panel.hidden) this.close();
    this.trigger.setAttribute('aria-label', disabled ? 'Dimensioni non applicabili a questo strumento' : `${spec.title}: ${formatSize(value)} px`);
document.getElementById('size-value').textContent = disabled ? 'N/D' : formatSize(value);
    document.getElementById('size-heading').textContent = spec.title;
    document.getElementById('size-label').textContent = spec.label;
    document.getElementById('size-description').textContent = family === 'eraser' ? 'Cancella i tratti toccati dal cerchio.' : family === 'highlighter' ? 'La larghezza del segno sulla pagina.' : 'La pressione della penna modula il tratto.';
    for (const input of [this.range, this.number]) { input.min = spec.min; input.max = spec.max; input.step = spec.step; input.value = value; input.setAttribute('aria-label', spec.title); }
    this.range.setAttribute('aria-valuetext', `${formatSize(value)} pixel`);
    this.range.style.setProperty('--range-fill', `${(value - spec.min) / (spec.max - spec.min) * 100}%`);
    document.getElementById('size-min').textContent = formatSize(spec.min); document.getElementById('size-max').textContent = `${formatSize(spec.max)} px`;
    const presets = document.getElementById('size-presets');
    if (this.family !== family) {
      presets.innerHTML = spec.presets.map(v => `<button type="button" data-size="${v}" aria-label="${formatSize(v)} pixel">${formatSize(v)}</button>`).join(''); this.family = family;
    }
    for (const button of presets.children) { const active = Number(button.dataset.size) === value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); }
    document.getElementById('size-decrease').disabled = value <= spec.min; document.getElementById('size-increase').disabled = value >= spec.max;
    const preview = document.getElementById('size-preview');
    preview.dataset.tool = family; preview.style.setProperty('--preview-color', state.color); preview.style.setProperty('--preview-width', family === 'eraser' ? `${value * .6}px` : `${Math.max(.5, value)}px`);
    const triggerPreview = document.getElementById('size-trigger-preview');
    triggerPreview.dataset.tool = family; triggerPreview.style.setProperty('--preview-color', state.color); triggerPreview.style.setProperty('--preview-width', `${Math.max(2, Math.min(14, value))}px`);
    if (!this.panel.hidden) this.position();
  }
}
