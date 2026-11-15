// What the app needs on top of the core engine: small object and canvas helpers, snapping guides (kbe.AligningGuidelines) and the
// picture crop mode (kbe.enterCropMode). Original code written from how the app uses them; needs model.js ... image.js.
(function () {
'use strict';
const kbe = globalThis.kbe, { Point, FabricObject, Group, Canvas, Control, FabricImage } = kbe, U = kbe.util, { internal } = kbe;
const { anchored, withEvent, scaleCursor, rad } = internal;
const P = FabricObject.prototype, mul = U.multiplyTransformMatrices, inv = U.invertTransform;
// the pointer measured from an origin of the object along its own axes, less the handle's offset and the padding
internal.getLocalPoint = (tr, ox, oy, x, y) => {
  const t = tr.target, c = t.controls[tr.corner], pad = t.padding / (t.canvas ? t.canvas.getZoom() : 1), p = t.normalizePoint(new Point(x, y), ox, oy);
  if (p.x >= pad) p.x -= pad; if (p.x <= -pad) p.x += pad; if (p.y >= pad) p.y -= pad; if (p.y <= -pad) p.y += pad;
  p.x -= c.offsetX; p.y -= c.offsetY; return p;
};

// ---- small helpers the app and the tools below call
Point.prototype.scalarDivide = function (n) { return new Point(this.x / n, this.y / n); };
Point.prototype.scalarSubtract = function (n) { return new Point(this.x - n, this.y - n); };
P.once = function (name, fn) { const f = ev => { this.off(name, f); fn.call(this, ev); }; return this.on(name, f); };
P.getViewportTransform = function () { return this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0]; };
P.isControlVisible = function (key) { const c = this.controls[key]; return !!c && c.getVisibility(this, key); };
P.setXY = function (p, ox = this.originX, oy = this.originY) { return this.setPositionByOrigin(this.group ? new Point(p).transform(inv(this.group.calcTransformMatrix())) : p, ox, oy); };
P.setRelativeXY = function (p, ox = this.originX, oy = this.originY) { return this.setPositionByOrigin(p, ox, oy); };
P.isOnScreen = function () { // does any part of the box fall inside the visible part of the page
  const c = this.canvas; if (!c) return false;
  const v = inv(c.viewportTransform), a = new Point(0, 0).transform(v), b = new Point(c.width, c.height).transform(v);
  return this.intersectsWithRect(a, b) || this.isContainedWithinRect(a, b);
};
P.calcACoords = function () { const [tl, tr, br, bl] = this.getCoords(); return { tl, tr, br, bl }; };
const SC = kbe.StaticCanvas;
P.rotate = function (angle) { const c = this.getCenterPoint(); this.angle = angle; if (this.centeredRotation) this.setCenterPoint(c); return this; };
SC.prototype.once = P.once;
// a page without screen controls: draws itself onto its own element and exports pictures (PNG/JPEG data URLs, a canvas)
SC.prototype.getWidth = function () { return this.width; };
SC.prototype.getHeight = function () { return this.height; };
SC.prototype.getContext = function () { return this.element?.getContext('2d'); };
SC.prototype.getZoom = function () { return this.viewportTransform[0]; };
SC.prototype.setDimensions = function (dim) { if (dim.width !== undefined) this.width = dim.width; if (dim.height !== undefined) this.height = dim.height; if (this.element) { this.element.width = this.width; this.element.height = this.height; } return this; };
SC.prototype.dispose = function () { this._disposed = true; if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; for (const o of this._objects) o.canvas = undefined; this._objects = []; };
SC.prototype.toCanvasElement = function (multiplier = 1, { left = 0, top = 0, width = this.width, height = this.height } = {}) {
  const c = document.createElement('canvas'); c.width = Math.max(1, width * multiplier); c.height = Math.max(1, height * multiplier); // a fractional size is cut down, as Fabric's is
  const ctx = c.getContext('2d'); ctx.setTransform(multiplier, 0, 0, multiplier, -left * multiplier, -top * multiplier); this.renderTo(ctx, { zoom: multiplier }); return c;
};
SC.prototype.toDataURL = function ({ format = 'png', quality = 1, multiplier = 1, enableRetinaScaling = false, left, top, width, height } = {}) {
  const m = multiplier * (enableRetinaScaling ? globalThis.devicePixelRatio || 1 : 1);
  return this.toCanvasElement(m, { left, top, width, height }).toDataURL('image/' + format, quality);
};
// groups: take the children out (they keep their place on the page) and the small list helpers
Group.prototype._restoreChildren = kbe.ActiveSelection.prototype._restoreChildren;
Group.prototype.removeAll = function () { const kids = [...this._objects]; this._restoreChildren(); this._objects = []; return kids; };
Group.prototype.size = function () { return this._objects.length; };
Group.prototype.contains = function (o) { return this._objects.includes(o); };
Group.prototype.item = function (i) { return this._objects[i]; };
kbe.Gradient.prototype.toLive = function (ctx, owner) { return kbe.gradientFor(ctx, this, owner); }; // a gradient as a canvas fill, for code that paints text itself
Canvas.prototype.forEachObject = function (fn) { this._objects.forEach(fn); };
Canvas.prototype.getTopContext = function () { return this.contextTop; };

// ---- snapping guides: while an object moves or is resized its edges and centre jump onto those of its neighbours (within 4 screen pixels)
// and a red line with a cross at each end is drawn to the neighbour
const CORNER_ORIGINS = [['left', 'top'], ['right', 'top'], ['right', 'bottom'], ['left', 'bottom'], ['center', 'center']];
const CONTRARY = { tl: ['right', 'bottom'], tr: ['left', 'bottom'], br: ['left', 'top'], bl: ['right', 'top'], mt: ['center', 'bottom'], mr: ['left', 'center'], mb: ['center', 'top'], ml: ['right', 'center'] };
function nearest(point, list, axis) { // the closest value on one axis, and everything at that distance
  let best = Infinity, hits = [];
  for (const q of list) { const d = Math.abs(point[axis] - q[axis]); if (d < best) { best = d; hits = []; } if (d === best) hits.push(q); }
  return { dis: best, arr: hits };
}
function pointsOf(o) { const c = o.getCoords(); c.push(o.getCenterPoint()); return c; }
function neighbours(target, onScreen) { // objects on the page that count as snap targets: visible, on screen, not the moving ones; groups count by their children
  const out = new Set(), canvas = target.canvas; if (!canvas) return out;
  const moving = target instanceof kbe.ActiveSelection ? target.getObjects() : [target];
  const kids = (set, g) => { for (const k of g.getObjects()) if (k.visible) k.constructor === Group ? kids(set, k) : set.add(k); };
  canvas.forEachObject(o => { if (o.visible && onScreen(o)) o.constructor === Group ? kids(out, o) : out.add(o); });
  const drop = list => { for (const o of list) o.constructor === Group ? drop(o.getObjects()) : out.delete(o); }; drop(moving);
  return out;
}
class AligningGuidelines {
  constructor(canvas, options = {}) {
    Object.assign(this, { canvas, horizontalLines: new Map(), verticalLines: new Map(), onlyDrawPoint: false, xSize: 2.4, lineDash: undefined, margin: 4, width: 1, color: 'rgba(255,0,0,0.9)', closeVLine: false, closeHLine: false }, options);
    this.handlers = { 'mouse:up': () => this.mouseUp(), 'object:resizing': e => this.scalingOrResizing(e), 'object:scaling': e => this.scalingOrResizing(e), 'object:moving': e => this.moving(e), 'before:render': () => canvas.clearContext(canvas.contextTop), 'after:render': () => this.afterRender() };
    for (const [n, f] of Object.entries(this.handlers)) canvas.on(n, f);
  }
  dispose() { for (const [n, f] of Object.entries(this.handlers)) this.canvas.off(n, f); }
  _candidates(target) {
    const c = this.canvas, v = inv(c.viewportTransform), a = new Point(0, 0).transform(v), b = new Point(c.width, c.height).transform(v), list = []; // the visible part of the page, once per event
    for (const o of neighbours(target, o => o.intersectsWithRect(a, b) || o.isContainedWithinRect(a, b))) list.push(...pointsOf(o));
    return list;
  }
  _add(lines, l) { lines.set(l.origin.x + ',' + l.origin.y + '|' + l.target.x + ',' + l.target.y, l); }
  mouseUp() { this.verticalLines.clear(); this.horizontalLines.clear(); this.canvas.requestRenderAll(); }
  // moving: shift the object so its nearest corner or centre lines up with a neighbour's, per axis
  _snapMove(target, points, axis) {
    const mine = pointsOf(target), found = mine.map(p => nearest(p, points, axis)), best = Math.min(...found.map(f => f.dis)), lines = [];
    if (best > this.margin / this.canvas.getZoom()) return lines;
    let shifted = false;
    mine.forEach((p, i) => {
      if (found[i].dis !== best) return;
      for (const t of found[i].arr) lines.push({ origin: p, target: t });
      if (shifted) return; shifted = true;
      const delta = found[i].arr[0][axis] - p[axis]; mine.forEach(q => { q[axis] += delta; }); target.setXY(p, ...CORNER_ORIGINS[i]); target.setCoords();
    });
    return lines;
  }
  moving({ target }) {
    target.setCoords(); this.onlyDrawPoint = false; this.verticalLines.clear(); this.horizontalLines.clear();
    const points = this._candidates(target);
    for (const l of this._snapMove(target, points, 'x')) this._add(this.verticalLines, l);
    for (const l of this._snapMove(target, points, 'y')) this._add(this.horizontalLines, l);
  }
  // resizing: the handle being dragged jumps onto a neighbour's line and the opposite side stays put
  _pointMap(o) { const t = o.getCoords(), mid = (a, b) => a.add(b).scalarDivide(2); return { tl: t[0], tr: t[1], br: t[2], bl: t[3], mt: mid(t[0], t[1]), mr: mid(t[1], t[2]), mb: mid(t[2], t[3]), ml: mid(t[3], t[0]) }; }
  _contraryMap(o) { const a = o.calcACoords(), mid = (p, q) => p.add(q).scalarDivide(2); return { tl: a.br, tr: a.bl, br: a.tl, bl: a.tr, mt: mid(a.br, a.bl), mr: mid(a.bl, a.tl), mb: mid(a.tl, a.tr), ml: mid(a.tr, a.br) }; }
  _snapSize(g, axis) {
    const { target: t, isScale, isUniform, corner, point, diagonalPoint, list, isCenter } = g, { dis, arr } = nearest(point, list, axis);
    if (dis > this.margin / this.canvas.getZoom()) return [];
    const x = axis === 'x', near = arr[arr.length - 1][axis] - point[axis], side = x ? 'l' : 't', delta = near * (corner.includes(side) ? -1 : 1);
    const { width, height, scaleX, scaleY } = t, size = x ? scaleX * width : scaleY * height, full = size + (t.strokeUniform ? 0 : t.strokeWidth), k = (delta + full) / full;
    if (k === 0) return [];
    const A = x ? ['scaleX', 'width', scaleX, width, 'scaleY', 'height', scaleY, height] : ['scaleY', 'height', scaleY, height, 'scaleX', 'width', scaleX, width];
    if (isScale) { t.set(A[0], A[2] * k); if (isUniform) t.set(A[4], A[6] * k); } else { t.set(A[1], A[3] * k); if (isUniform) t.set(A[5], A[7] * k); }
    if (isCenter) t.setRelativeXY(diagonalPoint, 'center', 'center'); else t.setRelativeXY(diagonalPoint, ...CONTRARY[corner]);
    t.setCoords(); return arr.map(a => ({ origin: point, target: a }));
  }
  scalingOrResizing(e) {
    const t = e.target; t.setCoords(); const isScale = String(e.transform.action).startsWith('scale'); this.verticalLines.clear(); this.horizontalLines.clear();
    let corner = e.transform.corner;
    if (t.flipX) corner = corner.includes('l') ? corner.replace('l', 'r') : corner.includes('r') ? corner.replace('r', 'l') : corner;
    if (t.flipY) corner = corner.includes('t') ? corner.replace('t', 'b') : corner.includes('b') ? corner.replace('b', 't') : corner;
    const map = this._pointMap(t); if (!(corner in map)) return;
    this.onlyDrawPoint = corner.includes('m'); if (this.onlyDrawPoint && t.getTotalAngle() % 90 !== 0) return;
    const contrary = this._contraryMap(t), point = map[corner]; let diagonal = contrary[corner];
    const isCenter = e.transform.original.originX === 'center' && e.transform.original.originY === 'center';
    if (isCenter) { const c = t.group ? point.transform(inv(t.group.calcTransformMatrix())) : point; diagonal = diagonal.add(c).scalarDivide(2); }
    const key = e.e[this.canvas.uniScaleKey]; let isUniform = this.canvas.uniformScaling && !key || !this.canvas.uniformScaling && key; if (this.onlyDrawPoint) isUniform = false;
    const g = { target: t, point, diagonalPoint: diagonal, corner, list: this._candidates(t), isScale, isUniform, isCenter };
    const v = this.onlyDrawPoint && (corner.includes('t') || corner.includes('b')) ? [] : this._snapSize(g, 'x'), h = this.onlyDrawPoint && (corner.includes('l') || corner.includes('r')) ? [] : this._snapSize(g, 'y');
    v.forEach(l => this._add(this.verticalLines, l)); h.forEach(l => this._add(this.horizontalLines, l));
  }
  _cross(ctx, p) { const z = this.canvas.getZoom(), s = this.xSize / z; ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke(); ctx.restore(); }
  _line(a, b) {
    const ctx = this.canvas.getTopContext(), v = this.canvas.viewportTransform, z = this.canvas.getZoom();
    ctx.save(); ctx.transform(...v); ctx.lineWidth = this.width / z; if (this.lineDash) ctx.setLineDash(this.lineDash); ctx.strokeStyle = this.color;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); if (this.lineDash) ctx.setLineDash([]); this._cross(ctx, a); this._cross(ctx, b); ctx.restore();
  }
  afterRender() {
    const ctx = this.canvas.getTopContext(), v = this.canvas.viewportTransform, z = this.canvas.getZoom();
    if (this.onlyDrawPoint) { // a side handle: only a cross on each neighbour point
      const spots = []; if (!this.closeVLine) for (const l of this.verticalLines.values()) spots.push(l.target); if (!this.closeHLine) for (const l of this.horizontalLines.values()) spots.push(l.target);
      ctx.save(); ctx.transform(...v); ctx.lineWidth = this.width / z; ctx.strokeStyle = this.color; for (const p of spots) this._cross(ctx, p); ctx.restore(); return;
    }
    if (!this.closeVLine) for (const { origin, target } of this.verticalLines.values()) { this._line(new Point(target.x, origin.y), target); }
    if (!this.closeHLine) for (const { origin, target } of this.horizontalLines.values()) { this._line(new Point(origin.x, target.y), target); }
  }
}

// ---- crop mode for pictures
// handles' look: edge bars and corner brackets, drawn in screen pixels at the handle
Control.prototype.commonRenderProps = function (ctx, left, top, obj, style = {}) {
  const xSize = this.sizeX || style.cornerSize || obj.cornerSize, ySize = this.sizeY || style.cornerSize || obj.cornerSize, transparent = style.transparentCorners ?? obj.transparentCorners;
  const strokeColor = style.cornerStrokeColor || obj.cornerStrokeColor;
  ctx.fillStyle = style.cornerColor || obj.cornerColor; ctx.strokeStyle = strokeColor || ctx.fillStyle; ctx.translate(left, top); ctx.rotate(rad(obj.getTotalAngle()));
  return { stroke: !transparent && strokeColor, xSize, ySize };
};
function barRender(ctx, left, top, style, obj) {
  ctx.save(); const { stroke, xSize, ySize } = this.commonRenderProps(ctx, left, top, obj, style), long = Math.max(xSize, ySize), thick = Math.min(xSize, ySize), half = long / 2, edge = 2 * obj.borderScaleFactor;
  ctx.rotate(rad(this.angle)); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-half, 0); ctx.lineTo(half, 0);
  if (stroke) { ctx.lineWidth = thick; ctx.stroke(); }
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = stroke ? thick - edge : thick; ctx.stroke(); ctx.restore();
}
function bracketRender(ctx, left, top, style, obj) {
  ctx.save(); const { stroke, xSize, ySize } = this.commonRenderProps(ctx, left, top, obj, style), edge = 2 * obj.borderScaleFactor;
  ctx.rotate(rad(this.angle)); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = () => { ctx.beginPath(); ctx.moveTo(xSize, 0); ctx.lineTo(0, 0); ctx.lineTo(0, xSize); };
  if (stroke) { ctx.lineWidth = ySize; path(); ctx.stroke(); }
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = stroke ? ySize - edge : ySize; path(); ctx.stroke(); ctx.restore();
}
// the corner brackets answer anywhere along the L they draw, not only in their small square
function bracketActive(key, obj, pointer, quad) {
  if (obj.canvas?.getActiveObject() !== obj || !obj.isControlVisible(key)) return false;
  const { tl, tr, br, bl } = quad, cx = (tl.x + tr.x + br.x + bl.x) / 4, cy = (tl.y + tr.y + br.y + bl.y) / 4, size = this.sizeX || obj.cornerSize, f = (this.sizeY || obj.cornerSize) / 2;
  const a = rad((obj.angle || 0) + (this.angle || 0)), c = Math.cos(a), s = Math.sin(a), at = (x, y) => new Point(cx + x * c - y * s, cy + x * s + y * c);
  const inside = (p, poly) => { let hit = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const A = poly[i], B = poly[j]; if ((A.y > p.y) !== (B.y > p.y) && p.x < (B.x - A.x) * (p.y - A.y) / (B.y - A.y) + A.x) hit = !hit; } return hit; };
  return inside(pointer, [at(-f, -f), at(size + f, -f), at(size + f, f), at(-f, f)]) || inside(pointer, [at(-f, -f), at(f, -f), at(f, size + f), at(-f, size + f)]);
}
const fire = (name, fn) => withEvent(name, anchored(fn));
function widthTo(e, tr, x, y) { // drag a side so the box becomes wider or narrower, keeping the other side where it is
  const o = internal.getLocalPoint(tr, tr.originX, tr.originY, x, y);
  if (!(tr.originX === 'center' || (tr.originX === 'right' && o.x < 0) || (tr.originX === 'left' && o.x > 0))) return false;
  const t = tr.target, pad = t.strokeWidth / (t.strokeUniform ? t.scaleX : 1), mult = tr.originX === 'center' && tr.originY === 'center' ? 2 : 1, was = t.width;
  t.set('width', Math.max(Math.ceil(Math.abs(o.x * mult / t.scaleX) - pad), 0)); return was !== t.width;
}
function heightTo(e, tr, x, y) {
  const o = internal.getLocalPoint(tr, tr.originX, tr.originY, x, y);
  if (!(tr.originY === 'center' || (tr.originY === 'bottom' && o.y < 0) || (tr.originY === 'top' && o.y > 0))) return false;
  const t = tr.target, pad = t.strokeWidth / (t.strokeUniform ? t.scaleY : 1), mult = tr.originX === 'center' && tr.originY === 'center' ? 2 : 1, was = t.height;
  t.set('height', Math.max(Math.ceil(Math.abs(o.y * mult / t.scaleY) - pad), 0)); return was !== t.height;
}
const cropWidth = fire('CROPPING', (e, tr, x, y) => { const t = tr.target, was = t.width, moved = widthTo(e, tr, x, y), room = t._element.width - t.cropX; if (moved) { if (t.width > room) t.width = room; if (t.width < 1) t.width = 1; } return was !== t.width; });
const cropHeight = fire('CROPPING', (e, tr, x, y) => { const t = tr.target, was = t.height, moved = heightTo(e, tr, x, y), room = t._element.height - t.cropY; if (moved) { if (t.height > room) t.height = room; if (t.height < 1) t.height = 1; } return was !== t.height; });
const cropX = fire('CROPPING', (e, tr, x, y) => { const t = tr.target, { width, cropX: was } = t, moved = widthTo(e, tr, x, y); let now = was + width - t.width; t.width = width; if (moved) { if (now < 0) now = 0; t.cropX = now; t.width += was - now; } return now !== was; });
const cropY = fire('CROPPING', (e, tr, x, y) => { const t = tr.target, { height, cropY: was } = t, moved = heightTo(e, tr, x, y); let now = was + height - t.height; t.height = height; if (moved) { if (now < 0) now = 0; t.cropY = now; t.height += was - now; } return now !== was; });
const flipped = (plain, mirrored, prop) => (e, tr, x, y) => (tr.target[prop] ? mirrored : plain)(e, tr, x, y);
const either = (px, mx, py, my) => (e, tr, x, y) => { const t = tr.target, a = (t.flipX ? mx : px)(e, tr, x, y), b = (t.flipY ? my : py)(e, tr, x, y); return a || b; };
const flip = (v, f) => f ? 1 - v : v;
// a corner of the whole picture: scales picture and crop together, keeping the opposite corner of the full picture fixed
const cornerScale = (ex, ey) => (e, tr, x, y) => {
  const t = tr.target, { width: W, height: H } = t.getElement(), right = W - t.width - t.cropX, bottom = H - t.height - t.cropY;
  const ox = flip(ex < 0 ? 1 + right / t.width : -t.cropX / t.width, t.flipX), oy = flip(ey < 0 ? 1 + bottom / t.height : -t.cropY / t.height, t.flipY);
  const keep = t.translateToOriginPoint(t.getCenterPoint(), ox, oy), local = internal.getLocalPoint(tr, ox, oy, x, y), s = Math.min(Math.abs(local.x / W), Math.abs(local.y / H));
  if (!(s > 0) || !Number.isFinite(s)) return false; // the pointer is on the fixed corner (or past it): no size to scale to
  const kx = s / t.scaleX, ky = s / t.scaleY, r = right / kx, b = bottom / ky, w = t.width / kx, h = t.height / ky, cx = ex < 0 ? W - w - r : t.cropX / kx, cy = ey < 0 ? H - h - b : t.cropY / ky;
  if (![r, b, w, h, cx, cy].every(Number.isFinite) || (ex < 0 ? r : cx) + w > W || (ey < 0 ? b : cy) + h > H) return false;
  Object.assign(t, { scaleX: s, scaleY: s, width: w, height: h, cropX: cx, cropY: cy });
  t.setPositionByOrigin(keep, flip(ex < 0 ? 1 + r / w : -cx / w, t.flipX), flip(ey < 0 ? 1 + b / h : -cy / h, t.flipY)); return true;
};
function picturePlace(dim, matrix, obj) { // the handle sits on the corner of the whole picture, cropped part included
  const m = mul(obj.getViewportTransform(), obj.calcTransformMatrix()), el = obj.getElement();
  return new Point(this.x < 0 ? -obj.width / 2 - obj.cropX : el.width - obj.width / 2 - obj.cropX, this.y < 0 ? -obj.height / 2 - obj.cropY : el.height - obj.height / 2 - obj.cropY).transform(m);
}
function cropControls() {
  const corner = (x, y) => new Control({ x, y, cursorStyleHandler: scaleCursor, positionHandler: picturePlace, actionHandler: cornerScale(x, y) });
  const bar = (x, y, angle, sx, sy, handler) => new Control({ x, y, angle, sizeX: sx, sizeY: sy, render: barRender, cursorStyleHandler: scaleCursor, actionHandler: handler, getActionName: () => 'crop' });
  const bracket = (x, y, angle, handler) => new Control({ angle, x, y, sizeX: 12, sizeY: 8, render: bracketRender, shouldActivate: bracketActive, cursorStyleHandler: scaleCursor, actionHandler: handler, getActionName: () => 'crop' });
  return {
    tls: corner(-0.5, -0.5), brs: corner(0.5, 0.5), trs: corner(0.5, -0.5), bls: corner(-0.5, 0.5),
    mlc: bar(-0.5, 0, 90, 8, 16, flipped(cropX, cropWidth, 'flipX')), mrc: bar(0.5, 0, 90, 8, 16, flipped(cropWidth, cropX, 'flipX')),
    mbc: bar(0, 0.5, 0, 16, 8, flipped(cropHeight, cropY, 'flipY')), mtc: bar(0, -0.5, 0, 16, 8, flipped(cropY, cropHeight, 'flipY')),
    tlc: bracket(-0.5, -0.5, 0, either(cropX, cropWidth, cropY, cropHeight)), trc: bracket(0.5, -0.5, 90, either(cropWidth, cropX, cropY, cropHeight)),
    blc: bracket(-0.5, 0.5, 270, either(cropX, cropWidth, cropHeight, cropY)), brc: bracket(0.5, 0.5, 180, either(cropWidth, cropX, cropHeight, cropY))
  };
}
function panPicture({ transform }) { // dragging the picture moves what shows inside the frame, not the frame
  const { target: t, original: o } = transform, d = new Point(t.left - o.left, t.top - o.top).rotate(-t.getTotalAngle()), { width: w, height: h, _element: el } = t;
  let cx = o.cropX - d.x / t.scaleX * (t.flipX ? -1 : 1), cy = o.cropY - d.y / t.scaleY * (t.flipY ? -1 : 1);
  if (cx < 0) cx = 0; if (cy < 0) cy = 0; if (cx + w > el.width) cx = el.width - w; if (cy + h > el.height) cy = el.height - h;
  t.cropX = cx; t.cropY = cy; t.left = o.left; t.top = o.top;
}
function ghost({ ctx }) { // the part of the picture that is cropped away, faint, with its outline
  const el = this._element, x = -this.width / 2 - this.cropX, y = -this.height / 2 - this.cropY, was = ctx.globalAlpha;
  ctx.globalAlpha *= 0.5; ctx.drawImage(el, x, y); ctx.strokeStyle = this.borderColor; ctx.lineWidth = this.borderScaleFactor / this.scaleX; ctx.strokeRect(x, y, el.width, el.height); ctx.globalAlpha = was;
}
function enterCropMode({ target: t }) {
  if (t._cropping) return; t._cropping = true; // already in crop mode: a second call would stack handlers and save the crop controls as the originals
  const { controls, padding } = t; t.padding = 0; t.controls = cropControls(); t.on('moving', panPicture); t.on('before:render', ghost); t.setCoords();
  t.once('mousedblclick', () => { t._cropping = false; t.padding = padding; t.off('moving', panPicture); t.off('before:render', ghost); t.controls = controls; t.setCoords(); t.once('mousedblclick', function again() { enterCropMode({ target: t }); }); t.canvas?.requestRenderAll(); });
  t.canvas?.requestRenderAll();
}

Object.assign(kbe, { AligningGuidelines, enterCropMode });
})();
