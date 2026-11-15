// Draws kbe objects (ui/engine/model.js) onto a 2D canvas context: shapes, paths, groups, gradients, shadows, clip paths
// and images. Original code. Text objects are not drawn yet. Usage: `await kbe.prepare(objects); kbe.render(ctx, objects)`.
(function () {
'use strict';
const kbe = globalThis.kbe;

// gradient coordinates are measured from the object's top-left corner; objects are drawn around their middle
function toLive(ctx, g, o) {
  const w = o.width, h = o.height, pct = g.gradientUnits === 'percentage', c = g.coords, ox = -w / 2 + g.offsetX, oy = -h / 2 + g.offsetY, sx = pct ? w : 1, sy = pct ? h : 1;
  const live = g.type === 'radial'
    ? ctx.createRadialGradient(c.x1 * sx + ox, c.y1 * sy + oy, c.r1 * (pct ? Math.max(w, h) : 1), c.x2 * sx + ox, c.y2 * sy + oy, c.r2 * (pct ? Math.max(w, h) : 1))
    : ctx.createLinearGradient(c.x1 * sx + ox, c.y1 * sy + oy, c.x2 * sx + ox, c.y2 * sy + oy);
  for (const s of g.colorStops) live.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color); // a stop's `opacity` is not drawn: Fabric 7.4 ignores it too, so saved designs look the same
  return live;
}
// the fillStyle for a paint; a gradient with a gradientTransform and a pattern also move the (already saved) context, as Fabric does
function style(ctx, paint, o) {
  if (!paint) return paint;
  if (paint.source !== undefined && paint.repeat !== undefined) { // pattern
    ctx.translate(-o.width / 2 + (paint.offsetX || 0), -o.height / 2 + (paint.offsetY || 0)); if (paint.patternTransform) ctx.transform(...paint.patternTransform);
    return ctx.createPattern(paint.source, paint.repeat) || 'transparent';
  }
  if (!paint.colorStops) return paint;
  if (!paint.gradientTransform) return toLive(ctx, paint, o);
  const c = paint.coords, live = paint.type === 'radial' ? ctx.createRadialGradient(c.x1, c.y1, c.r1, c.x2, c.y2, c.r2) : ctx.createLinearGradient(c.x1, c.y1, c.x2, c.y2);
  for (const s of paint.colorStops) live.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color);
  ctx.translate(-o.width / 2 + paint.offsetX, -o.height / 2 + paint.offsetY); if (paint.gradientUnits === 'percentage') ctx.scale(o.width, o.height);
  ctx.transform(...paint.gradientTransform); return live;
}

// the object's outline as the current path, around its middle; false when it has none
function outline(ctx, o) {
  const w = o.width, h = o.height, type = o.constructor.type;
  ctx.beginPath();
  if (type === 'Rect') {
    const rx = Math.min(o.rx || 0, w / 2), ry = Math.min(o.ry || o.rx || 0, h / 2), x = -w / 2, y = -h / 2, k = 0.5522847498;
    if (!rx && !ry) ctx.rect(x, y, w, h);
    else {
      ctx.moveTo(x + rx, y); ctx.lineTo(x + w - rx, y); ctx.bezierCurveTo(x + w - rx + k * rx, y, x + w, y + ry - k * ry, x + w, y + ry);
      ctx.lineTo(x + w, y + h - ry); ctx.bezierCurveTo(x + w, y + h - ry + k * ry, x + w - rx + k * rx, y + h, x + w - rx, y + h);
      ctx.lineTo(x + rx, y + h); ctx.bezierCurveTo(x + rx - k * rx, y + h, x, y + h - ry + k * ry, x, y + h - ry);
      ctx.lineTo(x, y + ry); ctx.bezierCurveTo(x, y + ry - k * ry, x + rx - k * rx, y, x + rx, y); ctx.closePath();
    }
  } else if (type === 'Circle') {
    const full = Math.abs(o.endAngle - o.startAngle) >= 360;
    ctx.arc(0, 0, o.radius, o.startAngle * Math.PI / 180, o.endAngle * Math.PI / 180, o.counterClockwise); if (full) ctx.closePath();
  } else if (type === 'Ellipse') {
    if (!o.rx) return false;
    ctx.save(); ctx.transform(1, 0, 0, o.ry / o.rx, 0, 0); ctx.arc(0, 0, o.rx, 0, 2 * Math.PI); ctx.restore(); ctx.closePath();
  } else if (type === 'Triangle') { ctx.moveTo(-w / 2, h / 2); ctx.lineTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.closePath(); }
  else if (type === 'Line') { ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); }
  else if (type === 'Polygon' || type === 'Polyline') {
    if (!o.points.length) return false;
    o.points.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x - o.pathOffset.x, p.y - o.pathOffset.y)); if (type === 'Polygon') ctx.closePath();
  } else if (type === 'Path') {
    if (!o.path.length) return false;
    const { x: dx, y: dy } = o.pathOffset;
    for (const [c, ...v] of o.path) {
      if (c === 'M') ctx.moveTo(v[0] - dx, v[1] - dy); else if (c === 'L') ctx.lineTo(v[0] - dx, v[1] - dy);
      else if (c === 'C') ctx.bezierCurveTo(v[0] - dx, v[1] - dy, v[2] - dx, v[3] - dy, v[4] - dx, v[5] - dy);
      else if (c === 'Q') ctx.quadraticCurveTo(v[0] - dx, v[1] - dy, v[2] - dx, v[3] - dy); else if (c === 'Z') ctx.closePath();
    }
  } else return false;
  return true;
}

function setShadow(ctx, o, scaling, zoom) {
  const s = o.shadow; if (!s) return;
  const sc = s.nonScaling ? { x: 1, y: 1 } : scaling;
  ctx.shadowColor = s.color; ctx.shadowBlur = s.blur * 2 * zoom * (sc.x + sc.y) / 4; ctx.shadowOffsetX = s.offsetX * zoom * sc.x; ctx.shadowOffsetY = s.offsetY * zoom * sc.y;
}
const noShadow = ctx => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; };

function paint(ctx, o, scaling, zoom, first) {
  if (first === 'fill') { fill(ctx, o); stroke(ctx, o, scaling); } else { stroke(ctx, o, scaling); fill(ctx, o); }
}
function fill(ctx, o) {
  if (!o.fill || o.constructor.type === 'Line') return;
  ctx.save();
  const g = o.fill.colorStops && o.fill;
  if (g && g.type === 'radial' && g.gradientUnits === 'percentage' && !g.gradientTransform) { // percentages of width and of height: an oval gradient, drawn by stretching a round one
    const c = g.coords, live = ctx.createRadialGradient(c.x1, c.y1, c.r1, c.x2, c.y2, c.r2);
    for (const st of g.colorStops) live.addColorStop(Math.min(1, Math.max(0, st.offset)), st.color);
    ctx.translate(-o.width / 2 + g.offsetX, -o.height / 2 + g.offsetY); ctx.scale(o.width, o.height); ctx.fillStyle = live;
  } else ctx.fillStyle = style(ctx, o.fill, o);
  ctx.fill(o.fillRule); ctx.restore();
}
function stroke(ctx, o, scaling) {
  if (!o.stroke || !o.strokeWidth) return;
  if (o.shadow && !o.shadow.affectStroke) noShadow(ctx);
  ctx.save();
  if (o.strokeUniform) ctx.scale(1 / Math.abs(o.scaleX), 1 / Math.abs(o.scaleY));
  ctx.lineWidth = o.strokeWidth; ctx.lineCap = o.strokeLineCap; ctx.lineJoin = o.strokeLineJoin; ctx.miterLimit = o.strokeMiterLimit;
  if (o.strokeDashArray?.length) { ctx.setLineDash(o.strokeDashArray.length % 2 ? [...o.strokeDashArray, ...o.strokeDashArray] : o.strokeDashArray); ctx.lineDashOffset = o.strokeDashOffset; }
  ctx.strokeStyle = style(ctx, o.stroke, o); ctx.stroke(); ctx.restore();
}

// the object's own picture, in the transform already set on ctx
const watched = o => !!o._handlers?.['before:render']?.length; // something draws before the object itself (crop mode's faint whole picture)
function body(ctx, o, scaling, zoom, root, withShadow) {
  if (watched(o)) { ctx.save(); o.fire('before:render', { ctx }); ctx.restore(); } // crop mode draws the whole picture behind the cropped part
  if (o.backgroundColor) { ctx.fillStyle = o.backgroundColor; ctx.fillRect(-o.width / 2, -o.height / 2, o.width, o.height); }
  if (o.constructor.type === 'Group') { for (const c of o._objects) draw(ctx, c, scaling, zoom, root, undefined, true); return; }
  if (o._render) { ctx.save(); if (withShadow && o._shadowFirst) setShadow(ctx, o, scaling, zoom); o._render(ctx); ctx.restore(); return; } // text and pictures draw themselves
  if (o.raw) { // saved image: crop and draw; text and other saved types are not drawn yet
    if (o.raw.type !== 'Image' || !o.element) return;
    if (withShadow) setShadow(ctx, o, scaling, zoom);
    ctx.drawImage(o.element, o.raw.cropX || 0, o.raw.cropY || 0, o.width, o.height, -o.width / 2, -o.height / 2, o.width, o.height); return;
  }
  if (!outline(ctx, o)) return;
  if (withShadow) setShadow(ctx, o, scaling, zoom);
  paint(ctx, o, scaling, zoom, o.paintFirst);
}


// How far, in device pixels, drawing by n and what it holds can run past its box: wide strokes and mitred corners, letters that lean out,
// and the shadows of nested objects (a top-level object's own shadow is added when the layer is laid on, so it is not counted here).
function overhang(n, k, nested) {
  let r = 0;
  if (n.strokeWidth && n.stroke) r = n.strokeWidth * k * ((n.strokeLineJoin || 'miter') === 'miter' ? (n.strokeMiterLimit || 4) / 2 : 0.5) + 2;
  if (n.fontSize) r = Math.max(r, (n.fontSize * 1.2 + Math.abs(n.charSpacing || 0) / 1000 * n.fontSize) * k); // leaning letters, wide spacing, curved text
  if (nested && n.shadow) { const s = n.shadow; r = Math.max(r, (Math.abs(s.offsetX) + Math.abs(s.offsetY) + s.blur * 3) * k + 2); }
  for (const c of n._objects || []) r = Math.max(r, overhang(c, k * Math.max(Math.abs(c.scaleX), Math.abs(c.scaleY)), true));
  return r;
}
const MAX_REACH = 2048; // a shadow's reach off the page never grows a layer past this many device pixels
function layerBox(ctx, o, m, scaling, zoom) { // [x, y, width, height] in device pixels, or null when nothing of the object can show
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (watched(o)) return [0, 0, W, H]; // crop mode draws outside the box
  const k = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) || 1, pad = Math.ceil(overhang(o, k, false)) + 4;
  const hw = o.width / 2, hh = o.height / 2, xs = [], ys = [];
  for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) { const p = m.transformPoint(new DOMPoint(x, y)); xs.push(p.x); ys.push(p.y); }
  let reach = 0; if (o.shadow) { const s = o.shadow, sc = s.nonScaling ? { x: 1, y: 1 } : scaling; reach = Math.min(MAX_REACH, Math.ceil(Math.abs(s.offsetX * zoom * sc.x) + Math.abs(s.offsetY * zoom * sc.y) + 2 * s.blur * 2 * zoom * (sc.x + sc.y) / 4)); }
  const x0 = Math.max(Math.floor(Math.min(...xs) - pad), -reach), y0 = Math.max(Math.floor(Math.min(...ys) - pad), -reach);
  const x1 = Math.min(Math.ceil(Math.max(...xs) + pad), W + reach), y1 = Math.min(Math.ceil(Math.max(...ys) + pad), H + reach);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

// Layers are reused (drawing allocates none per object per frame): a layer is taken at least as big as asked, cleared, and given back when done.
const layers = [];
function takeLayer(w, h) {
  let i = layers.findIndex(l => l.width >= w && l.height >= h), layer = i >= 0 ? layers.splice(i, 1)[0] : null;
  if (!layer) { layer = document.createElement('canvas'); layer.width = Math.max(w, 64); layer.height = Math.max(h, 64); if (layers.length > 8) layers.shift(); }
  const lc = layer.getContext('2d', { willReadFrequently: false }); lc.save(); lc.setTransform(1, 0, 0, 1, 0, 0); lc.beginPath(); lc.rect(0, 0, w, h); lc.clip(); lc.clearRect(0, 0, w, h); return layer; // only the asked part is used and cleared
}
function draw(ctx, o, parentScaling, zoom, root, operation, nested) {
  if (!o.visible) return;
  const scaling = { x: parentScaling.x * Math.abs(o.scaleX), y: parentScaling.y * Math.abs(o.scaleY) };
  ctx.save();
  ctx.globalAlpha *= o.opacity; ctx.globalCompositeOperation = operation || o.globalCompositeOperation;
  ctx.transform(...o.calcOwnMatrix());
  // like Fabric's object cache: a top-level object is drawn whole at full strength, then laid on with its opacity and shadow
  const layered = o.clipPath || !nested;
  if (!layered) body(ctx, o, scaling, zoom, root, true);
  else { // drawn apart, cut by the clip, then laid on with the shadow; the layer is only as big as the object (and what hangs over it)
    const m = ctx.getTransform(), box = layerBox(ctx, o, m, scaling, zoom); if (!box) { ctx.restore(); return; }
    const [x0, y0, w, h] = box, shift = new DOMMatrix().translate(-x0, -y0), moved = shift.multiply(m), rootHere = shift.multiply(root);
    const layer = takeLayer(w, h), lc = layer.getContext('2d');
    try {
      lc.setTransform(moved); body(lc, o, scaling, zoom, rootHere, false);
      const clip = o.clipPath;
      if (clip) {
        lc.save(); if (clip.absolutePositioned) lc.setTransform(rootHere);
        draw(lc, clip, { x: 1, y: 1 }, zoom, rootHere, clip.inverted ? 'destination-out' : 'destination-in', true); lc.restore();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); setShadow(ctx, o, scaling, zoom); ctx.drawImage(layer, 0, 0, w, h, x0, y0, w, h);
    } finally { lc.restore(); layers.push(layer); }
  }
  ctx.restore();
}

// load the pictures that images need; call before render
async function prepare(objects) {
  const jobs = [];
  const walk = o => {
    if (o.raw?.type === 'Image' && o.raw.src && !o.element) jobs.push((async () => { const img = new Image(); img.src = o.raw.src; await img.decode(); o.element = img; })());
    for (const c of o._objects || []) walk(c);
    if (o.clipPath) walk(o.clipPath);
  };
  objects.forEach(walk); await Promise.all(jobs);
}
function render(ctx, objects, { zoom = 1, scaling = { x: 1, y: 1 }, root = ctx.getTransform() } = {}) { // scaling: the size of the group the objects sit in; root: the page's transform, for clips that stay put
  for (const o of objects) draw(ctx, o, scaling, zoom, root);
}
kbe.prepare = prepare; kbe.render = render; kbe.gradientFor = toLive;
// the page: background first, then every object in order
kbe.StaticCanvas.prototype.renderTo = function (ctx, options) {
  const bg = this.backgroundColor;
  if (bg) { ctx.save(); ctx.fillStyle = bg.colorStops ? toLive(ctx, bg, { width: this.width, height: this.height }) : bg; if (bg.colorStops) ctx.translate(this.width / 2, this.height / 2); ctx.fillRect(bg.colorStops ? -this.width / 2 : 0, bg.colorStops ? -this.height / 2 : 0, this.width, this.height); ctx.restore(); }
  render(ctx, this._objects, options);
};
})();
