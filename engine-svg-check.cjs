// A/B of SVG import, FabricImage and pattern fills of the own engine (ui/engine/svg.js, image.js) against the Fabric build it replaces,
// in headless Chromium: saved data (toObject) and drawn pixels are compared. Usage: node engine-svg-check.cjs [--verbose] [--show] (CHROMIUM=path).
// The decoration SVGs are read from ui/decor.js so the check follows what the app really imports.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = __dirname;
const decorSrc = fs.readFileSync(path.join(root, 'ui/decor.js'), 'utf8');
const decorLiteral = decorSrc.slice(0, decorSrc.indexOf('const DECOR_GROUPS')).replace(/^const svgOf = [^\n]*/m, '');
const svgHelper = decorSrc.match(/const svgOf = [^\n]*/)[0];
const scripts = ['model', 'render', 'text', 'editor', 'canvas', 'image', 'svg'].filter(n => fs.existsSync(path.join(root, 'ui/engine', n + '.js'))).map(n => `<script src="file://${root}/ui/engine/${n}.js"></script>`).join('');
const page = `<script src="file://${require("./fabric-ref.cjs").fabric()}"></script>${scripts}<pre id=out></pre><script>
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
Object.assign(kbe.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
${svgHelper}
${decorLiteral}
const S = 400, SHOW = ${JSON.stringify(process.argv.includes('--show'))};
const round = v => typeof v === 'number' ? Math.round(v * 1e3) / 1e3 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
const clean = o => JSON.parse(JSON.stringify(round(o)));
const diff = (a, b, p = '') => { if (typeof a !== typeof b || (a && typeof a !== 'object') || !a || !b) return a === b ? '' : p + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], p + '.' + k); if (d) return d; } return ''; };
const pixels = c => c.getContext('2d').getImageData(0, 0, S, S).data;
function compare(a, b) { let sum = 0, bad = 0; for (let i = 0; i < a.length; i += 4) { const wa = a[i + 3] / 255, wb = b[i + 3] / 255; let worst = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] * wa + 255 * (1 - wa) - (b[i + k] * wb + 255 * (1 - wb))); sum += d; if (d > worst) worst = d; } if (worst > 48) bad++; } return { mean: sum / (a.length / 4 * 3), bad: bad / (a.length / 4) }; }
async function pair(label, make, { place = o => o } = {}) {
  const row = { label };
  try {
    const f = place(await make(fabric)); row.fabric = clean(f.toObject()); const o = place(await make(kbe));
    row.own = clean(o.toObject()); row.diff = diff(row.fabric, row.own);
    const fc = new fabric.StaticCanvas(null, { width: S, height: S }); fc.add(f); fc.renderAll();
    const oc = document.createElement('canvas'); oc.width = oc.height = S; await kbe.prepare([o]); kbe.render(oc.getContext('2d'), [o]);
    const r = compare(pixels(fc.getElement()), pixels(oc)); row.bad = r.bad; row.mean = r.mean; row.drawn = pixels(fc.getElement()).some((v, i) => i % 4 === 3 && v);
  } catch (e) { row.error = String(e && e.stack || e).slice(0, 600); }
  if (SHOW) row.show = row.fabric; return row;
}
const grouped = async (L, svg) => { const { objects, options } = await L.loadSVGFromString(svg); const parts = objects.filter(Boolean), art = parts.length > 1 ? L.util.groupSVGElements(parts, options) : new L.Group(parts); art.scale(200 / Math.max(art.getScaledWidth(), art.getScaledHeight())); art.set({ left: 30, top: 40 }); return art; };
const loose = async (L, svg) => { const { objects, options } = await L.loadSVGFromString(svg); return { objects, options }; };
const png = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f80'); g.addColorStop(1, '#08f'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.fillRect(w / 4, h / 4, w / 2, h / 4); x.fillStyle = '#fff'; x.fillRect(5, 5, 20, 20); return c.toDataURL('image/png'); };
(async () => {
  const rows = [];
  for (const [id, name, , svg] of DECOR) rows.push(await pair('decor ' + id, L => grouped(L, svg)));
  const extra = {
    'nested transforms': svgOf(100, 80, '<g transform="translate(10 5) rotate(20)" fill="#e44"><rect x="5" y="5" width="30" height="20"/><g transform="scale(1.5 0.8)"><circle cx="40" cy="30" r="10" fill="#38f" opacity="0.5"/></g></g>'),
    'style attribute and inherit': svgOf(100, 80, '<g style="fill:#3a3;stroke:#222;stroke-width:3"><rect x="10" y="10" width="40" height="30"/><ellipse cx="70" cy="50" rx="20" ry="10" style="fill:none"/></g>'),
    'poly and line': svgOf(100, 80, '<polygon points="10,10 50,10 30,40" fill="#a3c"/><polyline points="60,10 90,20 70,50" fill="none" stroke="#333" stroke-width="2"/><line x1="5" y1="70" x2="95" y2="60" stroke="#c33" stroke-width="4" stroke-linecap="round"/>'),
    'paths': svgOf(100, 80, '<path d="M10 70 L30 10 Q50 0 60 30 T90 40 C80 60 60 80 40 60 Z" fill="#fc3" stroke="#630" stroke-width="2" stroke-linejoin="round"/><path d="M5 5 h20 v10 H5 z m40 0 a10 10 0 1 0 20 0" fill="none" stroke="#06c" stroke-dasharray="4 2"/>'),
    'opacity and rgba': svgOf(100, 80, '<rect x="10" y="10" width="50" height="50" fill="rgba(200,0,0,0.5)" stroke="#000" stroke-width="4" stroke-opacity="0.5"/><circle cx="60" cy="40" r="25" fill="#00f" fill-opacity="0.3" opacity="0.8"/>'),
    'viewBox scale': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 40" width="100" height="80"><rect x="5" y="5" width="30" height="20" fill="#c0c"/><circle cx="35" cy="25" r="10" fill="#0c0"/></svg>',
  };
  for (const [label, svg] of Object.entries(extra)) rows.push(await pair('svg ' + label, L => grouped(L, svg)));
  const url = png(120, 80);
  const imageSpecs = { 'plain': {}, 'crop': { cropX: 20, cropY: 10, width: 70, height: 50 }, 'scaled flipped': { scaleX: 1.4, scaleY: 0.8, angle: 25, flipX: true, left: 120, top: 60 }, 'opacity': { opacity: 0.5, left: 30, top: 30 } };
  for (const [label, o] of Object.entries(imageSpecs)) {
    rows.push(await pair('image fromURL ' + label, async L => { const im = await L.FabricImage.fromURL(url); im.set({ left: 40, top: 40, ...o }); return im; }));
    rows.push(await pair('image fromObject ' + label, async L => { const base = await L.FabricImage.fromURL(url); const saved = { ...clean(base.toObject()), left: 40, top: 40, ...o }; const im = await L.FabricImage.fromObject(saved); return im; }));
  }
  rows.push(await pair('image shadow and clip', async L => { const im = await L.FabricImage.fromURL(url); im.set({ left: 60, top: 60, shadow: new L.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 8, offsetX: 6, offsetY: 6 }), clipPath: new L.Circle({ radius: 40, left: 0, top: 0, originX: 'center', originY: 'center', inverted: false, absolutePositioned: false }) }); return im; }));
  rows.push(await pair('image in group', async L => { const im = await L.FabricImage.fromURL(url); const g = new L.Group([im, new L.Rect({ width: 30, height: 30, left: 50, top: 50, fill: '#f0f' })], { left: 30, top: 30, angle: 10 }); return g; }));
  const tile = () => { const c = document.createElement('canvas'); c.width = 24; c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#fc0'; x.fillRect(0, 0, 24, 16); x.fillStyle = '#c03'; x.fillRect(0, 0, 12, 8); x.fillRect(12, 8, 12, 8); return c; };
  const patterns = { 'repeat': {}, 'repeat-x offset': { repeat: 'repeat-x', offsetX: 7, offsetY: 5 }, 'transform': { patternTransform: [0.8, 0.3, -0.3, 0.8, 4, 2] }, 'no-repeat': { repeat: 'no-repeat', offsetX: 20, offsetY: 10 } };
  for (const [label, o] of Object.entries(patterns)) {
    rows.push(await pair('pattern fill ' + label, async L => new L.Rect({ left: 40, top: 40, width: 150, height: 100, strokeWidth: 0, fill: new L.Pattern({ source: tile(), ...o }) })));
    rows.push(await pair('pattern fill from saved data ' + label, async L => { const saved = clean(new L.Pattern({ source: tile(), ...o }).toObject()); const r = await L.Rect.fromObject({ ...clean(new L.Rect({ left: 40, top: 40, width: 150, height: 100, strokeWidth: 0 }).toObject()), fill: saved }); return r; }));
  }
  rows.push(await pair('pattern stroke', async L => new L.Circle({ left: 50, top: 50, radius: 70, fill: '', stroke: new L.Pattern({ source: tile() }), strokeWidth: 20 })));
  const stops = [{ offset: 0, color: '#f60' }, { offset: 1, color: '#06f' }];
  const grads = {
    'linear transform': { type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: 150, y2: 0 }, colorStops: stops, gradientTransform: [0.8, 0.5, -0.5, 0.8, 10, 5] },
    'percentage radial transform': { type: 'radial', gradientUnits: 'percentage', coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }, colorStops: stops, gradientTransform: [1, 0, 0.3, 1, 0, 0] },
    'percentage linear transform': { type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: 1, y2: 0 }, colorStops: stops, gradientTransform: [1, 0, 0, 0.5, 0, 20] },
  };
  for (const [label, g] of Object.entries(grads)) {
    rows.push(await pair('gradient fill ' + label, async L => new L.Rect({ left: 40, top: 40, width: 150, height: 100, strokeWidth: 0, fill: new L.Gradient(g) })));
    rows.push(await pair('gradient stroke ' + label, async L => new L.Rect({ left: 40, top: 40, width: 150, height: 100, fill: '', stroke: new L.Gradient(g), strokeWidth: 12 })));
  }
  rows.push(await pair('image getters', async L => { const im = await L.FabricImage.fromURL(url); const r = new L.Rect({ width: 5, height: 5 }); r.set({ tag: [im.getSrc() === url, im.getElement().naturalWidth, im.type, im.width, im.height] }); return Object.assign(r, { toObject: () => ({ tag: r.tag }) }); }));
  document.getElementById('out').textContent = JSON.stringify({ rows });
})().catch(e => { document.getElementById('out').textContent = JSON.stringify({ error: String(e && e.stack || e) }); });
</script>`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-engine-svg-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page);
if (process.env.KEEP) { fs.copyFileSync(file, process.env.KEEP); }
const run = cp.spawnSync(process.env.CHROMIUM || 'chromium', ['--headless', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--virtual-time-budget=120000', '--dump-dom', 'file://' + file], { encoding: 'utf8', maxBuffer: 1 << 30 });
fs.rmSync(dir, { recursive: true, force: true });
const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout || '');
if (!m) { console.error('no result from the browser', (run.stderr || '').slice(0, 500)); process.exit(1); }
const res = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (res.error) { console.error(res.error); process.exit(1); }
// Fabric scales the context by the object's size for a percentage gradient and then strokes, so the line becomes hundreds of times wider and
// covers the page; the own renderer draws the sane stroke. The app never strokes with a percentage gradient, so this is not copied.
const KNOWN = /^gradient stroke percentage/; let known = 0;
const BAD = 0.02; let failed = 0;
for (const r of res.rows) {
  const problems = [];
  if (process.env.DUMP && r.label.includes(process.env.DUMP)) console.log(r.label, JSON.stringify(r.fabric));
  if (r.error) problems.push('error ' + r.error);
  if (r.diff) problems.push('saved data ' + r.diff.slice(0, 300));
  if (r.bad > BAD) problems.push(`pixels ${(r.bad * 100).toFixed(2)}% strong, mean ${r.mean.toFixed(2)}`);
  if (problems.length && KNOWN.test(r.label)) { known++; console.log('known difference: ' + r.label + ' (' + problems.join('; ') + ')'); continue; }
  if (problems.length) { failed++; console.log('FAIL ' + r.label + '\n    ' + problems.join('\n    ')); } else if (process.argv.includes('--verbose')) console.log('pass ' + r.label + (r.drawn ? '' : ' (nothing drawn)'));
}
console.log(`${failed ? 'FAIL' : 'PASS'}: ${res.rows.length - failed - known}/${res.rows.length} svg, image, pattern and gradient cases match` + (known ? `, ${known} known differences` : ''));
process.exit(failed ? 1 : 0);
