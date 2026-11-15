// Shared random and app-style object specs for engine-check.cjs and engine-render-check.cjs (fixed seed; SEED=n changes it).
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-data/create-fabric6.json'), 'utf8'));
// ---- deterministic random specs (a fixed seed keeps runs repeatable)
let seed = Number(process.env.SEED) || 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)], num = (lo, hi, dp = 3) => +(lo + rnd() * (hi - lo)).toFixed(dp);
const COLOURS = ['#ffd966', '#444', 'red', 'rgb(1,2,3)', 'rgba(0,0,0,0.5)', '#12345678', '', null];
const gradient = () => rnd() < 0.2 ? { type: 'radial', gradientUnits: 'percentage', colorStops: [{ offset: 0, color: '#fa0' }, { offset: 1, color: '#00f' }], coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 } } : rnd() < 0.5
  ? { type: 'linear', gradientUnits: pick(['pixels', 'percentage']), colorStops: [{ offset: 0, color: '#fff' }, { offset: num(0.2, 1), color: '#000', opacity: num(0, 1) }], coords: { x1: num(0, 1), y1: 0, x2: num(0, 80), y2: num(0, 1) } }
  : { type: 'radial', gradientUnits: 'pixels', colorStops: [{ offset: 0, color: '#fa0' }, { offset: 1, color: '#00f' }], coords: { x1: 5, y1: 6, r1: 0, x2: 5, y2: 6, r2: num(1, 90) } };
const look = () => {
  const o = {};
  if (rnd() < 0.7) o.fill = rnd() < 0.2 ? { gradient: gradient() } : pick(COLOURS);
  if (rnd() < 0.6) o.stroke = pick(COLOURS);
  if (rnd() < 0.6) o.strokeWidth = pick([0, 1, 3, 2.5, num(0, 9)]);
  if (rnd() < 0.3) o.strokeDashArray = pick([[6, 4], [1, 2, 3], null]);
  if (rnd() < 0.3) Object.assign(o, { strokeLineCap: pick(['round', 'square']), strokeLineJoin: pick(['round', 'bevel']), strokeUniform: rnd() < 0.5, strokeMiterLimit: num(1, 9, 5), strokeDashOffset: num(0, 5, 5) });
  if (rnd() < 0.6) o.angle = pick([0, 30, -90, 180, num(0, 360, 5)]);
  if (rnd() < 0.5) Object.assign(o, { scaleX: num(0.2, 3, 5), scaleY: num(0.2, 3, 5) });
  if (rnd() < 0.15) Object.assign(o, { skewX: num(-20, 20, 5), skewY: num(-20, 20, 5) });
  if (rnd() < 0.2) Object.assign(o, { flipX: true, flipY: rnd() < 0.5 });
  if (rnd() < 0.3) o.opacity = num(0, 1, 5);
  if (rnd() < 0.3) o.shadow = pick([{ color: '#00000055', blur: num(0, 20), offsetX: num(-9, 9), offsetY: 6 }, { shadow: 'rgba(0,0,0,0.3) 5px 5px 10px' }]);
  if (rnd() < 0.2) Object.assign(o, { visible: false, paintFirst: 'stroke', fillRule: 'evenodd', globalCompositeOperation: 'multiply', backgroundColor: '#eee' });
  if (rnd() < 0.3) Object.assign(o, { kbName: 'Item ' + Math.floor(rnd() * 99), kbLocked: rnd() < 0.5, kbFrame: 'heart' });
  if (rnd() < 0.6) Object.assign(o, { left: num(-50, 400), top: num(-50, 400) });
  if (rnd() < 0.2) Object.assign(o, { originX: pick(['left', 'center', 'right']), originY: pick(['top', 'center', 'bottom']) });
  return o;
};
const pts = () => Array.from({ length: 3 + Math.floor(rnd() * 5) }, () => ({ x: num(-30, 120), y: num(-30, 120) }));
const PATHS = ['M 20 0 L 240 0 Q 260 0 260 20 L 260 120 Q 260 140 240 140 L 90 140 L 40 180 L 50 140 L 20 140 Q 0 140 0 120 L 0 20 Q 0 0 20 0 Z',
  'M 10 10 C 40 -20 80 50 100 20 S 150 80 120 90 Z', 'M0 0h50v30h-50z', 'M 5 5 l 10 0 l 0 10 q 5 5 10 0 t 10 0 z', 'M 10 10 L 20 30 40 5 60 40',
  'M 10 40 A 30 20 0 0 1 70 40 A 30 20 0 1 1 10 40 Z', 'M 5 5 a 10 10 30 1 0 20 5 V 40 H 3 Z'];
const spec = (cls, args, opts) => ({ cls, args, opts });
const specs = [];
for (let i = 0; i < 40; i++) {
  specs.push(spec('Rect', [], { width: num(0, 200), height: num(0, 200), ...(rnd() < 0.4 ? { rx: num(0, 20), ry: num(0, 20) } : {}), ...look() }));
  specs.push(spec('Circle', [], { radius: num(0, 90), ...look() }));
  specs.push(spec('Ellipse', [], { rx: num(0, 90), ry: num(0, 60), ...look() }));
  specs.push(spec('Triangle', [], { width: num(1, 200), height: num(1, 200), ...look() }));
  specs.push(spec('Line', [[num(-20, 200), num(-20, 200), num(-20, 200), num(-20, 200)]], look()));
  specs.push(spec('Polygon', [pts()], look()));
  specs.push(spec('Polyline', [pts()], look()));
  specs.push(spec('Path', [pick(PATHS)], look()));
}
specs.push(spec('Triangle', [], { width: 36, height: 36, fill: '#444444', left: 2, top: -18, angle: -90 }), spec('Rect', [], {}), spec('Line', [[0, 0, 0, 0]], {}), spec('Path', [''], {}));
// the app never sets strokeUniform or skew; rotated uniform strokes and skewed children inside a freshly built Group are a documented gap
const tame = k => !k.opts ? k : { ...k, opts: { ...k.opts, skewX: 0, skewY: 0, ...(k.opts.strokeUniform && k.opts.angle ? { strokeUniform: false } : {}) } };
const groupSpec = () => ({ cls: 'Group', kids: Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => tame(pick(specs.slice(0, 320)))), opts: pick([{}, { kbName: 'Group', left: 7, top: 9 }, { after: { angle: 25, scaleX: 1.3 } }, { subTargetCheck: false, kbName: 'Crossword grid' }]) });
for (let i = 0; i < 20; i++) specs.push(groupSpec());
for (const k of specs.slice(0, 320)) specs.push({ cls: 'Group', kids: [tame(k)], label: 'Group of one ' + k.cls, opts: {} });
const clipSpecs = [], clipOf = () => ({ cls: pick(['Circle', 'Rect', 'Path']), opts: { radius: 30, width: 40, height: 30, left: 0, top: 0, ...(rnd() < 0.5 ? { absolutePositioned: true } : {}), ...(rnd() < 0.3 ? { inverted: true } : {}) } });
for (let i = 0; i < 12; i++) clipSpecs.push({ base: pick(specs.slice(0, 40)), clip: clipOf() });
// shapes the app builds with its own settings (left/top origins as create.js sets them)
const appShapes = [
  spec('Triangle', [], { width: 200, height: 180, fill: '#ffd966', stroke: '#444444', strokeWidth: 3, kbName: 'Triangle' }),
  spec('Polygon', [Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 45 : 100; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; })], { fill: '#ffd966', stroke: '#444444', strokeWidth: 3, kbName: 'Star' }),
  spec('Path', [PATHS[0]], { fill: '#ffd966', stroke: '#444444', strokeWidth: 3, kbName: 'Speech bubble' }),
  spec('Path', [PATHS[0]], { fill: '#ccc', strokeWidth: 0, kbFrame: 'heart', kbName: 'Photo frame', left: 0, top: 0, originX: 'center', originY: 'center' }),
  spec('Ellipse', [], { rx: 20, ry: 12, originX: 'center', originY: 'center', left: 10, top: 5 }),
  spec('Polyline', [[{ x: 0, y: 40 }, { x: 30, y: 10 }, { x: 60, y: 30 }]], { fill: '', stroke: '#9b6bd6', strokeWidth: 4, strokeLineJoin: 'round', strokeLineCap: 'round', kbName: 'Line' }),
  spec('Line', [[0, 24, 120, 24]], { stroke: '#777777', strokeWidth: 1, strokeDashArray: [6, 4] }),
  spec('Rect', [], { left: 40, top: 40, width: 100, height: 60, rx: 12, ry: 12, stroke: '#9b6bd6', strokeWidth: 3, kbName: 'Border' }),
  spec('Circle', [], { left: 5, top: 5, radius: 10, fill: '#fff', shadow: { color: '#00000055', blur: 10, offsetX: 6, offsetY: 6 } })
];
specs.push(...appShapes);


module.exports = { specs, clipSpecs, PATHS, fixture };
