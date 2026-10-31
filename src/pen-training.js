import { DEFAULT_PEN_TUNING, PEN_TUNING_RANGES, normalizePenTuning } from './ink.js';

const $ = id => document.getElementById(id);
const KEYS = Object.keys(PEN_TUNING_RANGES), STORE = 'ardesia-pen-training-v1';
const toVector = value => KEYS.map(key => (normalizePenTuning(value)[key] - PEN_TUNING_RANGES[key][0]) / (PEN_TUNING_RANGES[key][1] - PEN_TUNING_RANGES[key][0]));
const fromVector = values => normalizePenTuning(Object.fromEntries(KEYS.map((key, i) => { const [lo, hi] = PEN_TUNING_RANGES[key]; return [key, lo + (hi - lo) * Math.max(0, Math.min(1, Number.isFinite(values[i]) ? values[i] : .5))]; })));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const copy = value => JSON.parse(JSON.stringify(value));
const tuningForStage = state => {
  if (state.stage === 'calibration') return fromVector(state.initial);
  if (state.stage === 'blind' || state.stage === 'blind-second') {
    const choice = state.stage === 'blind-second' ? (state.blindFirst === 'initial' ? 'best' : 'initial') : (state.blindFirst || 'best');
    return fromVector(choice === 'initial' ? state.initial : state.best);
  }
  return fromVector(state.candidate);
};

export function makeTrainingState(initial = DEFAULT_PEN_TUNING) {
  const vector = toVector(initial);
  return { initial: vector, best: [...vector], candidate: [...vector], eta: .18, stagnant: 0, attempts: 0, stage: 'calibration', history: [], directions: [], recent: [], reference: false };
}
export function generateCandidate(state, random = Math.random) {
  let chosen;
  for (let tries = 0; tries < 40; tries++) {
    const direction = state.directions.length && random() < .45 ? [...state.directions[Math.floor(random() * state.directions.length)]] : Array.from({ length: KEYS.length }, () => random() * 2 - 1);
    const norm = Math.hypot(...direction) || 1;
    const candidate = state.best.map((v, i) => Math.max(0, Math.min(1, v + state.eta * direction[i] / norm)));
    if (distance(candidate, state.best) >= .035 && !state.recent.some(item => distance(item, candidate) < .025)) { chosen = { candidate, direction: direction.map(x => x / norm) }; break; }
  }
  if (!chosen) {
    const candidate = state.best.map((v, i) => { const delta = (i % 2 ? -1 : 1) * Math.min(.08, state.eta); return Math.max(0, Math.min(1, v + delta)); });
    chosen = { candidate, direction: [1, 0, 0, 0, 0, 0] };
  }
  state.candidate = chosen.candidate; state.recent.push([...chosen.candidate]); state.recent = state.recent.slice(-12); state.pendingDirection = chosen.direction;
  return fromVector(chosen.candidate);
}
export function rateCandidate(state, rating) {
  if (!['better', 'same', 'worse'].includes(rating) || state.stage !== 'rating') return false;
  state.history.push({ before: copy({ ...state, pendingDirection: undefined }), rating }); state.attempts++;
  if (rating === 'better') { state.best = [...state.candidate]; state.directions.push(state.pendingDirection || []); state.directions = state.directions.slice(-6); state.eta = Math.min(.24, state.eta * 1.04); state.stagnant = 0; }
  else { state.stagnant = (state.stagnant || 0) + 1; state.eta = Math.max(.035, state.eta * (rating === 'same' ? .96 : .92)); if (state.stagnant >= 5) { state.eta = Math.min(.24, state.eta * 1.25); state.stagnant = 0; } }
  state.stage = state.attempts % 10 === 0 ? 'blind' : 'trial'; if (state.stage === 'blind') state.blindFirst = Math.random() < .5 ? 'initial' : 'best'; state.candidate = [...state.best];
  return true;
}
export function undoTrainingRating(state) { const entry = state.history.pop(); if (!entry) return false; Object.assign(state, entry.before); return true; }
export function restoreTrainingState(value, initial = DEFAULT_PEN_TUNING) {
  try {
    const validVector = vector => Array.isArray(vector) && vector.length === KEYS.length && vector.every(x => Number.isFinite(x) && x >= 0 && x <= 1);
    if (!validVector(value.initial) || !validVector(value.best) || !validVector(value.candidate) || !['calibration', 'trial', 'rating', 'blind', 'blind-second', 'blind-rating'].includes(value.stage)) return makeTrainingState(initial);
    const state = { ...makeTrainingState(initial), ...value };
    state.eta = Number.isFinite(state.eta) ? Math.max(.035, Math.min(.24, state.eta)) : .18;
    state.history = Array.isArray(state.history) ? state.history.slice(-100) : [];
    state.recent = Array.isArray(state.recent) ? state.recent.filter(validVector).slice(-12) : [];
    const validDirection = vector => Array.isArray(vector) && vector.length === KEYS.length && vector.every(x => Number.isFinite(x) && x >= -1 && x <= 1);
    state.directions = Array.isArray(state.directions) ? state.directions.filter(validDirection).slice(-6) : [];
    if (!validDirection(state.pendingDirection)) state.pendingDirection = null;
    // A reload never treats an unfinished candidate as accepted.
    if (state.stage === 'rating') state.stage = 'trial';
    if (state.stage === 'blind-rating') state.stage = 'blind';
    return state;
  } catch { return makeTrainingState(initial); }
}

export class PenTrainingUI {
  constructor({ getTuning, onStart, onTrial, onExit, onKeep, onReset, notify }) {
    this.getTuning = getTuning; this.onStart = onStart; this.onTrial = onTrial; this.onExit = onExit; this.onKeep = onKeep; this.onReset = onReset; this.notify = notify; this.dialog = document.getElementById('pen-training-dialog'); this.state = null; this.active = false; this.suppressClose = false; this.activeTuning = DEFAULT_PEN_TUNING; this.setup();
  }
  save() { if (this.state) { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch { this.notify('Impossibile salvare localmente la sessione di allenamento.'); } } }
  open() {
    let saved = null; try { saved = localStorage.getItem(STORE); } catch { /* Training still works for this tab. */ }
    try { this.state = restoreTrainingState(saved ? JSON.parse(saved) : null, this.getTuning()); } catch { this.state = makeTrainingState(this.getTuning()); }
    if (!saved) this.state = makeTrainingState(this.getTuning());
    this.dialog.showModal();
  }
  setup() {
    const $ = id => document.getElementById(id);
    $('pen-training-open').onclick = () => this.open(); $('training-close').onclick = () => this.dialog.close();
    $('training-start').onclick = () => { if (!this.state || this.state.stage === 'calibration' && !this.state.attempts) this.state = makeTrainingState(this.getTuning()); this.activeTuning = tuningForStage(this.state); this.suppressClose = true; this.dialog.close(); this.active = true; this.onStart(this.activeTuning); this.save(); this.show(); };
    $('training-finish').onclick = () => this.finish(); $('training-clear').onclick = () => this.onTrial(this.activeTuning, true);
    $('training-ratings').onclick = e => { const rating = e.target.closest('[data-rating]')?.dataset.rating; if (rating) this.rate(rating); };
    $('training-blind-ratings').onclick = e => { const answer = e.target.closest('[data-blind]')?.dataset.blind; if (answer) this.blind(answer); };
    $('training-reference').onclick = () => this.reference(); $('training-undo').onclick = () => this.undo();
    $('training-reset').onclick = () => { this.onReset(fromVector(this.state.initial)); this.notify('Configurazione iniziale ripristinata.'); };
    $('training-keep').onclick = () => { this.onKeep(fromVector(this.state.best)); this.notify('Configurazione migliore salvata per la lavagna.'); };
    $('training-end').onclick = () => this.end();
    this.dialog.addEventListener('close', () => { if (this.suppressClose) { this.suppressClose = false; return; } if (this.active) this.end(); });
  }
  applyStage() {
    const blind = this.state.stage.startsWith('blind'), rating = this.state.stage === 'rating' || this.state.stage === 'blind-rating';
    $('training-mode-bar').hidden = !this.active; $('training-stage').textContent = this.state.stage === 'calibration' ? 'Calibrazione iniziale' : blind ? 'Controllo periodico' : `Tentativo ${this.state.attempts + 1}`;
    $('training-attempt').textContent = `${this.state.attempts} valutazioni`;
    $('training-instruction').textContent = blind ? this.state.stage === 'blind-rating' ? 'Hai provato entrambe le configurazioni sulla lavagna.' : 'Scrivi la stessa frase o formula sulla lavagna.' : this.state.stage === 'calibration' ? 'Scrivi liberamente: questa è la configurazione di riferimento.' : rating ? 'Valuta la configurazione che hai appena provato sulla lavagna.' : 'Prova la configurazione sulla lavagna usando gli strumenti che preferisci.';
    $('training-rating').hidden = !rating; $('training-ratings').hidden = blind; $('training-blind-ratings').hidden = !blind;
    document.body.classList.toggle('training-rating', rating);
    $('training-question').textContent = blind ? 'Quale configurazione preferisci?' : 'Rispetto alla configurazione migliore confermata, com’è stata l’esperienza?';
    $('training-reference').hidden = this.state.stage !== 'trial'; $('training-undo').disabled = !this.state.history.length;
    $('training-finish').hidden = rating; $('training-clear').hidden = rating;
  }
  show() { this.applyStage(); }
  finish() {
    if (this.state.reference) { this.state.reference = false; this.state.stage = 'trial'; this.activeTuning = fromVector(this.state.candidate); this.onTrial(this.activeTuning, true); this.save(); this.notify('Configurazione candidata ripristinata.'); this.show(); return; }
    if (this.state.stage === 'calibration') { this.state.initial = toVector(this.activeTuning); this.state.best = [...this.state.initial]; this.state.attempts = 0; this.state.stage = 'trial'; generateCandidate(this.state); this.activeTuning = fromVector(this.state.candidate); this.onTrial(this.activeTuning, true); }
    else if (this.state.stage === 'trial') this.state.stage = 'rating';
    else if (this.state.stage === 'blind') { this.state.stage = 'blind-second'; this.activeTuning = fromVector((this.state.blindFirst === 'initial' ? 'best' : 'initial') === 'initial' ? this.state.initial : this.state.best); this.onTrial(this.activeTuning, true); }
    else if (this.state.stage === 'blind-second') this.state.stage = 'blind-rating';
    this.save(); this.show();
  }
  rate(value) { if (!rateCandidate(this.state, value)) return; this.state.reference = false; generateCandidate(this.state); this.activeTuning = fromVector(this.state.stage === 'blind' ? this.state.blindFirst === 'initial' ? this.state.initial : this.state.best : this.state.candidate); this.onTrial(this.activeTuning, true); this.save(); this.show(); }
  blind(answer) { this.state.history.push({ before: copy({ ...this.state }), rating: `blind:${answer}` }); const first = this.state.blindFirst, preference = answer === 'same' ? 'same' : (answer === 'first' ? first : first === 'initial' ? 'best' : 'initial'); this.state.blindPreference = preference; this.state.stage = 'trial'; this.state.blindFirst = null; generateCandidate(this.state); this.activeTuning = fromVector(this.state.candidate); this.onTrial(this.activeTuning, true); this.save(); this.show(); if (preference === 'initial') this.notify('Nel confronto hai preferito la configurazione iniziale: la migliore resta disponibile, senza applicarla automaticamente.'); }
  reference() { this.state.reference = !this.state.reference; this.activeTuning = fromVector(this.state.reference ? this.state.best : this.state.candidate); this.onTrial(this.activeTuning, true); this.notify(this.state.reference ? 'Scrivi con la configurazione di riferimento; poi premi “Ho finito”.' : 'Configurazione candidata ripristinata.'); }
  undo() { const last = this.state.history.at(-1); if (!undoTrainingRating(this.state)) return; this.state.stage = String(last?.rating).startsWith('blind:') ? 'blind-rating' : 'rating'; this.activeTuning = fromVector(this.state.candidate); this.save(); this.show(); }
  end() { if (!this.active) return; this.save(); this.active = false; $('training-mode-bar').hidden = true; this.onExit(); }
}
