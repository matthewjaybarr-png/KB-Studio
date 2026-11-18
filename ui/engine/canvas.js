// The interactive canvas of the own engine: viewport (zoom, pan, retina), hit testing, selection, ActiveSelection, control handles
// (move, scale, rotate, resize a text box), mouse events, cursors, free drawing. Original code, shaped like the Fabric API the app
// calls. Needs model.js, render.js, text.js and editor.js. Usage: new kbe.Canvas(canvasElement, { width, height, ... }).
(function () {
'use strict';
const kbe = globalThis.kbe, { StaticCanvas, FabricObject, Group, Point, Textbox } = kbe, U = kbe.util, { internal } = kbe;
const mul = U.multiplyTransformMatrices, inv = U.invertTransform, tp = U.transformPoint;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI, IDENT = [1, 0, 0, 1, 0, 0];
const OFF_NAMES = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }; // where an origin name sits across the box
const OFF = new Proxy(OFF_NAMES, { get: (t, k) => k in t ? t[k] : Number(k) }); // a plain number is a fraction of the box too (crop handles use them)
const NOT_ALLOWED = 'not-allowed';

// ---- defaults an interactive object has (the saved JSON does not carry them)
Object.assign(FabricObject.ownDefaults, {
  selectable: true, evented: true, hasControls: true, hasBorders: true, lockMovementX: false, lockMovementY: false, lockRotation: false, lockScalingX: false, lockScalingY: false,
  lockSkewingX: false, lockSkewingY: false, lockScalingFlip: false, padding: 0, cornerSize: 13, touchCornerSize: 24, transparentCorners: true, cornerColor: 'rgb(178,204,255)',
  cornerStrokeColor: '', cornerStyle: 'rect', borderColor: 'rgb(178,204,255)', borderDashArray: null, borderScaleFactor: 1, borderOpacityWhenMoving: 0.4, centeredScaling: false,
  centeredRotation: true, hoverCursor: null, moveCursor: null, perPixelTargetFind: false, minScaleLimit: 0, activeOn: 'down'
});

// ---- matrices: pull scale, skew, angle and place out of a transform (what an object gets back when it leaves a group)
function decompose(m) {
  const [a, b, c, d, e, f] = m, denom = a * a + b * b, scaleX = Math.sqrt(denom), scaleY = scaleX ? (a * d - c * b) / scaleX : 0;
  return { angle: deg(Math.atan2(b, a)), scaleX, scaleY, skewX: deg(Math.atan2(a * c + b * d, denom)), skewY: 0, translateX: e, translateY: f };
}
const P = FabricObject.prototype;
P.getTotalAngle = function () { return (this.group ? this.group.getTotalAngle() : 0) + this.angle; };
P.getScaledWidth = function () { return this._transformedDims().x; };
P.getScaledHeight = function () { return this._transformedDims().y; };
P.translateToOriginPoint = function (center, ox, oy) { const d = this._transformedDims(); return center.add(new Point((OFF[ox] - 0.5) * d.x, (OFF[oy] - 0.5) * d.y).rotate(this.angle)); };
P.setPositionByOrigin = function (pos, ox, oy) { const d = this._transformedDims(); return this.setCenterPoint(pos.add(new Point((0.5 - OFF[ox]) * d.x, (0.5 - OFF[oy]) * d.y).rotate(this.angle))); };
P.normalizePoint = function (p, ox, oy) { return new Point(p).subtract(this.translateToOriginPoint(this.getCenterPoint(), ox, oy)).rotate(-this.angle); };
P.containsPoint = function (p) {
  const m = this.calcTransformMatrix(), det = m[0] * m[3] - m[1] * m[2]; if (!det) return false;
  const q = tp(p, inv(m)), pre = this.strokeUniform ? 0 : this.strokeWidth, w = this.width + pre + (this.strokeUniform ? this.strokeWidth / Math.abs(this.scaleX) : 0), h = this.height + pre + (this.strokeUniform ? this.strokeWidth / Math.abs(this.scaleY) : 0);
  return Math.abs(q.x) <= w / 2 + 1e-6 && Math.abs(q.y) <= h / 2 + 1e-6; // an edge counts as inside
};
P.intersectsWithRect = function (a, b) { // does the object's box touch the rectangle between scene points a and b
  const r = { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) }, q = this.getCoords();
  const rc = [[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2]].map(([x, y]) => new Point(x, y)), axes = [new Point(1, 0), new Point(0, 1)];
  for (let i = 0; i < 4; i++) { const e = q[(i + 1) % 4].subtract(q[i]); axes.push(new Point(-e.y, e.x)); }
  return axes.every(ax => { const pr = pts => pts.map(p => p.x * ax.x + p.y * ax.y), A = pr(q), B = pr(rc); return Math.max(...A) >= Math.min(...B) && Math.max(...B) >= Math.min(...A); });
};
P.isContainedWithinRect = function (a, b) { const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y); return this.getCoords().every(p => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2); };
P.onSelect = function () { return false; };
P.onDeselect = function () { return false; };

// ---- controls: the nine handles; each has a place on the box, a cursor, a look and the action it starts
class Control {
  constructor(o = {}) { Object.assign(this, { x: 0, y: 0, offsetX: 0, offsetY: 0, sizeX: 0, sizeY: 0, touchSizeX: 0, touchSizeY: 0, cursorStyle: 'crosshair', withConnection: false, actionName: '', angle: 0, visible: true }, o); }
  getVisibility(obj, key) { return obj._controlsVisibility && key in obj._controlsVisibility ? obj._controlsVisibility[key] : this.visible; }
  getActionName(e, obj) { return this.actionNameHandler ? this.actionNameHandler(e, this, obj) : this.actionName; }
  cursorFor(e, obj) { return this.cursorStyleHandler ? this.cursorStyleHandler(e, this, obj) : this.cursorStyle; }
  positionHandler(dim, matrix) { return new Point(this.x * dim.x + this.offsetX, this.y * dim.y + this.offsetY).transform(matrix); }
  render(ctx, left, top, style, obj) {
    const size = this.sizeX || style.cornerSize || obj.cornerSize, ySize = this.sizeY || size, transparent = style.transparentCorners ?? obj.transparentCorners;
    ctx.save(); ctx.fillStyle = style.cornerColor || obj.cornerColor; ctx.strokeStyle = style.cornerStrokeColor || obj.cornerStrokeColor || ctx.fillStyle;
    ctx.translate(left, top); ctx.rotate(rad(obj.getTotalAngle() + this.angle)); ctx.lineWidth = 1;
    if ((style.cornerStyle || obj.cornerStyle) === 'circle') { ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, 2 * Math.PI); transparent ? ctx.stroke() : (ctx.fill(), ctx.stroke()); }
    else { if (!transparent) ctx.fillRect(-size / 2, -ySize / 2, size, ySize); ctx.strokeRect(-size / 2, -ySize / 2, size, ySize); }
    ctx.restore();
  }
}
const CURSOR_BY_QUADRANT = ['e-resize', 'se-resize', 's-resize', 'sw-resize', 'w-resize', 'nw-resize', 'n-resize', 'ne-resize'];
function scaleCursor(e, control, obj) {
  if (control.x !== 0 && control.y === 0 ? obj.lockScalingX : control.x === 0 && control.y !== 0 ? obj.lockScalingY : obj.lockScalingX && obj.lockScalingY) return NOT_ALLOWED;
  return CURSOR_BY_QUADRANT[Math.round(((obj.getTotalAngle() + deg(Math.atan2(control.y * obj._transformedDims().y, control.x * obj._transformedDims().x)) + 360) % 360) / 45) % 8];
}
const rotateCursor = (e, control, obj) => obj.lockRotation ? NOT_ALLOWED : control.cursorStyle;

// ---- what a handle does while the pointer moves; every handler returns whether it changed the object
const eventInfo = (e, tr, x, y) => ({ e, target: tr.target, transform: tr, pointer: new Point(x, y) });
function emit(name, e, tr, x, y) { const info = eventInfo(e, tr, x, y); tr.target.fire(name, info); tr.target.canvas?.fire('object:' + name, info); }
const withEvent = (name, fn) => (e, tr, x, y) => { const done = fn(e, tr, x, y); if (done) emit(name, e, tr, x, y); return done; };
const anchored = fn => (e, tr, x, y) => { // the point opposite the handle stays where it was
  const t = tr.target, pin = t.translateToOriginPoint(t.getCenterPoint(), tr.originX, tr.originY), done = fn(e, tr, x, y);
  t.setPositionByOrigin(pin, tr.originX, tr.originY); return done;
};
function localPoint(tr, x, y) { // the pointer measured from the fixed corner, along the object's own axes
  const t = tr.target, c = t.controls[tr.corner], pad = t.padding / (t.canvas ? t.canvas.getZoom() : 1), p = t.normalizePoint(new Point(x, y), tr.originX, tr.originY);
  if (p.x >= pad) p.x -= pad; if (p.x <= -pad) p.x += pad; if (p.y >= pad) p.y -= pad; if (p.y <= -pad) p.y += pad;
  p.x -= c.offsetX; p.y -= c.offsetY; return p;
}
function dragHandler(e, tr, x, y) {
  const t = tr.target, left = x - tr.offsetX, top = y - tr.offsetY, mx = !t.lockMovementX && t.left !== left, my = !t.lockMovementY && t.top !== top;
  if (mx) t.left = left; if (my) t.top = top; if (mx || my) emit('moving', e, tr, x, y); return mx || my;
}
function scaleHandler(by) { // by: undefined for a corner, 'x' or 'y' for a side
  return withEvent('scaling', anchored((e, tr, x, y) => {
    const t = tr.target, canvas = t.canvas, o = tr.original;
    if (t.lockScalingX && t.lockScalingY) return false;
    const local = localPoint(tr, x, y), mult = tr.originX === 'center' && tr.originY === 'center' ? 2 : 1; local.x *= mult; local.y *= mult; const dim = t._transformedDims(), sx = Math.sign(local.x), sy = Math.sign(local.y);
    tr.signX ??= sx; tr.signY ??= sy;
    if (t.lockScalingFlip && (tr.signX !== sx || tr.signY !== sy)) return false;
    const was = [t.scaleX, t.scaleY]; let scaleX = t.scaleX, scaleY = t.scaleY;
    if (!by && (canvas.uniformScaling !== !!e[canvas.uniScaleKey])) { // corners keep the shape unless the key is held
      const dist = Math.abs(local.x) + Math.abs(local.y), was0 = Math.abs(dim.x * o.scaleX / t.scaleX) + Math.abs(dim.y * o.scaleY / t.scaleY);
      scaleX = o.scaleX * dist / was0; scaleY = o.scaleY * dist / was0;
    } else { if (by !== 'y') scaleX = Math.abs(local.x * t.scaleX / dim.x); if (by !== 'x') scaleY = Math.abs(local.y * t.scaleY / dim.y); }
    if (!t.lockScalingX && by !== 'y') t.scaleX = scaleX; if (!t.lockScalingY && by !== 'x') t.scaleY = scaleY;
    if (by !== 'y') t.flipX = o.flipX !== (sx !== tr.signX); if (by !== 'x') t.flipY = o.flipY !== (sy !== tr.signY);
    const inv = { left: 'right', right: 'left', top: 'bottom', bottom: 'top', center: 'center' }; // once flipped the fixed edge is on the other side
    tr.originX = by !== 'y' && sx !== tr.signX ? inv[tr.baseX] : tr.baseX; tr.originY = by !== 'x' && sy !== tr.signY ? inv[tr.baseY] : tr.baseY;
    return was[0] !== t.scaleX || was[1] !== t.scaleY;
  }));
}
const resizeHandler = withEvent('resizing', anchored((e, tr, x, y) => { // a text box changes its width, not its scale
  const t = tr.target, local = localPoint(tr, x, y), pad = t.strokeWidth / (t.strokeUniform ? t.scaleX : 1), mult = tr.originX === 'center' ? 2 : 1;
  const was = t.width, width = Math.ceil(Math.abs(local.x * mult / t.scaleX) - pad); t.set('width', Math.max(width, 0)); return was !== t.width;
}));
const rotateHandler = withEvent('rotating', anchored((e, tr, x, y) => {
  const t = tr.target; if (t.lockRotation) return false;
  const pin = t.translateToOriginPoint(t.getCenterPoint(), tr.originX, tr.originY), last = Math.atan2(tr.ey - pin.y, tr.ex - pin.x), cur = Math.atan2(y - pin.y, x - pin.x);
  let angle = deg(cur - last + tr.theta);
  if (t.snapAngle > 0) {
    const snap = t.snapAngle, limit = t.snapThreshold || snap, hi = Math.ceil(angle / snap) * snap, lo = Math.floor(angle / snap) * snap;
    if (Math.abs(angle - lo) < limit) angle = lo; else if (Math.abs(angle - hi) < limit) angle = hi;
  }
  if (angle < 0) angle = 360 + angle; angle %= 360;
  const rotated = t.angle !== angle; t.angle = angle; return rotated;
}));
function defaultControls() {
  const side = (key, x, y, by, name) => [key, new Control({ x, y, actionNameHandler: (e, c, o) => (o.canvas && e[o.canvas.altActionKey] ? (by === 'x' ? 'skewY' : 'skewX') : name), actionHandler: scaleHandler(by), cursorStyleHandler: scaleCursor })];
  const corner = (key, x, y) => [key, new Control({ x, y, actionName: 'scale', actionHandler: scaleHandler(), cursorStyleHandler: scaleCursor })];
  return Object.fromEntries([side('ml', -0.5, 0, 'x', 'scaleX'), side('mr', 0.5, 0, 'x', 'scaleX'), side('mb', 0, 0.5, 'y', 'scaleY'), side('mt', 0, -0.5, 'y', 'scaleY'),
    corner('tl', -0.5, -0.5), corner('tr', 0.5, -0.5), corner('bl', -0.5, 0.5), corner('br', 0.5, 0.5),
    ['mtr', new Control({ x: 0, y: -0.5, offsetY: -40, withConnection: true, actionName: 'rotate', actionHandler: rotateHandler, cursorStyleHandler: rotateCursor })]]);
}
function textboxControls() { // left and right handles resize the box
  const c = defaultControls();
  for (const k of ['ml', 'mr']) Object.assign(c[k], { actionName: 'resizing', actionNameHandler: undefined, actionHandler: resizeHandler });
  return c;
}
FabricObject.ownDefaults.controls = defaultControls(); Textbox.ownDefaults.controls = textboxControls();

// ---- where the handles are: in canvas pixels, with a square to hit for each
Object.defineProperty(P, 'oCoords', { get() { return this._oCoords(); } });
P._viewport = function () { return this.canvas?.viewportTransform || IDENT; };
P._currentDims = function () { const v = this._viewport(), d = this._transformedDims(); return new Point(Math.abs(d.x * v[0]) + this.padding * 2, Math.abs(d.y * v[3]) + this.padding * 2); };
P._oCoords = function () {
  const v = this._viewport(), place = tp(this.getCenterPoint(), v), dim = this._currentDims(), out = {};
  for (const [key, ctl] of Object.entries(this.controls)) {
    const p = ctl.positionHandler !== Control.prototype.positionHandler ? ctl.positionHandler(dim, null, this, ctl) // a handle that places itself (crop handles)
      : new Point(ctl.x * dim.x + ctl.offsetX, ctl.y * dim.y + ctl.offsetY).rotate(this.getTotalAngle()).add(place); // handle sizes stay in screen pixels at any zoom
    out[key] = { x: p.x, y: p.y, corner: this._hitSquare(p, ctl, false), touchCorner: this._hitSquare(p, ctl, true) };
  }
  return out;
};
P._hitSquare = function (p, ctl, touch) {
  const sx = (touch ? ctl.touchSizeX || this.touchCornerSize : ctl.sizeX || this.cornerSize), sy = (touch ? ctl.touchSizeY || this.touchCornerSize : ctl.sizeY || this.cornerSize), ang = this.getTotalAngle() + ctl.angle;
  const q = (dx, dy) => { const r = new Point(dx, dy).rotate(ang); return { x: p.x + r.x, y: p.y + r.y }; };
  return { tl: q(-sx / 2, -sy / 2), tr: q(sx / 2, -sy / 2), br: q(sx / 2, sy / 2), bl: q(-sx / 2, sy / 2) };
};
P.setCoords = function () { return this; }; // coordinates are worked out when asked for
P.findControl = function (p, touch) { // the handle under a canvas-pixel point, as {key, control}
  if (!this.hasControls || !this.canvas || this.canvas._activeObject !== this) return;
  const coords = this.oCoords, keys = Object.keys(coords);
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i], ctl = this.controls[key]; if (!ctl.getVisibility(this, key)) continue;
    const c = coords[key], r = new Point(p.x - c.x, p.y - c.y).rotate(-(this.getTotalAngle() + ctl.angle)), sx = touch ? ctl.touchSizeX || this.touchCornerSize : ctl.sizeX || this.cornerSize, sy = touch ? ctl.touchSizeY || this.touchCornerSize : ctl.sizeY || this.cornerSize;
    if (ctl.shouldActivate) { const q = coords[key][touch ? 'touchCorner' : 'corner']; if (ctl.shouldActivate(key, this, p, q)) return { key, control: ctl }; continue; }
    if (Math.abs(r.x) <= sx / 2 && Math.abs(r.y) <= sy / 2) return { key, control: ctl };
  }
};
P._findTargetCorner = function (p, touch) { return this.findControl(p, touch)?.key; };
P.forEachControl = function (fn) { for (const [k, c] of Object.entries(this.controls)) fn(c, k, this); };
P._renderControls = function (ctx, style = {}) { // border and handles, in canvas pixels
  if (!this.hasBorders && !this.hasControls) return;
  const v = this._viewport(), c = this.getCenterPoint(), zoom = this.canvas?.getZoom() ?? 1; let size;
  ctx.save(); ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
  const place = tp(c, v); ctx.translate(place.x, place.y); ctx.rotate(rad(this.getTotalAngle()));
  if (style.forActiveSelection || this.group) { const m = this.calcTransformMatrix(), a = deg(Math.atan2(m[1], m[0])), sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]); void a; size = new Point((this.width + (this.strokeUniform ? 0 : this.strokeWidth)) * sx * zoom + this.borderScaleFactor + this.padding * 2, (this.height + (this.strokeUniform ? 0 : this.strokeWidth)) * sy * zoom + this.borderScaleFactor + this.padding * 2); }
  else size = this._currentDims().add(new Point(this.borderScaleFactor, this.borderScaleFactor));
  if (this.hasBorders) { ctx.strokeStyle = style.borderColor || this.borderColor; ctx.lineWidth = 1; if (this.borderDashArray) ctx.setLineDash(this.borderDashArray); ctx.strokeRect(-size.x / 2, -size.y / 2, size.x, size.y); ctx.setLineDash([]); }
  ctx.restore();
  if (!(style.hasControls ?? this.hasControls)) return;
  const coords = this.oCoords; ctx.save(); ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
  this.forEachControl((ctl, key) => {
    if (!ctl.withConnection || !ctl.getVisibility(this, key)) return;
    const top = this.oCoords.mt, p = coords[key]; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(p.x, p.y); ctx.strokeStyle = style.borderColor || this.borderColor; ctx.lineWidth = 1; ctx.stroke();
  });
  this.forEachControl((ctl, key) => { if (ctl.getVisibility(this, key)) ctl.render(ctx, coords[key].x, coords[key].y, style, this); });
  ctx.restore();
};

// ---- ActiveSelection: several objects moved, scaled and turned as one; they go back to the page, transformed, when it is dropped
class ActiveSelection extends Group {
  static ownDefaults = { multiSelectionStacking: 'canvas-stacking' };
  constructor(objects = [], options = {}) { super(objects, options); this.canvas = options.canvas; }
  static get type() { return 'ActiveSelection'; }
  _restoreChildren(only) {
    const m = this.calcOwnMatrix();
    for (const o of only ? [only] : this._objects) {
      const d = decompose(mul(m, o.calcOwnMatrix())); o.group = undefined;
      Object.assign(o, { angle: d.angle, skewX: d.skewX, skewY: d.skewY, flipX: d.scaleX < 0, flipY: d.scaleY < 0 }); o.scaleX = Math.abs(d.scaleX); o.scaleY = Math.abs(d.scaleY); // a mirrored result becomes a flip
      o.setPositionByOrigin(new Point(d.translateX, d.translateY), 'center', 'center');
    }
  }
  setObjects(list) { // rebuild around a new set of objects (given in page coordinates once restored)
    this._restoreChildren(); Object.assign(this, { angle: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false });
    const order = this.canvas ? this.canvas._objects : []; this._objects = [...list].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    this._layout({}); for (const o of this._objects) o.group = this;
  }
  add(o) { const keep = this._objects.filter(c => c !== o); this.setObjects([...keep, o]); }
  remove(o) { // as Fabric: the box keeps its turn and size and is refitted around the ones left
    const m = this.calcOwnMatrix(), back = inv(m); this._restoreChildren(o); this._objects = this._objects.filter(c => c !== o); if (!this._objects.length) return;
    const pts = this._objects.flatMap(c => c.getCoords().map(q => tp(q, back))), xs = pts.map(q => q.x), ys = pts.map(q => q.y), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, mid = new Point(x0 + w / 2, y0 + h / 2);
    for (const c of this._objects) c.setCenterPoint(c.getRelativeCenterPoint().subtract(mid));
    this.width = w; this.height = h; this.setPositionByOrigin(tp(mid, m), 'center', 'center');
  }
  contains(o) { return this._objects.includes(o); }
  size() { return this._objects.length; }
  item(i) { return this._objects[i]; }
  removeAll() { const kids = [...this._objects]; this._restoreChildren(); this._objects = []; return kids; }
  onDeselect() { this.removeAll(); return false; }
  _renderControls(ctx, style) { ctx.save(); ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1; super._renderControls(ctx, style); for (const o of this._objects) o._renderControls(ctx, { hasControls: false, forActiveSelection: true }); ctx.restore(); }
  toObject(keys) { return Object.assign(super.toObject(keys), { type: 'ActiveSelection' }); }
}

// ---- free drawing
class PencilBrush {
  constructor(canvas) { this.canvas = canvas; this.color = 'rgb(0, 0, 0)'; this.width = 1; this.decimate = 0.4; this.strokeLineCap = 'round'; this.strokeLineJoin = 'round'; this.strokeMiterLimit = 10; this.strokeDashArray = null; this.shadow = null; this._points = []; }
  onMouseDown(p, { e }) { if (e.button && e.button !== 0) return; this._points = [new Point(p)]; this._drawing = true; this._render(); }
  onMouseMove(p) { if (!this._drawing) return; const last = this._points.at(-1); if (this._points.length > 1 && last.x === p.x && last.y === p.y) return; this._points.push(new Point(p)); this._render(); }
  onMouseUp() { if (!this._drawing) return false; this._drawing = false; this._finish(); return false; }
  _render() {
    const c = this.canvas, ctx = c.contextTop, v = c.viewportTransform, pts = this._points; c.clearContext(ctx); c.contextTopDirty = true;
    ctx.save(); ctx.transform(...v); ctx.beginPath(); ctx.strokeStyle = this.color; ctx.lineWidth = this.width; ctx.lineCap = this.strokeLineCap; ctx.lineJoin = this.strokeLineJoin;
    let a = pts[0], b = pts[1] || a; ctx.moveTo(a.x, a.y);
    for (let i = 1; i < pts.length; i++) { const mid = a.midPointFrom(b); ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y); a = pts[i]; b = pts[i + 1] || a; }
    ctx.lineTo(a.x, a.y); ctx.stroke(); ctx.restore();
  }
  decimatePoints(points, distance) { // drop points closer than `distance` to the last kept one
    if (points.length <= 2) return points; const sq = Math.pow(distance / this.canvas.getZoom(), 2), l = points.length - 1; let last = points[0]; const out = [last];
    for (let i = 1; i < l - 1; i++) { const dx = last.x - points[i].x, dy = last.y - points[i].y; if (dx * dx + dy * dy >= sq) { last = points[i]; out.push(last); } }
    out.push(points[l]); return out;
  }
  convertPointsToPath(points) {
    const path = [], corr = this.width / 1000, many = points.length > 2; let p1 = new Point(points[0]), p2 = new Point(points[1] || points[0]), sx = 1, sy = 0;
    if (many) { sx = points[2].x < p2.x ? -1 : points[2].x === p2.x ? 0 : 1; sy = points[2].y < p2.y ? -1 : points[2].y === p2.y ? 0 : 1; }
    path.push(['M', p1.x - sx * corr, p1.y - sy * corr]);
    let i = 1; for (; i < points.length; i++) { if (!p1.eq(p2)) { const mid = p1.midPointFrom(p2); path.push(['Q', p1.x, p1.y, mid.x, mid.y]); } p1 = points[i]; if (i + 1 < points.length) p2 = points[i + 1]; }
    if (many) { sx = p1.x > points[i - 2].x ? 1 : p1.x === points[i - 2].x ? 0 : -1; sy = p1.y > points[i - 2].y ? 1 : p1.y === points[i - 2].y ? 0 : -1; }
    path.push(['L', p1.x + sx * corr, p1.y + sy * corr]); return path;
  }
  _finish() {
    const c = this.canvas; let pts = this._points; if (this.decimate) pts = this.decimatePoints(pts, this.decimate);
    const data = this.convertPointsToPath(pts); c.clearContext(c.contextTop); c.contextTopDirty = false;
    if (data.length === 2 && data[0][1] === data[1][1] && data[0][2] === data[1][2]) { c.requestRenderAll(); return; }
    const path = new kbe.Path(data, { fill: null, stroke: this.color, strokeWidth: this.width, strokeLineCap: this.strokeLineCap, strokeMiterLimit: this.strokeMiterLimit, strokeLineJoin: this.strokeLineJoin, strokeDashArray: this.strokeDashArray });
    if (this.shadow) path.shadow = new kbe.Shadow(this.shadow);
    c.fire('before:path:created', { path }); c.add(path); c.requestRenderAll(); c.fire('path:created', { path });
  }
}

// ---- the canvas
class Canvas extends StaticCanvas {
  constructor(el, options = {}) {
    super(el, { ...options, width: options.width ?? (el.width || 300), height: options.height ?? (el.height || 150) });
    Object.assign(this, {
      selection: true, selectionKey: 'shiftKey', uniformScaling: true, uniScaleKey: 'shiftKey', centeredKey: 'altKey', altActionKey: 'shiftKey', centeredScaling: false, centeredRotation: false,
      targetFindTolerance: 0, perPixelTargetFind: false, preserveObjectStacking: true, skipTargetFind: false, defaultCursor: 'default', hoverCursor: 'move', moveCursor: 'move', freeDrawingCursor: 'crosshair',
      selectionColor: 'rgba(100, 100, 255, 0.3)', selectionBorderColor: 'rgba(255, 255, 255, 0.3)', selectionLineWidth: 1, selectionFullyContained: false, fireRightClick: true, fireMiddleClick: true,
      stopContextMenu: true, controlsAboveOverlay: false, enableRetinaScaling: true, renderOnAddRemove: true, backgroundVpt: true, isDrawingMode: false, interactive: true
    }, options);
    this.viewportTransform = [...(options.viewportTransform || IDENT)]; this._activeObject = undefined; this._hovered = undefined; this._groupSelector = null; this._transform = null;
    this._build(el); this.setDimensions({ width: this.width, height: this.height }); this._listen();
  }
  _build(el) {
    this.lowerCanvasEl = this.element = el; el.classList.add('lower-canvas');
    const wrap = this.wrapperEl = document.createElement('div'); wrap.className = 'canvas-container'; wrap.style.position = 'relative';
    el.parentNode?.insertBefore(wrap, el); wrap.appendChild(el);
    const up = this.upperCanvasEl = document.createElement('canvas'); up.className = 'upper-canvas'; wrap.appendChild(up);
    for (const c of [el, up]) Object.assign(c.style, { position: 'absolute', left: '0', top: '0' }); Object.assign(up.style, { touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none' });
    this.contextContainer = el.getContext('2d'); this.contextTop = up.getContext('2d');
  }
  getContext() { return this.contextContainer; }
  getRetinaScaling() { return this.enableRetinaScaling ? globalThis.devicePixelRatio || 1 : 1; }
  setDimensions(dim, { cssOnly, backstoreOnly } = {}) {
    if (dim.width !== undefined) this.width = dim.width; if (dim.height !== undefined) this.height = dim.height;
    const r = this.getRetinaScaling();
    for (const c of [this.lowerCanvasEl, this.upperCanvasEl]) {
      if (!cssOnly) { c.width = Math.round(this.width * r); c.height = Math.round(this.height * r); c.getContext('2d').setTransform(r, 0, 0, r, 0, 0); }
      if (!backstoreOnly) { c.style.width = this.width + 'px'; c.style.height = this.height + 'px'; }
    }
    if (!backstoreOnly) { this.wrapperEl.style.width = this.width + 'px'; this.wrapperEl.style.height = this.height + 'px'; }
    this.calcOffset(); if (this.renderOnAddRemove) this.requestRenderAll(); return this;
  }
  calcOffset() { this._offset = this.upperCanvasEl.getBoundingClientRect(); return this; }
  clearContext(ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore(); }
  getCenterPoint() { return new Point(this.width / 2, this.height / 2); }
  // viewport: scene point = inverse(viewportTransform) * canvas pixel
  getZoom() { return this.viewportTransform[0]; }
  setViewportTransform(v) { this.viewportTransform = [...v]; this.requestRenderAll(); return this; }
  zoomToPoint(point, value) {
    const v = [...this.viewportTransform], scene = tp(point, inv(v)); v[0] = value; v[3] = value; const after = tp(scene, v);
    v[4] += point.x - after.x; v[5] += point.y - after.y; return this.setViewportTransform(v);
  }
  setZoom(value) { return this.zoomToPoint(new Point(0, 0), value); }
  absolutePan(p) { const v = [...this.viewportTransform]; v[4] = -p.x; v[5] = -p.y; return this.setViewportTransform(v); }
  relativePan(d) { return this.absolutePan(new Point(-d.x - this.viewportTransform[4], -d.y - this.viewportTransform[5])); }
  getViewportPoint(e) {
    if (e._kbPoint) return e._kbPoint; const r = this.upperCanvasEl.getBoundingClientRect();
    return new Point((e.clientX - r.left) * (this.width / (r.width || this.width)), (e.clientY - r.top) * (this.height / (r.height || this.height)));
  }
  getScenePoint(e) { return tp(this.getViewportPoint(e), inv(this.viewportTransform)); }
  setCursor(c) { this.upperCanvasEl.style.cursor = c; }
  setTargetFindTolerance(v) { this.targetFindTolerance = v; }

  // ---- stacking and membership
  _announce(name, target) { this.fire('object:' + name, { target }); target.fire(name === 'added' ? 'added' : 'removed', { target: this }); }
  add(...objs) { for (const o of objs) { this._objects.push(o); o.canvas = this; this._announce('added', o); } this.renderOnAddRemove && this.requestRenderAll(); return this; }
  insertAt(index, ...objs) { for (const o of objs) { this._objects.splice(index++, 0, o); o.canvas = this; this._announce('added', o); } this.renderOnAddRemove && this.requestRenderAll(); return this; }
  remove(...objs) {
    for (const o of objs) {
      const i = this._objects.indexOf(o); if (i < 0) continue;
      if (this._activeObject && (o === this._activeObject || o.group === this._activeObject)) { const was = this.getActiveObjects(); this.fire('before:selection:cleared', { deselected: [this._activeObject] }); this._dropActive(); this.fire('selection:cleared', { deselected: was }); o.fire('deselected', { target: o }); }
      if (o === this._hovered) this._hovered = undefined; if (o.isEditing) o.exitEditing();
      this._objects.splice(i, 1); o.canvas = undefined; this._announce('removed', o);
    }
    this.renderOnAddRemove && this.requestRenderAll(); return this;
  }
  clear() { this.discardActiveObject(); for (const o of [...this._objects]) this.remove(o); this.backgroundColor = ''; this.requestRenderAll(); return this; }
  moveObjectTo(o, index) { const i = this._objects.indexOf(o); if (i < 0) return this; this._objects.splice(i, 1); this._objects.splice(index, 0, o); this.requestRenderAll(); return this; }
  sendObjectToBack(o) { return this.moveObjectTo(o, 0); }
  bringObjectToFront(o) { return this.moveObjectTo(o, this._objects.length - 1); }
  sendObjectBackwards(o) { return this.moveObjectTo(o, Math.max(0, this._objects.indexOf(o) - 1)); }
  bringObjectForward(o) { return this.moveObjectTo(o, Math.min(this._objects.length - 1, this._objects.indexOf(o) + 1)); }
  async loadFromJSON(json) { this.discardActiveObject(); for (const o of this._objects) o.canvas = undefined; await super.loadFromJSON(json); for (const o of this._objects) o.canvas = this; this.requestRenderAll(); return this; }

  // ---- selection
  getActiveObject() { return this._activeObject; }
  getActiveObjects() { const a = this._activeObject; return !a ? [] : a instanceof ActiveSelection ? [...a._objects] : [a]; }
  _fireSelection(old, e) {
    const now = this.getActiveObjects(), added = [], removed = [];
    for (const o of old) if (!now.includes(o)) { o.fire('deselected', { e, target: o }); removed.push(o); }
    for (const o of now) if (!old.includes(o)) { o.fire('selected', { e, target: o }); added.push(o); }
    if (old.length && now.length) { if (added.length || removed.length) this.fire('selection:updated', { e, selected: added, deselected: removed }); }
    else if (now.length) this.fire('selection:created', { e, selected: added }); else if (old.length) this.fire('selection:cleared', { e, deselected: removed });
  }
  _dropActive(e) {
    const a = this._activeObject; if (!a) return true;
    if (a.isEditing) a.exitEditing(); if (this._transform?.target === a) this._transform = null;
    this._activeObject = undefined; a.onDeselect({ e }); return true;
  }
  _setActive(o, e) { if (this._activeObject === o) return false; if (this._activeObject) this._dropActive(e); this._activeObject = o; if (o instanceof ActiveSelection) o.canvas = this; return true; }
  setActiveObject(o, e) { const old = this.getActiveObjects(), ok = this._setActive(o, e); this._fireSelection(old, e); this.requestRenderAll(); return ok; }
  discardActiveObject(e) {
    const old = this.getActiveObjects(), a = this._activeObject; if (old.length) this.fire('before:selection:cleared', { e, deselected: [a] });
    const done = this._dropActive(e); this._fireSelection(old, e); this.requestRenderAll(); return done;
  }
  _groupOf(...objs) { return new ActiveSelection(objs, { canvas: this }); }
  _isSelectionKey(e) { return !!e[this.selectionKey]; }

  // ---- finding what is under a point (canvas pixels in, objects out)
  _check(p, o) { // p: scene point
    if (!o || !o.visible || !o.evented || !o.containsPoint(p)) return false;
    if ((this.perPixelTargetFind || o.perPixelTargetFind) && !o.isEditing) { const v = tp(p, this.viewportTransform); return !this.isTargetTransparent(o, v.x, v.y); }
    return true;
  }
  _search(objects, p) { for (let i = objects.length - 1; i >= 0; i--) if (this._check(p, objects[i])) return objects[i]; }
  findTarget(e, skipGroup, noCorner) {
    if (this.skipTargetFind) return;
    const vp = this.getViewportPoint(e), p = tp(vp, inv(this.viewportTransform)), a = this._activeObject, objects = this.getActiveObjects();
    if (a && objects.length >= 1) {
      if (!noCorner && a._findTargetCorner(vp, e.pointerType === 'touch')) return a;
      if (objects.length > 1 && a instanceof ActiveSelection && !skipGroup && this._search([a], p)) return a;
      if (a === this._search([a], p)) { if (this.preserveObjectStacking && !noCorner) { const t = this._search(this._objects, p); return t && t.group instanceof ActiveSelection && !skipGroup ? t.group : t; } return a; }
    }
    const t = this._search(this._objects.filter(o => !(skipGroup && o.group)), p);
    return t;
  }
  isTargetTransparent(target, x, y) {
    const tol = this.targetFindTolerance, r = this.getRetinaScaling(), c = document.createElement('canvas'); c.width = this.lowerCanvasEl.width; c.height = this.lowerCanvasEl.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.setTransform(r, 0, 0, r, 0, 0); ctx.transform(...this.viewportTransform); this._drawOne(ctx, target, r);
    const d = ctx.getImageData(Math.max(0, Math.round((x - tol) * r)), Math.max(0, Math.round((y - tol) * r)), Math.max(1, Math.round((2 * tol + 1) * r)), Math.max(1, Math.round((2 * tol + 1) * r))).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false; return true;
  }

  // ---- drawing
  _drawOne(ctx, o, retina) {
    const zoom = this.viewportTransform[0] * retina, g = o.group;
    if (g) { const base = ctx.getTransform(); ctx.save(); ctx.transform(...g.calcTransformMatrix()); kbe.render(ctx, [o], { zoom, scaling: { x: Math.abs(g.scaleX), y: Math.abs(g.scaleY) }, root: base }); ctx.restore(); }
    else kbe.render(ctx, [o], { zoom });
  }
  requestRenderAll() { if (this._raf || this._disposed) return this; this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderAll(); }); return this; }
  renderAll() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this._disposed) return this;
    const ctx = this.contextContainer, r = this.getRetinaScaling();
    if (this.contextTopDirty && !this._groupSelector && !this.isDrawingMode) { this.clearContext(this.contextTop); this.contextTopDirty = false; }
    this.fire('before:render', { ctx }); this.clearContext(ctx);
    ctx.save(); ctx.setTransform(r, 0, 0, r, 0, 0);
    this._renderBackground(ctx);
    ctx.save(); ctx.transform(...this.viewportTransform);
    for (const o of this._objects) this._drawOne(ctx, o, r);
    ctx.restore();
    if (!this.controlsAboveOverlay && this.interactive) this._drawControls(ctx);
    this._renderOverlay(ctx);
    if (this.controlsAboveOverlay && this.interactive) this._drawControls(ctx);
    ctx.restore();
    if (this._groupSelector || this.isDrawingMode) this.renderTop();
    this.fire('after:render', { ctx }); return this;
  }
  _renderBackground(ctx) {
    const bg = this.backgroundColor; if (!bg) return; ctx.save(); if (this.backgroundVpt) ctx.transform(...this.viewportTransform);
    if (bg.colorStops) { const live = kbe.gradientFor(ctx, bg, { width: this.width, height: this.height }); ctx.translate(this.width / 2, this.height / 2); ctx.fillStyle = live; ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height); }
    else { ctx.fillStyle = bg; ctx.fillRect(0, 0, this.width, this.height); } ctx.restore();
  }
  _renderOverlay() {}
  _drawControls(ctx) { const a = this._activeObject; if (a) a._renderControls(ctx); }
  renderTop() { // the drag-box while it is being drawn
    const ctx = this.contextTop; this.clearContext(ctx);
    if (this._groupSelector && this.selection) {
      const g = this._groupSelector, x = Math.min(g.x, g.x + g.left), y = Math.min(g.y, g.y + g.top), w = Math.abs(g.left), h = Math.abs(g.top);
      ctx.save(); ctx.fillStyle = this.selectionColor; ctx.fillRect(x, y, w, h); ctx.lineWidth = this.selectionLineWidth; ctx.strokeStyle = this.selectionBorderColor; ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1)); ctx.restore(); this.contextTopDirty = true;
    }
    return this;
  }

  // ---- the mouse
  _listen() {
    const up = this.upperCanvasEl, on = (t, n, f, o) => { t.addEventListener(n, f, o); this._off.push(() => t.removeEventListener(n, f, o)); }; this._off = [];
    on(up, 'mousedown', e => this._onDown(e)); on(up, 'mousemove', e => { if (!this._pressed) this._onMove(e); }); on(up, 'mouseout', e => this._onOut(e)); on(up, 'mouseenter', e => this._onEnter(e));
    on(up, 'wheel', e => { this.fire('mouse:wheel', { e, target: this.findTarget(e) }); }, { passive: false }); on(up, 'dblclick', e => this._onDblClick(e));
    on(up, 'contextmenu', e => { if (this.stopContextMenu) e.preventDefault(); });
    this._docMove = e => { if (this._pressed) this._onMove(e); }; this._docUp = e => { if (this._pressed) this._onUp(e); };
  }
  dispose() { this._disposed = true; for (const f of this._off) f(); document.removeEventListener('mousemove', this._docMove); document.removeEventListener('mouseup', this._docUp); this.wrapperEl.replaceWith(this.lowerCanvasEl); this.upperCanvasEl.remove(); }
  _info(e, target) { const vp = this.getViewportPoint(e); return { e, target, subTargets: [], scenePoint: tp(vp, inv(this.viewportTransform)), viewportPoint: vp, isClick: this._isClick, transform: this._transform }; }
  _fireMouse(name, e, target) { this.fire('mouse:' + name, this._info(e, target)); }
  _shouldClear(e, target) {
    const objs = this.getActiveObjects(), a = this._activeObject;
    return !target || (target && a && objs.length > 1 && !objs.includes(target) && a !== target && !this._isSelectionKey(e)) || (target && !target.evented) || (target && !target.selectable && a && a !== target);
  }
  _shouldGroup(e, target) { const a = this._activeObject; return !!a && this._isSelectionKey(e) && this.selection && !!target && target.selectable && (a !== target || a instanceof ActiveSelection) && !a.isEditing; }
  _handleGrouping(e, target) {
    const a = this._activeObject;
    if (target === a) { target = this.findTarget(e, true); if (!target || !target.selectable) return; }
    const old = this.getActiveObjects();
    if (a instanceof ActiveSelection) {
      if (target.group === a) { a.remove(target); this._hovered = target; if (a.size() === 1) { this._setActive(a.item(0), e); this._fireSelection(old, e); return; } }
      else a.add(target);
    } else { const g = this._groupOf(...(this._objects.indexOf(a) < this._objects.indexOf(target) ? [a, target] : [target, a])); this._setActive(g, e); this._hovered = g; }
    this._fireSelection(old, e);
  }
  _origin(t, key, alt, action) {
    let ox = t.originX, oy = t.originY;
    if (key) { const c = t.controls[key]; ox = c.x < 0 ? 'right' : c.x > 0 ? 'left' : 'center'; oy = c.y < 0 ? 'bottom' : c.y > 0 ? 'top' : 'center'; }
    const scales = ['scale', 'scaleX', 'scaleY', 'resizing'].includes(action), centered = scales ? (this.centeredScaling || t.centeredScaling) !== !!alt : action === 'rotate' ? this.centeredRotation || t.centeredRotation : false;
    return centered ? { x: 'center', y: 'center' } : action === 'drag' ? { x: t.originX, y: t.originY } : { x: ox, y: oy };
  }
  _setupTransform(e, target, wasActive, corner) {
    const p = this.getScenePoint(e), ctl = corner ? target.controls[corner] : null, action = ctl ? ctl.getActionName(e, target) : 'drag', alt = e[this.centeredKey], org = this._origin(target, corner, alt, action);
    this._transform = { target, action, corner, actionPerformed: false, scaleX: target.scaleX, scaleY: target.scaleY, skewX: target.skewX, skewY: target.skewY, offsetX: p.x - target.left, offsetY: p.y - target.top,
      originX: org.x, originY: org.y, ex: p.x, ey: p.y, lastX: p.x, lastY: p.y, theta: rad(target.angle), width: target.width, height: target.height, shiftKey: e.shiftKey, altKey: alt, wasActive,
      original: { cropX: target.cropX, cropY: target.cropY, scaleX: target.scaleX, scaleY: target.scaleY, flipX: target.flipX, flipY: target.flipY, skewX: target.skewX, skewY: target.skewY, angle: target.angle, left: target.left, top: target.top, originX: org.x, originY: org.y } };
    if (ctl?.actionHandler) this._transform.handler = ctl.actionHandler; else this._transform.handler = dragHandler;
    this.fire('before:transform', { e, transform: this._transform });
  }
  _onDown(e) {
    this._pressed = true; this._isClick = true; this.calcOffset();
    document.addEventListener('mousemove', this._docMove); document.addEventListener('mouseup', this._docUp);
    const target = this.findTarget(e); this._fireMouse('down:before', e, target);
    if (e.button === 2) { if (this.fireRightClick) this._fireMouse('down', e, target); this._pressed = false; this._unhook(); return; }
    if (e.button === 1) { if (this.fireMiddleClick) this._fireMouse('down', e, target); this._pressed = false; this._unhook(); return; }
    if (this.isDrawingMode) { this._activeObject && this.discardActiveObject(e); this.freeDrawingBrush?.onMouseDown(this.getScenePoint(e), { e }); this._fireMouse('down', e, target); return; }
    if (this._transform) return;
    this._editing = this._activeObject?.isEditing ? this._activeObject : null;
    const vp = this.getViewportPoint(e), grouped = this._shouldGroup(e, target); let t = target;
    if (this._shouldClear(e, t)) this.discardActiveObject(e); else if (grouped) { this._handleGrouping(e, t); t = this._activeObject; }
    if (this.selection && (!t || (!t.selectable && !t.isEditing && t !== this._activeObject))) this._groupSelector = { x: vp.x, y: vp.y, left: 0, top: 0 };
    if (t) {
      const was = t === this._activeObject; if (t.selectable && t.activeOn === 'down') this.setActiveObject(t, e);
      const corner = t.findControl(vp, e.pointerType === 'touch')?.key;
      if (t === this._activeObject && (corner || !grouped)) this._setupTransform(e, t, was, corner);
      if (t.isEditing && t instanceof Textbox) { e.preventDefault(); t._editDown(this.getScenePoint(e), e.detail, e.shiftKey); if (e.detail < 2 && !e.shiftKey) this._editDrag = t; }
    }
    this._fireMouse('down', e, target); this.requestRenderAll();
  }
  _unhook() { document.removeEventListener('mousemove', this._docMove); document.removeEventListener('mouseup', this._docUp); }
  _onMove(e) {
    this._isClick = false; this._fireMouse('move:before', e);
    if (this.isDrawingMode) { this.setCursor(this.freeDrawingCursor); if (this._pressed) this.freeDrawingBrush?.onMouseMove(this.getScenePoint(e), { e }); this._fireMouse('move', e); return; }
    if (this._editDrag?.isEditing) this._editDrag._editMove(this.getScenePoint(e));
    else if (this._groupSelector) { const vp = this.getViewportPoint(e); this._groupSelector.left = vp.x - this._groupSelector.x; this._groupSelector.top = vp.y - this._groupSelector.y; this.renderTop(); }
    else if (!this._transform) { const t = this.findTarget(e); this._setCursor(e, t); this._overOut(e, t, this.skipTargetFind ? undefined : this._search(this._objects, tp(this.getViewportPoint(e), inv(this.viewportTransform)))); }
    else this._doTransform(e);
    this._fireMouse('move', e);
  }
  _setCursor(e, target) {
    if (!target) { this.setCursor(this.defaultCursor); return; }
    const a = this._activeObject instanceof ActiveSelection ? this._activeObject : null, vp = this.getViewportPoint(e), corner = (!a || !a.contains(target)) && target._findTargetCorner(vp, e.pointerType === 'touch');
    if (!corner) this.setCursor(target.isEditing ? 'text' : target.hoverCursor || this.hoverCursor); else this.setCursor(target.controls[corner].cursorFor(e, target));
  }
  _overOut(e, target, actual) { // as Fabric: the canvas also hears when the object really under the pointer changes while a handle keeps the target
    const old = this._hovered, was = this._hoveredActual, moved = old !== target, under = was !== actual;
    const out = { e, target: old, nextTarget: target, actualTarget: was, nextActualTarget: actual }, over = { e, target, previousTarget: old, actualTarget: actual, previousActualTarget: was };
    if ((old && moved) || (was && under)) this.fire('mouse:out', out); if (old && moved) old.fire('mouseout', out); if (was && under && was !== old) was.fire('mouseout', out);
    if ((target && moved) || (actual && under)) this.fire('mouse:over', over); if (target && moved) target.fire('mouseover', over); if (actual && under && actual !== target) actual.fire('mouseover', over);
    this._hovered = target; this._hoveredActual = actual;
  }
  _onOut(e) { const t = this._hovered; this.fire('mouse:out', { e, target: t }); this._hovered = undefined; t?.fire('mouseout', { e }); }
  _onEnter(e) { if (!this._transform && !this.findTarget(e)) { this.fire('mouse:over', { e }); this._hovered = undefined; } }
  _doTransform(e) {
    const tr = this._transform, t = tr.target, p = this.getScenePoint(e); tr.shiftKey = e.shiftKey; tr.altKey = e[this.centeredKey];
    const org = this._origin(t, tr.corner, tr.altKey, tr.action), inv = { left: 'right', right: 'left', top: 'bottom', bottom: 'top', center: 'center' }; tr.baseX = org.x; tr.baseY = org.y;
    tr.originX = tr.original && t.flipX !== tr.original.flipX && tr.action !== 'rotate' ? inv[org.x] : org.x; tr.originY = tr.original && t.flipY !== tr.original.flipY && tr.action !== 'rotate' ? inv[org.y] : org.y;
    const done = !!tr.handler && tr.handler(e, tr, p.x, p.y);
    if (tr.action === 'drag' && done) { t.isMoving = true; this.setCursor(t.moveCursor || this.moveCursor); }
    tr.actionPerformed = tr.actionPerformed || done; tr.lastX = p.x; tr.lastY = p.y; if (done) { this.requestRenderAll(); }
  }
  _onUp(e) {
    this._pressed = false; this._unhook(); const target = this.findTarget(e), tr = this._transform, click = this._isClick;
    this._fireMouse('up:before', e, target);
    if (this.isDrawingMode) { this.freeDrawingBrush?.onMouseUp({ e }); this._fireMouse('up', e, target); return; }
    let render = false, enter = null;
    if (tr) { // finish the transform
      tr.target.setCoords(); if (tr.actionPerformed) { const info = { e, target: tr.target, transform: tr, action: tr.action }; this.fire('object:modified', info); tr.target.fire('modified', info); render = true; }
    }
    if (!click && this._groupSelector && this.selection) { this._collect(e); render = true; }
    this._setCursor(e, tr?.target || target); // before a click can start editing: Fabric leaves the pointer cursor until the next move
    if (target) {
      if (target.selectable && target !== this._activeObject && target.activeOn === 'up') { this.setActiveObject(target, e); render = true; }
      if (target instanceof Textbox && tr && tr.wasActive && !tr.corner && !tr.actionPerformed && !target.isEditing && target.editable && target === this._activeObject && !this._editing) {
        enter = target; render = true;
      }
      target.isMoving = false;
    }
    this._editDrag?._editUp(); this._editDrag = null; this._editing = null;
    this._fireMouse('up', e, target); this._groupSelector = null;  this._transform = null; this.clearContext(this.contextTop); this.contextTopDirty = false;
    if (enter) { enter.enterEditing(); enter._editDown(this.getScenePoint(e), 1, false); enter._editUp(); } // after mouse:up, as Fabric does
    if (render) this.requestRenderAll(); else this.renderTop();
  }
  _collect(e) {
    const g = this._groupSelector, inv0 = inv(this.viewportTransform), a = tp({ x: g.x, y: g.y }, inv0), b = tp({ x: g.x + g.left, y: g.y + g.top }, inv0), picked = [];
    for (let i = this._objects.length - 1; i >= 0; i--) {
      const o = this._objects[i]; if (!o || !o.selectable || !o.visible) continue;
      if (this.selectionFullyContained ? o.isContainedWithinRect(a, b) : o.intersectsWithRect(a, b) || o.isContainedWithinRect(a, b) || o.containsPoint(a) || o.containsPoint(b)) picked.push(o);
    }
    if (picked.length === 1) this.setActiveObject(picked[0], e);
    else if (picked.length > 1) this.setActiveObject(this._groupOf(...picked.reverse()), e);
  }
  _onDblClick(e) {
    const target = this.findTarget(e); this._fireMouse('dblclick', e, target); target?.fire('mousedblclick', { e, target });
    if (target?.isEditing) target.selectWord(target._offsetAtScene(this.getScenePoint(e)));
  }
  toObject(keys) { // members of a live multi-selection are saved where they sit on the page, not relative to the selection
    const a = this._activeObject; if (!(a instanceof ActiveSelection) || !a._objects.length) return super.toObject(keys);
    const PROPS = ['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY', 'skewX', 'skewY'], kept = a._objects.map(o => [o, Object.fromEntries(PROPS.map(k => [k, o[k]]))]);
    a._restoreChildren();
    try { return super.toObject(keys); } finally { for (const [o, v] of kept) { Object.assign(o, v); o.group = a; o.setCoords(); } a.setCoords(); }
  }
}
Canvas.prototype.freeDrawingBrush = undefined;
Object.assign(kbe, { Canvas, ActiveSelection, Control, PencilBrush });
internal.decompose = decompose; Object.assign(internal, { anchored, withEvent, emit, scaleCursor, localPoint, rad });
})();
