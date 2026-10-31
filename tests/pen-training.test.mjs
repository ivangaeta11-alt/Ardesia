import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PEN_TUNING, PEN_TUNING_RANGES, normalizePenTuning, StrokeInput } from '../src/ink.js';
import { makeTrainingState, generateCandidate, rateCandidate, undoTrainingRating, restoreTrainingState } from '../src/pen-training.js';

test('tuning defaults preserve the current filter and parameters affect processed samples', () => {
  const samples = [{ x: 0, y: 0, p: .4, t: 0 }, { x: 18, y: 5, p: .9, t: 16 }, { x: 38, y: 8, p: .3, t: 32 }];
  const run = tuning => { const input = new StrokeInput('natural', 1, tuning); return samples.map(s => input.sample(s, s.t, s.t === 32)); };
  assert.deepEqual(run(DEFAULT_PEN_TUNING), run({}));
  assert.notDeepEqual(run(DEFAULT_PEN_TUNING), run({ ...DEFAULT_PEN_TUNING, beta: .1, minCutoff: 6 }));
});

test('candidate perturbations are bounded, distinct and never produce invalid values', () => {
  const state = makeTrainingState();
  generateCandidate(state, () => .99);
  assert.ok(state.candidate.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
  assert.ok(Number.isFinite(state.eta) && state.eta >= .035 && state.eta <= .24);
  assert.ok(Math.hypot(...state.candidate.map((x, i) => x - state.best[i])) > .03);
  const tuned = normalizePenTuning(Object.fromEntries(Object.keys(PEN_TUNING_RANGES).map(key => [key, NaN])));
  assert.deepEqual(tuned, DEFAULT_PEN_TUNING);
});

test('better updates the best; same and worse preserve it; undo restores the prior state', () => {
  const state = makeTrainingState(); generateCandidate(state, () => .8); state.stage = 'rating';
  const candidate = [...state.candidate]; rateCandidate(state, 'better'); assert.deepEqual(state.best, candidate);
  generateCandidate(state, () => .1); state.stage = 'rating'; const best = [...state.best]; rateCandidate(state, 'worse'); assert.deepEqual(state.best, best);
  assert.equal(undoTrainingRating(state), true); assert.equal(state.stage, 'rating');
});

test('session persistence accepts valid state and rejects NaN or out-of-range vectors', () => {
  const state = makeTrainingState(); generateCandidate(state, () => .7); state.stage = 'trial';
  assert.deepEqual(restoreTrainingState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(restoreTrainingState({ ...state, best: [NaN] }).best.length, 6);
});
