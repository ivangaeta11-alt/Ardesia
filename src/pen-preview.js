const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const lerpPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// These samples exist only for presentation. The caller's confirmed points,
// stroke history, exports and IndexedDB never receive extrapolated coordinates.
export class PenPreview {
  constructor(scale = 1) { this.scale = Math.max(.01, scale); this.samples = []; this.predicted = []; }
  add(point, time) {
    if (!Number.isFinite(time) || ![point.x, point.y, point.p].every(Number.isFinite)) return;
    if (this.samples.length && time <= this.samples.at(-1).t) return;
    this.samples.push({ ...point, t: time }); if (this.samples.length > 4) this.samples.shift();
    this.predicted = [];
  }
  browserPrediction(points, time) {
    const last = this.samples.at(-1); if (!last || time < last.t) return;
    this.predicted = points.filter(p => [p.x, p.y, p.t].every(Number.isFinite) && p.t > last.t && p.t <= last.t + 24).sort((a, b) => a.t - b.t).map(p => ({ ...p }));
  }
  points(confirmed, now) {
    const last = this.samples.at(-1); if (!last || !confirmed) return [];
    // Catch up to actual contact first. Limit the bridge if a driver jumps.
    const gap = distance(confirmed, last) * this.scale;
    const raw = gap > 12 ? lerpPoint(confirmed, last, 12 / gap) : last;
    const preview = gap > .1 ? [{ x: raw.x, y: raw.y, p: confirmed.p }] : [];
    if (this.samples.length < 3 || now - last.t > 24 || now < last.t || last.p < .03) return preview;
    const previous = this.samples.at(-2), before = this.samples.at(-3);
    const dt = last.t - previous.t, olderDt = previous.t - before.t;
    if (dt < .2 || dt > 25 || olderDt < .2 || olderDt > 25) return preview;
    const vx = (last.x - previous.x) / dt, vy = (last.y - previous.y) / dt;
    const ox = (previous.x - before.x) / olderDt, oy = (previous.y - before.y) / olderDt;
    const speed = Math.hypot(vx, vy), olderSpeed = Math.hypot(ox, oy);
    // Suppress extrapolation on stops, turns and reversals rather than drawing
    // hooks into small letters. A straight fallback is deliberately shorter.
    const alignment = speed && olderSpeed ? (vx * ox + vy * oy) / (speed * olderSpeed) : 0;
    if (speed * this.scale < .04 || alignment < .8 || speed < olderSpeed * .6 || gap > 12) return preview;
    let ahead = null, previousPrediction = last;
    const targetTime = last.t + 8;
    for (const prediction of this.predicted) {
      if (prediction.t >= targetTime) { ahead = lerpPoint(previousPrediction, prediction, (targetTime - previousPrediction.t) / (prediction.t - previousPrediction.t)); break; }
      previousPrediction = prediction;
    }
    if (!ahead && previousPrediction !== last) ahead = previousPrediction;
    if (!ahead) ahead = { x: last.x + vx * 6, y: last.y + vy * 6 };
    const length = distance(last, ahead) * this.scale;
    if (length < .1 || (ahead.x - last.x) * vx + (ahead.y - last.y) * vy <= 0) return preview;
    if (length > 8) ahead = lerpPoint(last, ahead, 8 / length);
    preview.push({ x: clamp(ahead.x, 0, 794), y: clamp(ahead.y, 0, 1123), p: confirmed.p });
    return preview;
  }
}
