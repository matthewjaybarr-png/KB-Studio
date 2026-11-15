// A/B check of the own object model (ui/engine/model.js) against the Fabric build it replaces (Fabric 7.4.0 from git history, see fabric-ref.cjs).
// (Arc arithmetic differs from Fabric's in the last binary digit, and a value can land either side of a 4-digit rounding step, so construction allows 1.1e-4.)
// Runs both in headless Chromium: the same constructor calls and the same saved designs go through each, and every
// toObject() must match. Set CHROMIUM to select the browser. Usage: node engine-check.cjs [--verbose]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = __dirname;
const { specs, clipSpecs, PATHS, fixture } = require('./engine-specs.cjs');

const page = `<script src="file://${require("./fabric-ref.cjs").fabric()}"></script><script src="file://${root}/ui/engine/model.js"></script><pre id=out></pre><script>
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
Object.assign(kbe.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
const specs = ${JSON.stringify(specs)}, clipSpecs = ${JSON.stringify(clipSpecs)}, fixture = ${JSON.stringify(fixture.doc.canvas)};
const KEEP = ['kbName', 'kbLocked', 'kbFrame', 'kbEffect'];
const clean = v => JSON.parse(JSON.stringify(v));
const paint = (L, v) => v && v.gradient ? new L.Gradient(v.gradient) : v;
function build(L, s) {
  if (s.cls === 'Group') { const { after, ...opts } = s.opts, g = new L.Group(s.kids.map(k => build(L, k)), opts); if (after) g.set(after); return g; } // the app scales and turns a group after building it
  const o = { ...s.opts }; for (const k of ['fill', 'stroke']) if (k in o) o[k] = paint(L, o[k]);
  if (o.shadow && o.shadow.shadow) o.shadow = new L.Shadow(o.shadow.shadow); else if (o.shadow) o.shadow = new L.Shadow(o.shadow);
  return new L[s.cls](...s.args, o);
}
const diff = (a, b, p = '', out = []) => {
  if (out.length > 6) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p + '.' + k, out); }
  else if (a !== b && !(typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < TOL)) out.push(p + ': fabric=' + JSON.stringify(a) + ' own=' + JSON.stringify(b));
  return out;
};
let TOL = 0;
(async () => {
  const res = { construct: [], load: [], clip: [], canvas: [], fixture: [], counts: {} };
  const run = async (list, tag, fn) => { let ok = 0; for (const [i, item] of list.entries()) { const d = await fn(item); if (d.length) res[tag].push({ i, cls: item.label || item.cls || (item.base && 'clip'), diff: d, opts: JSON.stringify(item.kids ? { group: item.opts, kids: item.kids.map(k => [k.cls, k.args, k.opts]) } : item.opts || item).slice(0, 900) }); else ok++; } res.counts[tag] = [ok, list.length]; };
  // 1. same constructor calls through both
  await run(specs, 'construct', async s => { TOL = 1.1e-4; return diff(clean(build(fabric, s).toObject(KEEP)), clean(build(kbe, s).toObject(KEEP))); });
  // 2. what Fabric saved is read by both and written back
  await run(specs, 'load', async s => {
    TOL = 0; const saved = clean(build(fabric, s).toObject(KEEP));
    const [f] = await fabric.util.enlivenObjects([clean(saved)]), [k] = await kbe.util.enlivenObjects([clean(saved)]);
    const a = clean(f.toObject(KEEP)), b = clean(k.toObject(KEEP)); return [...diff(a, b), ...diff(saved, b).map(x => 'vs saved ' + x)];
  });
  // 3. clip paths
  await run(clipSpecs, 'clip', async s => { TOL = 0; const mk = L => { const o = build(L, s.base); const c = s.clip.cls === 'Path' ? new L.Path(${JSON.stringify(PATHS[1])}, { left: 0, top: 0, absolutePositioned: s.clip.opts.absolutePositioned, inverted: s.clip.opts.inverted }) : new L[s.clip.cls]({ ...(s.clip.cls === 'Circle' ? { radius: 30 } : { width: 40, height: 30 }), left: 0, top: 0, absolutePositioned: s.clip.opts.absolutePositioned, inverted: s.clip.opts.inverted }); o.set({ clipPath: c }); return o; };
    const saved = clean(mk(fabric).toObject(KEEP)), [k] = await kbe.util.enlivenObjects([clean(saved)]); return diff(saved, clean(k.toObject(KEEP))); });
  // 4. whole pages, with a background colour and a gradient background
  const pages = [{ objects: specs.slice(0, 12).map(s => clean(build(fabric, s).toObject(KEEP))), background: '#ffffff' }, { objects: [], background: { type: 'linear', coords: { x1: 0, y1: 0, x2: 0, y2: 500 }, colorStops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }], offsetX: 0, offsetY: 0, gradientUnits: 'pixels' } }, { objects: [] }];
  await run(pages, 'canvas', async p => { TOL = 0; const f = new fabric.StaticCanvas(null, { width: 1, height: 1 }), k = new kbe.StaticCanvas(null, { width: 1, height: 1 });
    await f.loadFromJSON(clean({ version: '7.4.0', ...p })); await k.loadFromJSON(clean({ version: '7.4.0', ...p })); return diff(clean(f.toObject(KEEP)), clean(k.toObject(KEEP))); });
  // 5. the real Fabric 6.9.1 save: Image and Textbox are kept as saved data, so only version-stamp-independent parts are compared
  await run([fixture], 'fixture', async p => { TOL = 0; const f = new fabric.StaticCanvas(null, { width: 1, height: 1 }), k = new kbe.StaticCanvas(null, { width: 1, height: 1 });
    await f.loadFromJSON(clean(p)); await k.loadFromJSON(clean(p)); return diff(clean(f.toObject(KEEP)), clean(k.toObject(KEEP))); });
  document.getElementById('out').textContent = JSON.stringify(res);
})().catch(e => { document.getElementById('out').textContent = JSON.stringify({ error: String(e && e.stack || e) }); });
</script>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-engine-check-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page);
const chromium = process.env.CHROMIUM || 'chromium';
const run = cp.spawnSync(chromium, ['--headless', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--virtual-time-budget=20000', '--dump-dom', 'file://' + file], { encoding: 'utf8', maxBuffer: 1 << 28 });
fs.rmSync(dir, { recursive: true, force: true });
const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout || '');
if (!m) { console.error('no result from the browser', run.stderr.slice(0, 500)); process.exit(1); }
const res = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (res.error) { console.error(res.error); process.exit(1); }
let bad = 0;
for (const tag of ['construct', 'load', 'clip', 'canvas', 'fixture']) {
  const [ok, total] = res.counts[tag]; bad += res[tag].length;
  console.log(`${res[tag].length ? 'FAIL' : 'PASS'} ${tag}: ${ok}/${total} match`);
  const byClass = {};
  for (const f of res[tag]) (byClass[f.cls] ||= []).push(f);
  for (const [cls, list] of Object.entries(byClass)) { console.log(`  ${cls}: ${list.length} differ`); for (const f of list.slice(0, process.argv.includes('--verbose') ? 99 : 1)) console.log('    ' + f.diff.join('\n    ') + '\n    ' + f.opts); }
}
process.exit(bad ? 1 : 0);
