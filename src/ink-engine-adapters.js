import SignaturePad from '../vendor/signature_pad-5.1.4.js';
import { DEFAULT_INK_CONFIG, processInk, renderInk } from './ink-engine.js';

export const ENGINE_IDS = ['cosastudio', 'signature-pad', 'paperjs'];
export const ENGINE_LABELS = {
  cosastudio: 'CosaStudio',
  'signature-pad': 'Signature Pad',
  paperjs: 'Paper.js'
};
export const DEFAULT_ENGINE_CONFIGS = {
  'signature-pad': { dotSize: 0, minWidth: .5, maxWidth: 2.5, velocityFilterWeight: .7 },
  paperjs: { simplify: false, tolerance: 2.5, smoothing: 'none', strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' }
};
export const ENGINE_CONTROLS = {
  'signature-pad': [
    ['minWidth', 'Larghezza minima', .1, 8, .05, 'px'], ['maxWidth', 'Larghezza massima', .1, 12, .05, 'px'],
    ['dotSize', 'Dimensione punto', 0, 8, .05, 'px'], ['velocityFilterWeight', 'Peso filtro velocità', 0, 1, .01, '']
  ],
  paperjs: [
    ['simplify', 'Semplifica percorso', 'checkbox'], ['tolerance', 'Tolleranza simplify', 0, 8, .05, 'px'],
    ['smoothing', 'Path.smooth()', 'select', [['none', 'Nessuno'], ['asymmetric', 'Asimmetrico'], ['continuous', 'Continuo']]],
    ['strokeWidth', 'Larghezza tratto', .1, 12, .05, 'px'],
    ['strokeCap', 'Stroke cap', 'select', [['round', 'Round'], ['butt', 'Butt'], ['square', 'Square']]],
    ['strokeJoin', 'Stroke join', 'select', [['round', 'Round'], ['miter', 'Miter'], ['bevel', 'Bevel']]]
  ]
};

export function createEngineRenderer(engine, canvas, options, currentConfig, color, baseWidth, rasterRatio) {
  if (engine === 'cosastudio') return {
    renderStroke(stroke, processed = null) {
      const samples = stroke.samples || stroke;
      const t0 = performance.now();
      const points = processed?.points || processInk(samples, currentConfig || DEFAULT_INK_CONFIG, 1);
      const processMs = processed?.processMs ?? performance.now() - t0;
      const t1 = performance.now();
      const ctx = canvas.getContext('2d'); ctx.save(); ctx.scale(rasterRatio, rasterRatio); renderInk(ctx, points, currentConfig || DEFAULT_INK_CONFIG, color, baseWidth); ctx.restore();
      return { processMs, renderMs: performance.now() - t1 };
    }, dispose() {}
  };

  if (engine === 'signature-pad') {
    // Replay uses the package's public fromData() API. throttle/minDistance are
    // input-capture options and intentionally omitted: they cannot affect replay.
    const pad = new SignaturePad(canvas, {
      minWidth: options.minWidth, maxWidth: options.maxWidth, dotSize: options.dotSize,
      velocityFilterWeight: options.velocityFilterWeight, penColor: color,
      throttle: 0, minDistance: 0, backgroundColor: 'rgba(0,0,0,0)'
    });
    pad.off();
    return {
      renderStroke(stroke) {
        const samples = stroke.samples || stroke;
        const group = {
          penColor: color, minWidth: options.minWidth, maxWidth: options.maxWidth,
          dotSize: options.dotSize, velocityFilterWeight: options.velocityFilterWeight,
          compositeOperation: 'source-over',
          points: samples.map(p => ({ x: p.x * rasterRatio, y: p.y * rasterRatio, pressure: p.p, time: p.t }))
        };
        group.minWidth *= rasterRatio; group.maxWidth *= rasterRatio; group.dotSize = options.dotSize * rasterRatio;
        const t0 = performance.now(); pad.fromData([group], { clear: false });
        return { processMs: 0, renderMs: performance.now() - t0 };
      }, dispose() { pad.off(); }
    };
  }

  if (engine === 'paperjs') {
    const lib = globalThis.paper;
    if (!lib?.PaperScope) throw new Error('Paper.js non è stato caricato.');
    const scope = new lib.PaperScope(); scope.setup(canvas);
    return {
      renderStroke(stroke) {
        const samples = stroke.samples || stroke;
        const t0 = performance.now();
        const path = new scope.Path();
        path.strokeColor = new scope.Color(color); path.strokeWidth = options.strokeWidth * rasterRatio;
        path.strokeCap = options.strokeCap; path.strokeJoin = options.strokeJoin;
        for (const p of samples) path.add(new scope.Point(p.x * rasterRatio, p.y * rasterRatio));
        if (options.simplify && path.segments.length > 2) path.simplify(options.tolerance * rasterRatio);
        if (options.smoothing !== 'none' && path.segments.length > 2) path.smooth({ type: options.smoothing });
        const processMs = performance.now() - t0, t1 = performance.now();
        scope.view.update();
        return { processMs, renderMs: performance.now() - t1 };
      }, dispose() { scope.project?.remove(); }
    };
  }

  throw new Error(`Motore sconosciuto: ${engine}`);
}

