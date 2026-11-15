// KB Studio's own object model: a Fabric-shaped subset (Rect, Circle, Ellipse, Triangle, Line, Polygon, Polyline,
// Path, Group, Shadow, Gradient, Point) with toObject/loadFromJSON/enlivenObjects. Original code, no rendering yet:
// it reads and writes the same saved-design JSON as Fabric. Loaded as a plain script; exposes `kbe`.
(function (root) {
'use strict';
const VERSION = '7.4.0'; // the `version` stamp saved with every object, kept equal to the Fabric build it replaces
const DIGITS = 4;
const round = (n, d = DIGITS) => typeof n === 'number' ? parseFloat(n.toFixed(d)) : n;
const rad = deg => deg * Math.PI / 180;
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

class Point {
  constructor(x = 0, y = 0) { if (typeof x === 'object' && x) ({ x, y } = x); this.x = x; this.y = y; }
  add(p) { return new Point(this.x + p.x, this.y + p.y); }
  subtract(p) { return new Point(this.x - p.x, this.y - p.y); }
  multiply(p) { return new Point(this.x * p.x, this.y * p.y); }
  divide(p) { return new Point(this.x / p.x, this.y / p.y); }
  scalarAdd(n) { return new Point(this.x + n, this.y + n); }
  scalarMultiply(n) { return new Point(this.x * n, this.y * n); }
  eq(p) { return this.x === p.x && this.y === p.y; }
  lerp(p, t = 0.5) { return new Point(this.x + (p.x - this.x) * t, this.y + (p.y - this.y) * t); }
  distanceFrom(p) { return Math.hypot(this.x - p.x, this.y - p.y); }
  midPointFrom(p) { return this.lerp(p); }
  min(p) { return new Point(Math.min(this.x, p.x), Math.min(this.y, p.y)); }
  max(p) { return new Point(Math.max(this.x, p.x), Math.max(this.y, p.y)); }
  transform(m, noTranslate) { return new Point(m[0] * this.x + m[2] * this.y + (noTranslate ? 0 : m[4]), m[1] * this.x + m[3] * this.y + (noTranslate ? 0 : m[5])); }
  rotate(deg, about = new Point()) { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)), x = this.x - about.x, y = this.y - about.y; return new Point(about.x + x * c - y * s, about.y + x * s + y * c); }
  clone() { return new Point(this.x, this.y); }
  setXY(x, y) { this.x = x; this.y = y; return this; }
}

// Matrices are [a, b, c, d, e, f] like canvas transforms.
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (a, b, twoByTwo) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  twoByTwo ? 0 : a[0] * b[4] + a[2] * b[5] + a[4], twoByTwo ? 0 : a[1] * b[4] + a[3] * b[5] + a[5]];
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
const transformPoint = (p, m, noTranslate) => new Point(p).transform(m, noTranslate);
function scaleSkewMatrix({ scaleX = 1, scaleY = 1, skewX = 0, skewY = 0, flipX, flipY }) {
  let m = [flipX ? -scaleX : scaleX, 0, 0, flipY ? -scaleY : scaleY, 0, 0];
  if (skewX) m = multiply(m, [1, 0, Math.tan(rad(skewX)), 1, 0, 0], true);
  if (skewY) m = multiply(m, [1, Math.tan(rad(skewY)), 0, 1, 0, 0], true);
  return m;
}
function composeMatrix({ translateX = 0, translateY = 0, angle = 0, ...rest }) {
  let m = [1, 0, 0, 1, translateX, translateY];
  if (angle) { const c = Math.cos(rad(angle)), s = Math.sin(rad(angle)); m = multiply(m, [c, s, -s, c, 0, 0]); }
  return multiply(m, scaleSkewMatrix(rest));
}
const boundsOf = pts => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};

class Shadow {
  constructor(o = {}) {
    if (typeof o === 'string') o = Shadow.parse(o);
    this.color = o.color ?? 'rgb(0,0,0)'; this.blur = o.blur ?? 0; this.offsetX = o.offsetX ?? 0; this.offsetY = o.offsetY ?? 0;
    this.affectStroke = o.affectStroke ?? false; this.nonScaling = o.nonScaling ?? false;
    if (o.id !== undefined) this.id = o.id;
  }
  // "rgba(0,0,0,.3) 5px 5px 10px" as CSS writes it
  static parse(s) {
    const m = s.trim().match(/^(rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+)?\s*(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s*(-?[\d.]+)?/i) || [];
    return { color: m[1] || 'rgb(0,0,0)', offsetX: parseFloat(m[2]) || 0, offsetY: parseFloat(m[3]) || 0, blur: parseFloat(m[4]) || 0 };
  }
  toObject() { return { color: this.color, blur: this.blur, offsetX: this.offsetX, offsetY: this.offsetY, affectStroke: this.affectStroke, nonScaling: this.nonScaling, type: 'shadow' }; }
  static fromObject(o) { return Promise.resolve(new Shadow(o)); }
}

class Gradient {
  constructor({ type = 'linear', gradientUnits = 'pixels', coords = {}, colorStops = [], offsetX = 0, offsetY = 0, gradientTransform, id } = {}) {
    this.type = type; this.gradientUnits = gradientUnits; this.offsetX = offsetX; this.offsetY = offsetY;
    this.coords = { x1: 0, y1: 0, x2: 0, y2: 0, ...(type === 'radial' ? { r1: 0, r2: 0 } : {}), ...coords };
    this.colorStops = colorStops.map(s => ({ ...s }));
    if (gradientTransform) this.gradientTransform = [...gradientTransform];
    if (id !== undefined) this.id = id;
  }
  toObject() {
    const o = { type: this.type, coords: { ...this.coords }, colorStops: this.colorStops.map(s => ({ ...s })), offsetX: this.offsetX, offsetY: this.offsetY, gradientUnits: this.gradientUnits };
    if (this.gradientTransform) o.gradientTransform = [...this.gradientTransform];
    return o;
  }
  static fromObject(o) { return Promise.resolve(new Gradient(o)); }
}

const registry = new Map();
const register = (cls, ...names) => { for (const n of [cls.name, ...names]) registry.set(n.toLowerCase(), cls); };
const classOf = type => { const c = registry.get(String(type).toLowerCase()); if (!c) throw new Error(`No class registered for ${type}`); return c; };

const isGradient = v => v && typeof v === 'object' && Array.isArray(v.colorStops);
const asPaint = v => v == null || typeof v === 'string' || v instanceof Gradient ? v : isGradient(v) ? new Gradient(v) : v;
const paintOut = v => v && v.toObject ? v.toObject() : v;
const ORIGIN = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };

class FabricObject {
  static ownDefaults = {
    originX: 'center', originY: 'center', left: 0, top: 0, width: 0, height: 0, fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 1, strokeDashArray: null,
    strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, scaleX: 1, scaleY: 1, angle: 0,
    flipX: false, flipY: false, opacity: 1, shadow: null, visible: true, backgroundColor: '', fillRule: 'nonzero', paintFirst: 'fill',
    globalCompositeOperation: 'source-over', skewX: 0, skewY: 0
  };
  static get type() { return this.name; }
  // Defaults of the whole class chain, base first
  static defaults() {
    const chain = []; for (let c = this; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) if (Object.hasOwn(c, 'ownDefaults')) chain.unshift(c.ownDefaults);
    return Object.assign({}, ...chain);
  }
  constructor(options = {}) { Object.assign(this, this.constructor.defaults()); this.set(options); }
  get type() { return this.constructor.type.toLowerCase(); } // like Fabric: 'rect', 'image', 'textbox'; saved data and class names keep the capitals
  set(key, value) {
    if (typeof key === 'object') { for (const k in key) this.set(k, key[k]); return this; }
    if (key === 'scaleX' || key === 'scaleY') { this[key] = value; return this; }
    if (key === 'shadow' && value && !(value instanceof Shadow)) value = new Shadow(value);
    if (key === 'fill' || key === 'stroke') value = asPaint(value);
    this[key] = value; return this;
  }
  get(key) { return this[key]; }
  scale(value) { this.scaleX = this.scaleY = value; return this; }
  // size on the page including the stroke, scale and skew; the box the origin is measured against
  _transformedDims() {
    const { width, height, scaleX, scaleY, skewX, skewY, strokeWidth, strokeUniform } = this;
    const pre = strokeUniform ? 0 : strokeWidth, post = strokeUniform ? strokeWidth : 0, w = width + pre, h = height + pre;
    if (!skewX && !skewY) return new Point(w * scaleX + post, h * scaleY + post);
    const m = scaleSkewMatrix(this), b = boundsOf([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => new Point(x, y).transform(m, true)));
    return new Point(b.width + post, b.height + post);
  }
  getCenterPoint() { const c = this.getRelativeCenterPoint(); return this.group ? c.transform(this.group.calcTransformMatrix()) : c; }
  getRelativeCenterPoint() {
    const d = this._transformedDims(), p = new Point(this.left, this.top);
    return new Point((0.5 - ORIGIN[this.originX]) * d.x, (0.5 - ORIGIN[this.originY]) * d.y).rotate(this.angle).add(p);
  }
  // put the object where `center` is the middle of its box, keeping its own origin
  setCenterPoint(center) {
    const d = this._transformedDims(), off = new Point((ORIGIN[this.originX] - 0.5) * d.x, (ORIGIN[this.originY] - 0.5) * d.y).rotate(this.angle);
    const p = center.add(off); this.left = p.x; this.top = p.y; return this;
  }
  calcOwnMatrix() { const c = this.getRelativeCenterPoint(); return composeMatrix({ translateX: c.x, translateY: c.y, angle: this.angle, scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, flipX: this.flipX, flipY: this.flipY }); }
  calcTransformMatrix() { return this.group ? multiply(this.group.calcTransformMatrix(), this.calcOwnMatrix()) : this.calcOwnMatrix(); }
  // corners of the stroke-inclusive box through the full transform (a skewed shape gives a slanted quad)
  // shortcut: a strokeUniform stroke on a rotated or skewed object is measured slightly differently than Fabric (the app never sets strokeUniform); exact in the renderer step
  getCoords() {
    const m = this.calcTransformMatrix(), pre = this.strokeUniform ? 0 : this.strokeWidth;
    const w = this.width + pre + (this.strokeUniform ? this.strokeWidth / Math.abs(this.scaleX) : 0), h = this.height + pre + (this.strokeUniform ? this.strokeWidth / Math.abs(this.scaleY) : 0);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new Point((this.flipX ? -sx : sx) * w / 2, (this.flipY ? -sy : sy) * h / 2).transform(m)); // corners keep their names when flipped
  }
  getBoundingRect() { return boundsOf(this.getCoords()); }
  _own() { return {}; }
  toObject(keys = []) {
    const o = {};
    for (const k of keys) if (k in this) o[k] = this[k];
    Object.assign(o, this._own(), { type: this.constructor.type, version: VERSION, originX: this.originX, originY: this.originY,
      left: round(this.left), top: round(this.top), width: round(this.width), height: round(this.height), fill: paintOut(this.fill), stroke: paintOut(this.stroke),
      strokeWidth: round(this.strokeWidth), strokeDashArray: this.strokeDashArray ? [...this.strokeDashArray] : this.strokeDashArray, strokeLineCap: this.strokeLineCap,
      strokeDashOffset: this.strokeDashOffset, strokeLineJoin: this.strokeLineJoin, strokeUniform: this.strokeUniform, strokeMiterLimit: round(this.strokeMiterLimit),
      scaleX: round(this.scaleX), scaleY: round(this.scaleY), angle: round(this.angle), flipX: this.flipX, flipY: this.flipY, opacity: round(this.opacity),
      shadow: this.shadow ? this.shadow.toObject() : this.shadow, visible: this.visible, backgroundColor: this.backgroundColor, fillRule: this.fillRule,
      paintFirst: this.paintFirst, globalCompositeOperation: this.globalCompositeOperation, skewX: round(this.skewX), skewY: round(this.skewY) });
    if (this.clipPath) o.clipPath = { ...this.clipPath.toObject(keys), inverted: this.clipPath.inverted, absolutePositioned: this.clipPath.absolutePositioned };
    return o;
  }
  static async fromObject(object, options) {
    const { type, version, ...rest } = object;
    const o = await enlivenProps(rest, options);
    return new this(this.ctorArgs ? this.ctorArgs(o) : o, ...(this.ctorArgs ? [o] : []));
  }
}
FabricObject.ownDefaults = { ...FabricObject.ownDefaults };

// shadow, fill, stroke and clipPath arrive as plain data in saved designs and are rebuilt here
async function enlivenProps(o, options) {
  const out = { ...o };
  if (out.shadow && typeof out.shadow === 'object') out.shadow = new Shadow(out.shadow);
  for (const k of ['fill', 'stroke']) if (isGradient(out[k])) out[k] = new Gradient(out[k]);
  for (const k of ['fill', 'stroke']) if (out[k] && out[k].type === 'pattern' && root.kbe.Pattern) out[k] = await root.kbe.Pattern.fromObject(out[k]);
  if (out.clipPath && typeof out.clipPath === 'object') { const [c] = await enlivenObjects([out.clipPath], options); out.clipPath = c; }
  return out;
}

class Rect extends FabricObject {
  static ownDefaults = { rx: 0, ry: 0 };
  _own() { return { rx: this.rx, ry: this.ry }; }
}
class Circle extends FabricObject {
  static ownDefaults = { radius: 0, startAngle: 0, endAngle: 360, counterClockwise: false };
  constructor(o = {}) { super(o); if (o.radius !== undefined && o.width === undefined) this.set({ width: this.radius * 2, height: this.radius * 2 }); }
  set(k, v) { super.set(k, v); if (k === 'radius') { this.width = this.height = v * 2; } return this; }
  _own() { return { radius: this.radius, startAngle: this.startAngle, endAngle: this.endAngle, counterClockwise: this.counterClockwise }; }
}
class Ellipse extends FabricObject {
  static ownDefaults = { rx: 0, ry: 0 };
  constructor(o = {}) { super(o); if (o.rx !== undefined || o.ry !== undefined) { this.width = this.rx * 2; this.height = this.ry * 2; } }
  _own() { return { rx: this.rx, ry: this.ry }; }
}
class Triangle extends FabricObject { static ownDefaults = { width: 100, height: 100 }; }

class Line extends FabricObject {
  static ownDefaults = { x1: 0, y1: 0, x2: 0, y2: 0 };
  constructor([x1, y1, x2, y2] = [0, 0, 0, 0], options = {}) {
    super(options); this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
    this._fit(options);
  }
  _fit(options) {
    const { x1, y1, x2, y2 } = this, width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
    const mid = new Point(Math.min(x1, x2) + width / 2, Math.min(y1, y2) + height / 2);
    this.width = width; this.height = height;
    // x1..y2 are kept relative to the middle of the box, so the line stays put when the object moves
    const dx = x1 <= x2 ? -1 : 1, dy = y1 <= y2 ? -1 : 1;
    this.x1 = dx * width / 2; this.x2 = -dx * width / 2; this.y1 = dy * height / 2; this.y2 = -dy * height / 2;
    if (options.left === undefined && options.top === undefined) this.setCenterPoint(mid);
    else { if (options.left === undefined) this.setCenterPoint(new Point(mid.x, 0)), this.top = options.top; if (options.top === undefined) { const l = this.left; this.setCenterPoint(new Point(0, mid.y)); this.left = options.left ?? l; } }
  }
  _own() { return { x1: this.x1, x2: this.x2, y1: this.y1, y2: this.y2 }; }
  static async fromObject({ x1, y1, x2, y2, ...object }, options) {
    const o = await enlivenProps(object, options), { type, version, ...rest } = o;
    const line = new Line([x1, y1, x2, y2], rest); line.x1 = x1; line.y1 = y1; line.x2 = x2; line.y2 = y2; return line;
  }
}

class Polyline extends FabricObject {
  static ownDefaults = { points: [], exactBoundingBox: false, strokeLineJoin: 'miter' };
  constructor(points = [], options = {}) {
    super(options); this.points = points.map(p => ({ x: p.x, y: p.y }));
    this._fit(options);
  }
  _bbox() { return boundsOf(this.points.map(p => new Point(p))); }
  _fit(options) {
    const b = this._bbox(); this.width = b.width; this.height = b.height;
    this.pathOffset = new Point(b.left + b.width / 2, b.top + b.height / 2);
    if (options.left === undefined && options.top === undefined) this.setCenterPoint(this.pathOffset);
    else { const keep = { left: options.left, top: options.top }; this.setCenterPoint(this.pathOffset); if (keep.left !== undefined) this.left = keep.left; if (keep.top !== undefined) this.top = keep.top; }
  }
  _own() { return { points: this.points.map(p => ({ x: p.x, y: p.y })) }; }
  static async fromObject({ points, ...object }, options) {
    const o = await enlivenProps(object, options), { type, version, left, top, width, height, ...rest } = o;
    const pl = new this(points, { ...rest, left, top }); pl.width = width ?? pl.width; pl.height = height ?? pl.height; return pl;
  }
}
class Polygon extends Polyline {}

// ---- Path: parse the "d" string, then measure the curve
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function parsePath(d) {
  const out = []; let i = 0;
  const number = () => { const m = /^[\s,]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(d.slice(i)); if (!m) throw Error('bad path: ' + d.slice(i, i + 12)); i += m[0].length; return parseFloat(m[1]); };
  const flag = () => { const m = /^[\s,]*([01])/.exec(d.slice(i)); if (!m) throw Error('bad arc flag'); i += m[0].length; return +m[1]; };
  while (i < d.length) {
    const m = /^\s*([a-zA-Z])/.exec(d.slice(i)); if (!m) { if (/^\s*$/.test(d.slice(i))) break; throw Error('bad path: ' + d.slice(i, i + 12)); }
    i += m[0].length; let cmd = m[1];
    const n = ARGS[cmd.toLowerCase()]; if (n === undefined) throw Error('bad path command ' + cmd);
    if (!n) { out.push([cmd]); continue; }
    do {
      const seg = [cmd];
      for (let k = 0; k < n; k++) seg.push(cmd.toLowerCase() === 'a' && (k === 3 || k === 4) ? flag() : number());
      out.push(seg); if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    } while (/^[\s,]*[-+.\d]/.test(d.slice(i)));
  }
  return arcsToCubics(out);
}
// Paths are stored in the simple form Fabric saves: absolute M, L, C, Q and Z only (H/V, S/T, arcs and relative commands are rewritten)
function arcsToCubics(path) {
  let x = 0, y = 0, sx = 0, sy = 0, prev = null; const out = [];
  for (const seg of path) {
    const c = seg[0], C = c.toUpperCase(), ox = c !== C ? x : 0, oy = c !== C ? y : 0, v = seg.slice(1), here = { x, y };
    let ctl = null;
    if (C === 'Z') { out.push(['Z']); x = sx; y = sy; }
    else if (C === 'M') { x = ox + v[0]; y = oy + v[1]; sx = x; sy = y; out.push(['M', x, y]); }
    else if (C === 'L' || C === 'H' || C === 'V') { x = C === 'V' ? x : ox + v[0]; y = C === 'H' ? y : oy + v[C === 'V' ? 0 : 1]; out.push(['L', x, y]); }
    else if (C === 'C') { out.push(['C', ox + v[0], oy + v[1], ox + v[2], oy + v[3], ox + v[4], oy + v[5]]); ctl = { c: { x: ox + v[2], y: oy + v[3] }, cubic: true }; x = ox + v[4]; y = oy + v[5]; }
    else if (C === 'S') { const a = prev?.cubic ? { x: 2 * x - prev.c.x, y: 2 * y - prev.c.y } : here; out.push(['C', a.x, a.y, ox + v[0], oy + v[1], ox + v[2], oy + v[3]]); ctl = { c: { x: ox + v[0], y: oy + v[1] }, cubic: true }; x = ox + v[2]; y = oy + v[3]; }
    else if (C === 'Q') { out.push(['Q', ox + v[0], oy + v[1], ox + v[2], oy + v[3]]); ctl = { c: { x: ox + v[0], y: oy + v[1] }, cubic: false }; x = ox + v[2]; y = oy + v[3]; }
    else if (C === 'T') { const a = prev && !prev.cubic ? { x: 2 * x - prev.c.x, y: 2 * y - prev.c.y } : here; out.push(['Q', a.x, a.y, ox + v[0], oy + v[1]]); ctl = { c: a, cubic: false }; x = ox + v[0]; y = oy + v[1]; }
    else if (C === 'A') {
      const ex = ox + v[5], ey = oy + v[6], curves = arcToCubics(x, y, v[0], v[1], v[2], v[3], v[4], ex, ey);
      if (!curves.length) out.push(['L', ex, ey]); else for (const [, a, b, e] of curves) out.push(['C', a.x, a.y, b.x, b.y, e.x, e.y]);
      x = ex; y = ey;
    }
    prev = ctl;
  }
  return out;
}
const cubicBounds = (p0, p1, p2, p3, pts) => {
  pts.push(p0, p3);
  for (const axis of ['x', 'y']) {
    const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis], b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]), c = p1[axis] - p0[axis];
    const ts = Math.abs(a) < 1e-12 ? (b ? [-c / b] : []) : (() => { const disc = b * b - 4 * a * c; return disc < 0 ? [] : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)]; })();
    for (const t of ts) if (t > 0 && t < 1) { const u = 1 - t; pts.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y }); }
  }
};
// An SVG arc (endpoint form) as cubic curves, at most a quarter turn each
function arcToCubics(x0, y0, rx, ry, rot, large, sweep, x, y) {
  if (!rx || !ry || (x0 === x && y0 === y)) return [];
  rx = Math.abs(rx); ry = Math.abs(ry); const phi = rad(rot), c = Math.cos(phi), s = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2, x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  const lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)) ** 0.5 * (large === sweep ? -1 : 1);
  const cx1 = sq * rx * y1 / ry, cy1 = -sq * ry * x1 / rx, cx = c * cx1 - s * cy1 + (x0 + x) / 2, cy = s * cx1 + c * cy1 + (y0 + y) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry); let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), step = dt / n, k = 4 / 3 * Math.tan(step / 4), out = [];
  const at = (t) => ({ p: { x: cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, y: cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c },
    d: { x: -rx * Math.sin(t) * c - ry * Math.cos(t) * s, y: -rx * Math.sin(t) * s + ry * Math.cos(t) * c } });
  for (let i = 0; i < n; i++) { const a = at(t0 + i * step), b = at(t0 + (i + 1) * step); out.push([a.p, { x: a.p.x + k * a.d.x, y: a.p.y + k * a.d.y }, { x: b.p.x - k * b.d.x, y: b.p.y - k * b.d.y }, b.p]); }
  return out;
}
function pathBounds(path) {
  const pts = []; let x = 0, y = 0, sx = 0, sy = 0;
  for (const [cmd, ...v] of path) {
    const here = { x, y };
    if (cmd === 'M') { x = sx = v[0]; y = sy = v[1]; pts.push({ x, y }); }
    else if (cmd === 'L') { x = v[0]; y = v[1]; pts.push({ x, y }); }
    else if (cmd === 'C') { cubicBounds(here, { x: v[0], y: v[1] }, { x: v[2], y: v[3] }, { x: v[4], y: v[5] }, pts); x = v[4]; y = v[5]; }
    else if (cmd === 'Q') {
      // shortcut: Fabric measures a quadratic as a cubic with both controls on the quadratic's one control, which bulges
      // further than the true curve; the same box keeps old and new saves laid out alike (exact bounds: renderer step)
      const c = { x: v[0], y: v[1] }, e = { x: v[2], y: v[3] };
      cubicBounds(here, c, c, e, pts); x = e.x; y = e.y;
    }
    else if (cmd === 'Z') { x = sx; y = sy; }
  }
  return pts.length ? boundsOf(pts) : { left: 0, top: 0, width: 0, height: 0 };
}
class Path extends FabricObject {
  static ownDefaults = { path: [] };
  constructor(path = [], options = {}) {
    super(options); this.path = (typeof path === 'string' ? parsePath(path) : path).map(s => [...s]);
    this._fit(options);
  }
  _fit(options) {
    const b = pathBounds(this.path); this.width = b.width; this.height = b.height;
    this.pathOffset = new Point(b.left + b.width / 2, b.top + b.height / 2);
    this.setCenterPoint(this.pathOffset);
    if (options.left !== undefined) this.left = options.left;
    if (options.top !== undefined) this.top = options.top;
  }
  _own() { return { path: this.path.map(s => [...s]) }; }
  static async fromObject({ path, ...object }, options) {
    const o = await enlivenProps(object, options), { type, version, left, top, width, height, ...rest } = o;
    const p = new Path(path, { ...rest, left, top }); p.width = width ?? p.width; p.height = height ?? p.height; return p;
  }
}

class Group extends FabricObject {
  static ownDefaults = { strokeWidth: 0, subTargetCheck: false, interactive: false, layoutManager: { type: 'layoutManager', strategy: 'fit-content' } };
  constructor(objects = [], options = {}, relative = false) {
    super(options); this._objects = objects;
    if (!relative) this._layout(options);
    for (const o of objects) o.group = this;
  }
  getObjects() { return [...this._objects]; }
  // fit-content: the group is the box around its children; children are then re-measured from the group's middle
  _layout(options) {
    if (!this._objects.length) return;
    const boxes = this._objects.map(o => boundsOf(o.getCoords())), all = boundsOf(boxes.flatMap(b => [new Point(b.left, b.top), new Point(b.left + b.width, b.top + b.height)]));
    const mid = new Point(all.left + all.width / 2, all.top + all.height / 2);
    for (const o of this._objects) o.setCenterPoint(o.getRelativeCenterPoint().subtract(mid));
    this.width = all.width; this.height = all.height;
    // the group sits where its children were, measured at its own origin; its own scale and angle do not move it
    this.left = options.left ?? all.left + ORIGIN[this.originX] * all.width;
    this.top = options.top ?? all.top + ORIGIN[this.originY] * all.height;
  }
  _own() { return { subTargetCheck: this.subTargetCheck, interactive: this.interactive }; }
  toObject(keys = []) {
    const o = super.toObject(keys);
    return Object.assign(o, { layoutManager: { ...this.layoutManager }, objects: this._objects.map(c => c.toObject(keys)) });
  }
  static async fromObject({ objects = [], layoutManager, ...object }, options) {
    const kids = await enlivenObjects(objects, options), o = await enlivenProps(object, options), { type, version, ...rest } = o;
    return new Group(kids, { ...rest, ...(layoutManager ? { layoutManager } : {}) }, true);
  }
}

// Types whose drawing and layout come in later steps (image, text): kept as the saved data, handed back unchanged apart from the version stamp.
class SavedObject extends FabricObject {
  constructor(raw = {}, props = raw) {
    super(); this.raw = clone(raw);
    for (const k of Object.keys(props)) if (k !== 'type' && k !== 'version' && (k in this || k === 'clipPath')) super.set(k, props[k]); // position, size and look, so it can be placed and drawn
  }
  get type() { return String(this.raw.type).toLowerCase(); }
  set(k, v) { if (this.raw) this.raw[k] = v; return super.set(k, v); }
  toObject(keys = []) { const o = { ...clone(this.raw), version: VERSION }; if (o.clipPath) o.clipPath.version = VERSION; for (const k of keys) if (k in this) o[k] = this[k]; return o; }
  static async fromObject(object, options) { return new SavedObject(object, await enlivenProps(object, options)); }
}

register(Rect); register(Circle); register(Ellipse); register(Triangle); register(Line); register(Polyline); register(Polygon); register(Path); register(Group);
for (const t of ['Image', 'FabricImage', 'Textbox', 'IText', 'Text', 'FabricText']) registry.set(t.toLowerCase(), SavedObject);

async function enlivenObjects(objects, options) {
  return Promise.all(objects.map(o => classOf(o.type).fromObject(o, options)));
}

class StaticCanvas {
  constructor(el, options = {}) { this._objects = []; this.width = options.width ?? 0; this.height = options.height ?? 0; this.backgroundColor = options.backgroundColor ?? ''; this.viewportTransform = [1, 0, 0, 1, 0, 0]; this.element = el; if (el && el.getContext && !options.keepSize) { el.width = this.width; el.height = this.height; } }
  add(...objs) { this._objects.push(...objs); return this; }
  remove(...objs) { this._objects = this._objects.filter(o => !objs.includes(o)); return this; }
  insertAt(i, ...objs) { this._objects.splice(i, 0, ...objs); return this; }
  getObjects() { return [...this._objects]; }
  clear() { this._objects = []; this.backgroundColor = ''; return this; }
  get background() { return this.backgroundColor; }
  toObject(keys = []) {
    const o = { version: VERSION, objects: this._objects.map(c => c.toObject(keys)) };
    if (this.backgroundColor) o.background = paintOut(this.backgroundColor);
    return o;
  }
  async loadFromJSON(json) {
    const { objects = [], background } = typeof json === 'string' ? JSON.parse(json) : json;
    const kids = await enlivenObjects(objects);
    this.clear(); this._objects = kids; this.backgroundColor = isGradient(background) ? new Gradient(background) : background ?? '';
    return this;
  }
}

root.kbe = { internal: { registry, enlivenProps, round, VERSION, ORIGIN, boundsOf, clone }, version: VERSION, Point, Shadow, Gradient, FabricObject, Object: FabricObject, Rect, Circle, Ellipse, Triangle, Line, Polyline, Polygon, Path, Group, StaticCanvas, SavedObject,
  classRegistry: { getClass: classOf }, util: { enlivenObjects, multiplyTransformMatrices: multiply, invertTransform: invert, transformPoint, composeMatrix, parsePath, toFixed: round, degreesToRadians: d => d * Math.PI / 180, radiansToDegrees: r => r * 180 / Math.PI } };
})(typeof window !== 'undefined' ? window : globalThis);
