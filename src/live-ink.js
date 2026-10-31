import { INK_VERSION, stableStrokePiece, strokeTailPiece } from './ink.js';
import { PAGE_W, PAGE_H, drawObject } from './core.js';
import { normalizeInkConfig, renderInk } from './ink-engine.js';

export const unionBounds = (a, b) => !a ? b && { ...b } : !b ? { ...a } : ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });
const intersects = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
const CELL = 32;
function* cells(bounds) {
  for (let y = Math.floor(bounds.top / CELL); y <= Math.floor(bounds.bottom / CELL); y++)
    for (let x = Math.floor(bounds.left / CELL); x <= Math.floor(bounds.right / CELL); x++) yield `${x}:${y}`;
}

// The active stroke stays in one transparent composited canvas. Repaint only
// the union of the previous tail, the new pieces, and the current tail.
// A spatial index includes older crossings in that region, so clipping/clearing
// cannot erase them. Other tools retain their canonical full-stroke renderer.
export class LiveInkRenderer {
  constructor(ctx, Path = globalThis.Path2D) { this.ctx = ctx; this.Path = Path; this.sx = 1; this.sy = 1; this.reset(); }
  reset() { this.object = null; this.source = null; this.pieces = []; this.grid = new Map(); this.tailBounds = null; this.painted = null; this.customBounds = null; this.count = 0; }
  setScale(x, y) { this.clear(); this.sx = x; this.sy = y; }
  align(bounds) {
    if (!bounds) return null;
    const left = Math.max(0, Math.floor(bounds.left * this.sx - 2) / this.sx), top = Math.max(0, Math.floor(bounds.top * this.sy - 2) / this.sy);
    const right = Math.min(PAGE_W, Math.ceil(bounds.right * this.sx + 2) / this.sx), bottom = Math.min(PAGE_H, Math.ceil(bounds.bottom * this.sy + 2) / this.sy);
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }
  clear() {
    const bounds = this.align(this.painted);
    if (bounds) { this.ctx.save(); this.ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0); this.ctx.clearRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); this.ctx.restore(); }
    this.reset();
  }
  add(piece) {
    const index = this.pieces.push(piece) - 1;
    for (const cell of cells(piece.bounds)) { if (!this.grid.has(cell)) this.grid.set(cell, []); this.grid.get(cell).push(index); }
  }
  query(bounds) {
    const indexes = new Set(); for (const cell of cells(bounds)) for (const index of this.grid.get(cell) || []) indexes.add(index);
    return [...indexes].filter(index => intersects(this.pieces[index].bounds, bounds)).sort((a, b) => a - b).map(index => this.pieces[index]);
  }
  render(object, preview = []) {
    if (!object) { this.clear(); return { pieces: 0, area: 0 }; }
    if (object !== this.object || object.points !== this.source || this.count > object.points.length - 1) { this.clear(); this.object = object; this.source = object.points; }
    if (object.inkConfig || object.inkEngine) {
      const points = preview.length ? [...object.points, ...preview] : object.points;
      const pad = Math.max(object.size * 8, object.engineConfig?.maxWidth || 0, object.engineConfig?.size || 0, normalizeInkConfig(object.inkConfig || {}).pressure.maxWidth * object.size / 2) * 2 + 2;
      let next=null;
      if(points.length){let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const p of points){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}next={left:left-pad,top:top-pad,right:right+pad,bottom:bottom+pad};}
      const dirty = unionBounds(this.customBounds, next), bounds = this.align(dirty);
      this.customBounds = next; this.painted = unionBounds(this.painted, dirty);
      if (!bounds) return { pieces: 0, area: 0 };
      const ctx=this.ctx,width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;
      ctx.save();ctx.setTransform(this.sx,0,0,this.sy,0,0);ctx.beginPath();ctx.rect(bounds.left,bounds.top,width,height);ctx.clip();ctx.clearRect(bounds.left,bounds.top,width,height);
      if (object.inkEngine) drawObject(ctx, { ...object, rawPoints: [...(object.rawPoints || []), ...preview.map(p => ({ ...p, t: p.t || performance.now(), final: false }))] });
      else renderInk(ctx, points, object.inkConfig, object.color, object.size);
      ctx.restore();
      return { pieces: points.length, area: width*height };
    }
    if (object.inkVersion !== INK_VERSION || object.type !== 'pen') {
      this.clear(); this.ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0); drawObject(this.ctx, object);
      this.painted = { left: 0, top: 0, right: PAGE_W, bottom: PAGE_H }; return { pieces: 1, area: PAGE_W * PAGE_H };
    }
    let dirty = this.tailBounds;
    for (let i = this.count; i < object.points.length - 1; i++) {
      const piece = stableStrokePiece(object, i, this.Path); this.add(piece); dirty = unionBounds(dirty, piece.bounds); this.count++;
    }
    const tail = strokeTailPiece(object, preview, this.Path);
    dirty = unionBounds(dirty, tail.bounds); this.tailBounds = tail.bounds; this.painted = unionBounds(this.painted, dirty);
    const bounds = this.align(dirty);
    if (!bounds) return { pieces: 0, area: 0 };
    // Neighbouring geometry can contribute antialias coverage across the clip
    // boundary even when its exact bounds do not intersect the cleared pixels.
    const sampleBounds = { left: bounds.left - 2 / this.sx, top: bounds.top - 2 / this.sy, right: bounds.right + 2 / this.sx, bottom: bounds.bottom + 2 / this.sy };
    const pieces = this.query(sampleBounds), path = new this.Path();
    for (const piece of pieces) path.addPath(piece.path);
    path.addPath(tail.path);
    const ctx = this.ctx, width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
    ctx.save(); ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    ctx.beginPath(); ctx.rect(bounds.left, bounds.top, width, height); ctx.clip();
    ctx.clearRect(bounds.left, bounds.top, width, height);
    ctx.fillStyle = object.color; ctx.strokeStyle = object.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fill(path);
    ctx.restore();
    return { pieces: pieces.length + 1, area: width * height };
  }
}
