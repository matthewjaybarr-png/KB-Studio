// SVG import for the own engine: kbe.loadSVGFromString(text) turns the shapes of an SVG into engine objects, kbe.util.groupSVGElements
// gathers them. Original code. Supports rect, circle, ellipse, line, polyline, polygon, path and g, with fill, stroke and their widths,
// dashes, caps, joins, opacities, the style attribute, transforms (also inherited from g) and the viewBox. Gradients, patterns, clip
// paths, text, use and images inside an SVG are not read.
(function () {
'use strict';
const kbe = globalThis.kbe, { Point, Rect, Circle, Ellipse, Line, Polyline, Polygon, Path, Group } = kbe, U = kbe.util;
const mul = U.multiplyTransformMatrices, tp = U.transformPoint, IDENT = [1, 0, 0, 1, 0, 0];
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const nums = s => (String(s).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);

// transform="rotate(20) translate(5 5)" as one matrix
function parseTransform(text) {
  let m = IDENT;
  for (const [, name, args] of String(text || '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args); let t;
    if (name === 'matrix') t = a;
    else if (name === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (name === 'scale') t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (name === 'rotate') { const r = rad(a[0] || 0), c = Math.cos(r), s = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0; t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; }
    else if (name === 'skewX') t = [1, 0, Math.tan(rad(a[0])), 1, 0, 0];
    else t = [1, Math.tan(rad(a[0])), 0, 1, 0, 0];
    if (t.length === 6) m = mul(m, t);
  }
  return m;
}

// scale, skew and turn of a matrix (what an object keeps) apart from where it sits
function decompose([a, b, c, d]) {
  const denom = a * a + b * b, scaleX = Math.sqrt(denom), scaleY = scaleX ? (a * d - c * b) / scaleX : 0;
  return { angle: deg(Math.atan2(b, a)), scaleX, scaleY, skewX: deg(Math.atan2(a * c + b * d, denom)) };
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'fill-opacity', 'stroke-opacity'];
function styleOf(el, parent) {
  const s = {}; for (const k of INHERITED) if (k in parent) s[k] = parent[k];
  if (parent.opacity !== undefined) s.opacity = parent.opacity; // a group's opacity is carried down and multiplied
  const own = {};
  for (const a of el.attributes) if (INHERITED.includes(a.name) || a.name === 'opacity') own[a.name] = a.value.trim();
  for (const decl of (el.getAttribute('style') || '').split(';')) { const i = decl.indexOf(':'); if (i > 0) own[decl.slice(0, i).trim()] = decl.slice(i + 1).trim(); }
  for (const [k, v] of Object.entries(own)) s[k] = k === 'opacity' ? (parent.opacity ?? 1) * parseFloat(v) : v;
  return s;
}

let colorCtx;
function withAlpha(color, alpha) { // 'rgb(r,g,b)' style with the alpha folded in, as an SVG paint with fill-opacity draws
  colorCtx ||= document.createElement('canvas').getContext('2d'); colorCtx.fillStyle = '#000'; colorCtx.fillStyle = color;
  const v = colorCtx.fillStyle, m = /^rgba?\(([^)]*)\)/.exec(v), c = m ? m[1].split(',').map(Number) : [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const a = (c[3] ?? 1) * alpha; return a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(4)})`;
}
function paintOf(value, opacity, none) {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'transparent') return none;
  if (value.startsWith('url(')) return none; // gradients and patterns in SVG files are not read
  return opacity !== undefined && opacity !== 1 ? withAlpha(value, opacity) : value;
}
function appearance(s) {
  const o = {}, fill = paintOf(s.fill, s['fill-opacity'] === undefined ? undefined : parseFloat(s['fill-opacity']), ''), stroke = paintOf(s.stroke, s['stroke-opacity'] === undefined ? undefined : parseFloat(s['stroke-opacity']), null);
  if (fill !== undefined) o.fill = fill; else if (s['fill-opacity'] !== undefined) o.fill = withAlpha('#000', parseFloat(s['fill-opacity']));
  if (stroke !== undefined) o.stroke = stroke;
  if (s['stroke-width'] !== undefined) o.strokeWidth = parseFloat(s['stroke-width']);
  if (s['stroke-dasharray'] && s['stroke-dasharray'] !== 'none') { const d = nums(s['stroke-dasharray']); if (d.length) o.strokeDashArray = d.length % 2 ? [...d, ...d] : d; }
  if (s['stroke-linecap']) o.strokeLineCap = s['stroke-linecap'];
  if (s['stroke-linejoin']) o.strokeLineJoin = s['stroke-linejoin'];
  if (s['stroke-miterlimit']) o.strokeMiterLimit = parseFloat(s['stroke-miterlimit']);
  if (s['fill-rule']) o.fillRule = s['fill-rule'];
  if (s.opacity !== undefined && !Number.isNaN(s.opacity)) o.opacity = s.opacity;
  return o;
}

// a shape, then moved by its matrix about its own middle
function place(obj, matrix) {
  const c = obj.getCenterPoint();
  if (matrix.some((v, i) => v !== IDENT[i])) { obj.set(decompose(matrix)); obj.setPositionByOrigin(tp(c, matrix), 'center', 'center'); }
  return obj;
}
const len = (el, name, fallback = 0) => { const v = parseFloat(el.getAttribute(name)); return Number.isNaN(v) ? fallback : v; };
function shape(el, look) {
  const tag = el.localName.toLowerCase(), at = n => len(el, n);
  const centred = (o, cx, cy) => o.setPositionByOrigin(new Point(cx, cy), 'center', 'center');
  switch (tag) {
    case 'rect': { const w = at('width'), h = at('height'), rx = el.hasAttribute('rx') ? at('rx') : at('ry'), ry = el.hasAttribute('ry') ? at('ry') : rx; return centred(new Rect({ ...look, width: w, height: h, rx, ry }), at('x') + w / 2, at('y') + h / 2); }
    case 'circle': return centred(new Circle({ ...look, radius: at('r') }), at('cx'), at('cy'));
    case 'ellipse': return centred(new Ellipse({ ...look, rx: at('rx'), ry: at('ry') }), at('cx'), at('cy'));
    case 'line': return new Line([at('x1'), at('y1'), at('x2'), at('y2')], look);
    case 'polyline': case 'polygon': { const n = nums(el.getAttribute('points')), pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] }); return new (tag === 'polygon' ? Polygon : Polyline)(pts, look); }
    case 'path': return new Path(el.getAttribute('d') || '', look);
  }
}

// how the viewBox maps onto the width and height (centred, keeping the proportions, as an SVG does by default)
function viewBoxMatrix(root, width, height) {
  const vb = nums(root.getAttribute('viewBox') || ''); if (vb.length !== 4 || !vb[2] || !vb[3]) return IDENT;
  const s = Math.min(width / vb[2], height / vb[3]);
  return [s, 0, 0, s, -vb[0] * s + (width - vb[2] * s) / 2, -vb[1] * s + (height - vb[3] * s) / 2];
}

kbe.loadSVGFromString = async function (text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return { objects: [], elements: [], options: {}, allElements: [] };
  const vb = nums(root.getAttribute('viewBox') || ''), hasVB = vb.length === 4;
  const width = len(root, 'width', hasVB ? vb[2] : 0), height = len(root, 'height', hasVB ? vb[3] : 0);
  const base = viewBoxMatrix(root, width, height), objects = [], elements = [];
  const walk = (el, parentStyle, parentMatrix) => {
    for (const child of el.children) {
      const tag = child.localName.toLowerCase();
      if (['defs', 'clippath', 'mask', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'pattern', 'symbol'].includes(tag)) continue;
      if (child.getAttribute('display') === 'none' || /display:\s*none/.test(child.getAttribute('style') || '')) continue;
      const style = styleOf(child, parentStyle), matrix = mul(parentMatrix, parseTransform(child.getAttribute('transform')));
      if (tag === 'g' || tag === 'a') { walk(child, style, matrix); continue; }
      const o = shape(child, appearance(style)); if (!o) continue;
      objects.push(place(o, matrix)); elements.push(child);
    }
  };
  walk(root, {}, base);
  return { objects, options: { width, height, viewBoxWidth: hasVB ? vb[2] : width, viewBoxHeight: hasVB ? vb[3] : height }, elements, allElements: elements };
};
U.groupSVGElements = (elements, options) => elements.length === 1 && !(elements[0] instanceof Group) ? elements[0] : new Group(elements, options);
U.parseTransform = parseTransform; U.qrDecompose = m => ({ ...decompose(m), skewY: 0, translateX: m[4], translateY: m[5] });
})();
