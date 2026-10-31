// Shared, deterministic handwriting pipeline. The offline replay path and the
// live editor both feed the same processor; recorded samples remain untouched.
import { appendInkPoint } from './ink.js';
export const DEFAULT_INK_CONFIG = Object.freeze({
  filter: { enabled: true, type: 'one-euro', minCutoff: 12, beta: .045, window: 5, adaptiveStrength: .35, adaptiveSpeed: 900 },
  interpolation: { enabled: true, type: 'catmull-rom', tension: .5 },
  pressure: { enabled: true, type: 'filtered', gamma: 1, minWidth: .5, maxWidth: 2 },
  stabilization: { enabled: false, type: 'none', amount: .25, delayMs: 12 }
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
export function normalizeInkConfig(config = {}) {
  const d = DEFAULT_INK_CONFIG;
  return {
    filter: { ...d.filter, ...(config.filter || {}) }, interpolation: { ...d.interpolation, ...(config.interpolation || {}) },
    pressure: { ...d.pressure, ...(config.pressure || {}) }, stabilization: { ...d.stabilization, ...(config.stabilization || {}) }
  };
}
const alpha = (cutoff, dt) => { const f = Math.max(.01, cutoff); return 1 / (1 + 1 / (2 * Math.PI * f * Math.max(.001, dt))); };
const lerpPoint = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), p: mix(a.p, b.p, t), t: mix(a.t, b.t, t) });

export class InkProcessor {
  constructor(config = DEFAULT_INK_CONFIG, scale = 1) {
    this.config = normalizeInkConfig(config); this.scale = Math.max(.01, scale); this.reset();
  }
  reset() { this.lastRaw = null; this.lastFiltered = null; this.lastPressure = null; this.vx = 0; this.vy = 0; this.window = []; this.delay = []; this.lastTime = null; }
  sample(point, timestamp, final = false) {
    const c = this.config, time = Number.isFinite(timestamp) ? timestamp : (this.lastTime ?? 0) + 8;
    const raw = { x: point.x * this.scale, y: point.y * this.scale, p: clamp(Number.isFinite(point.p) ? point.p : .5, 0, 1), t: time };
    if (!this.lastRaw) { this.lastRaw = raw; this.lastFiltered = { ...raw }; this.lastPressure = raw.p; this.lastTime = time; this.delay.push(raw); return { ...point, p: this.pressure(raw.p, 0) }; }
    if (!final && time <= this.lastRaw.t) return null;
    const dt = clamp((time - this.lastRaw.t) / 1000, .001, .067), distance = Math.hypot(raw.x - this.lastRaw.x, raw.y - this.lastRaw.y);
    this.vx = mix(this.vx, (raw.x - this.lastRaw.x) / dt, alpha(10, dt)); this.vy = mix(this.vy, (raw.y - this.lastRaw.y) / dt, alpha(10, dt));
    const speed = Math.hypot(this.vx, this.vy); let pos = { ...raw };
    if (c.filter.enabled && c.filter.type !== 'none') {
      let a = 1;
      if (c.filter.type === 'one-euro') a = alpha(c.filter.minCutoff + c.filter.beta * speed, dt);
      else if (c.filter.type === 'moving-average') {
        this.window.push(raw); while (this.window.length > clamp(Math.round(c.filter.window), 1, 24)) this.window.shift();
        pos.x = this.window.reduce((s, p) => s + p.x, 0) / this.window.length; pos.y = this.window.reduce((s, p) => s + p.y, 0) / this.window.length;
      } else if (c.filter.type === 'adaptive') a = clamp(1 - c.filter.adaptiveStrength * (1 - Math.min(1, speed / Math.max(20, c.filter.adaptiveSpeed))), .08, 1);
      if (c.filter.type !== 'moving-average') { pos.x = mix(this.lastFiltered.x, raw.x, a); pos.y = mix(this.lastFiltered.y, raw.y, a); }
    }
    if (c.stabilization.enabled && c.stabilization.type === 'steady') {
      const a = clamp(1 - c.stabilization.amount * .92, .08, 1); pos.x = mix(this.lastFiltered.x, pos.x, a); pos.y = mix(this.lastFiltered.y, pos.y, a);
    } else if (c.stabilization.enabled && c.stabilization.type === 'delay') {
      this.delay.push(pos); const threshold = time - clamp(c.stabilization.delayMs, 0, 120);
      while (this.delay.length > 2 && this.delay[1].t <= threshold) this.delay.shift();
      const a = this.delay[0], b = this.delay[1] || a, f = b.t === a.t ? 0 : clamp((threshold - a.t) / (b.t - a.t), 0, 1); pos = lerpPoint(a, b, f);
      // Delay is a controlled visual trail, not lost input. Flush to the final
      // real sample on pen-up so stored handwriting reaches its true endpoint.
      if (final) pos = { ...this.delay.at(-1) };
    }
    if(final){pos.x=raw.x;pos.y=raw.y;}
    const p = this.pressure(final ? this.lastRaw.p : raw.p, dt);
    this.lastRaw = raw; this.lastFiltered = { ...pos, p }; this.lastPressure = p; this.lastTime = time;
    return { x: pos.x / this.scale, y: pos.y / this.scale, p };
  }
  pressure(value, dt) {
    const c = this.config.pressure; let p = clamp(value, 0, 1);
    if (c.enabled && c.type === 'filtered') { p = this.lastPressure == null ? p : mix(this.lastPressure, p, alpha(20, dt || .008)); }
    if (c.enabled && c.type === 'curve') p = Math.pow(p, clamp(c.gamma, .2, 3));
    return p;
  }
}
export function processInk(rawSamples, config = DEFAULT_INK_CONFIG, scale = 1) {
  const processor = new InkProcessor(config, scale), points = [];
  for (let i=0;i<rawSamples.length;i++) { const raw=rawSamples[i],final=raw.final===true,p=processor.sample(raw,raw.t,final);if(p)appendInkPoint(points,{...p,t:raw.t},scale,final); }
  return points;
}
export function interpolatePoints(points, mode = 'catmull-rom', tension = .5, spacing = 1) {
  if (points.length < 2 || mode === 'linear') return points.map(p => ({ ...p }));
  const output = [points[0]], k = clamp(tension, 0, 1);
  const addCubic = (a, b, c, d, strength) => {
    const c1 = { x: b.x + (c.x - a.x) * strength, y: b.y + (c.y - a.y) * strength, p: b.p + (c.p - a.p) * strength };
    const c2 = { x: c.x - (d.x - b.x) * strength, y: c.y - (d.y - b.y) * strength, p: c.p - (d.p - b.p) * strength };
    const n = Math.max(2, Math.ceil(Math.hypot(c.x-b.x,c.y-b.y) / Math.max(.5,spacing)));
    for (let i=1;i<=n;i++){const t=i/n,u=1-t;output.push({x:u*u*u*b.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*c.x,y:u*u*u*b.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*c.y,p:u*u*u*b.p+3*u*u*t*c1.p+3*u*t*t*c2.p+t*t*t*c.p,t:mix(b.t||0,c.t||0,t)});}
  };
  for (let i=0;i<points.length-1;i++) { const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)]; addCubic(a,b,c,d,mode==='catmull-rom' ? k/6 : k/3); }
  return output;
}
export function renderInk(ctx, points, config = DEFAULT_INK_CONFIG, color = '#253a36', baseWidth = 2) {
  if (!points?.length) return;
  const c=normalizeInkConfig(config), mode=c.interpolation.enabled?c.interpolation.type:'linear';
  const line=interpolatePoints(points, mode, c.interpolation.tension, Math.max(.5, baseWidth*.45));
  const widthScale=Math.max(.01,baseWidth/2), min=c.pressure.enabled?Math.min(c.pressure.minWidth,c.pressure.maxWidth)*widthScale:baseWidth, max=c.pressure.enabled?Math.max(c.pressure.minWidth,c.pressure.maxWidth)*widthScale:baseWidth;
  const widthAt=p=>c.pressure.enabled?clamp(min+(max-min)*clamp(p,0,1),.25,100):baseWidth;
  ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineCap='round';ctx.lineJoin='round';
  if(line.length===1){ctx.beginPath();ctx.arc(line[0].x,line[0].y,widthAt(line[0].p)/2,0,Math.PI*2);ctx.fill();}
  else {
    // A handful of pressure-width paths avoids issuing a Canvas stroke call
    // for every input sample while retaining useful pressure variation.
    const paths=new Map();
    for(let i=1;i<line.length;i++){const width=(widthAt(line[i-1].p)+widthAt(line[i].p))/2,bucket=Math.max(.25,Math.round(width*4)/4);let segments=paths.get(bucket);if(!segments){segments=[];paths.set(bucket,segments);}segments.push(line[i-1],line[i]);}
    for(const [width,segments] of paths){ctx.beginPath();ctx.lineWidth=width;for(let i=0;i<segments.length;i+=2){ctx.moveTo(segments[i].x,segments[i].y);ctx.lineTo(segments[i+1].x,segments[i+1].y);}ctx.stroke();}
  }
  ctx.restore();
}
