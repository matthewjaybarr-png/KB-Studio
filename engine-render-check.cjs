// Pixel A/B of the own renderer (ui/engine/render.js) against the Fabric build it replaces, in headless Chromium: the
// random and app-style objects of engine-specs.cjs and the Fabric 6 fixture are drawn by both onto 500x500 canvases and compared.
// Usage: node engine-render-check.cjs [--verbose] [--dump DIR] (SEED=n, CHROMIUM=path). Text objects are not drawn by the new renderer, so
// they are removed from the fixture for both sides.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = __dirname;
const { specs, clipSpecs, PATHS, fixture } = require('./engine-specs.cjs');
const dumpAt = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
const noText = o => (o.type === 'Textbox' ? null : o.objects ? { ...o, objects: o.objects.map(noText).filter(Boolean) } : o);
const fixCanvas = { ...fixture.doc.canvas, objects: fixture.doc.canvas.objects.map(noText).filter(Boolean) };

const page = `<script src="file://${require("./fabric-ref.cjs").fabric()}"></script><script src="file://${root}/ui/engine/model.js"></script><script src="file://${root}/ui/engine/render.js"></script><pre id=out></pre><script>
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
Object.assign(kbe.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
const specs = ${JSON.stringify(specs)}, clipSpecs = ${JSON.stringify(clipSpecs)}, fixture = ${JSON.stringify(fixCanvas)}, DUMP = ${JSON.stringify(!!dumpAt)};
const S = 500, clean = v => JSON.parse(JSON.stringify(v));
const paint = (L, v) => v && v.gradient ? new L.Gradient(v.gradient) : v;
function build(L, s) {
  if (s.cls === 'Group') { const { after, ...opts } = s.opts, g = new L.Group(s.kids.map(k => build(L, k)), opts); if (after) g.set(after); return g; }
  const o = { ...s.opts }; for (const k of ['fill', 'stroke']) if (k in o) o[k] = paint(L, o[k]);
  if (o.shadow && o.shadow.shadow) o.shadow = new L.Shadow(o.shadow.shadow); else if (o.shadow) o.shadow = new L.Shadow(o.shadow);
  return new L[s.cls](...s.args, o);
}
const pixels = c => c.getContext('2d').getImageData(0, 0, S, S).data;
// compared as drawn on white, so invisible pixels with different colours do not count
function compare(a, b) {
  let sum = 0, bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    const wa = a[i + 3] / 255, wb = b[i + 3] / 255; let worst = 0;
    for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] * wa + 255 * (1 - wa) - (b[i + k] * wb + 255 * (1 - wb))); sum += d; if (d > worst) worst = d; }
    if (worst > 48) bad++;
  }
  return { mean: sum / (a.length / 4 * 3), bad: bad / (a.length / 4) };
}
const sheet = (a, b) => { const c = document.createElement('canvas'); c.width = S * 2; c.height = S; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, S * 2, S); x.drawImage(a, 0, 0); x.drawImage(b, S, 0); return c.toDataURL(); };
(async () => {
  const rows = [], dumps = {};
  const check = async (label, makeFabric, makeOwn, item) => {
    const fc = new fabric.StaticCanvas(null, { width: S, height: S }); await makeFabric(fc); fc.renderAll();
    const oc = document.createElement('canvas'); oc.width = oc.height = S; await makeOwn(oc);
    const fp = pixels(fc.getElement()); const r = compare(fp, pixels(oc)); r.drawn = fp.some((v, i) => i % 4 === 3 && v); r.label = label; r.spec = String(JSON.stringify(item)).slice(0, 700); rows.push(r);
    if (DUMP && (!dumps[label] || r.bad > dumps[label].bad)) dumps[label] = { bad: r.bad, png: sheet(fc.getElement(), oc) };
  };
  for (const [i, s] of specs.entries()) {
    const label = s.label || s.cls;
    await check(label, fc => fc.add(build(fabric, s)), async oc => { const o = build(kbe, s); await kbe.prepare([o]); kbe.render(oc.getContext('2d'), [o]); }, s);
  }
  for (const s of clipSpecs) {
    const mk = L => { const o = build(L, s.base); const c = s.clip.cls === 'Path' ? new L.Path(${JSON.stringify(PATHS[1])}, { left: 0, top: 0, absolutePositioned: s.clip.opts.absolutePositioned, inverted: s.clip.opts.inverted }) : new L[s.clip.cls]({ ...(s.clip.cls === 'Circle' ? { radius: 30 } : { width: 40, height: 30 }), left: 0, top: 0, absolutePositioned: s.clip.opts.absolutePositioned, inverted: s.clip.opts.inverted }); o.set({ clipPath: c }); return o; };
    await check('clipPath', fc => fc.add(mk(fabric)), async oc => { const o = mk(kbe); kbe.render(oc.getContext('2d'), [o]); }, s);
  }
  await check('fixture page (Image, Rect, Group, clip frame; text removed)', async fc => { await fc.loadFromJSON(clean(fixture)); fc.backgroundColor = fixture.background; },
    async oc => { const k = new kbe.StaticCanvas(null, { width: S, height: S }); await k.loadFromJSON(clean(fixture)); k.backgroundColor = fixture.background; await kbe.prepare(k._objects); k.renderTo(oc.getContext('2d')); });
  for (const bg of [{ type: 'linear', coords: { x1: 0, y1: 0, x2: 0, y2: S }, colorStops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#336' }], offsetX: 0, offsetY: 0, gradientUnits: 'pixels' }, '#fa0'])
    await check('page background', async fc => { await fc.loadFromJSON({ objects: [], background: clean(bg) }); }, async oc => { const k = new kbe.StaticCanvas(null, { width: S, height: S }); await k.loadFromJSON({ objects: [], background: clean(bg) }); k.renderTo(oc.getContext('2d')); });
  document.getElementById('out').textContent = JSON.stringify({ rows, dumps });
})().catch(e => { document.getElementById('out').textContent = JSON.stringify({ error: String(e && e.stack || e) }); });
</script>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-engine-render-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page);
const run = cp.spawnSync(process.env.CHROMIUM || 'chromium', ['--headless', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--virtual-time-budget=120000', '--dump-dom', 'file://' + file], { encoding: 'utf8', maxBuffer: 1 << 30 });
fs.rmSync(dir, { recursive: true, force: true });
const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout || '');
if (!m) { console.error('no result from the browser', (run.stderr || '').slice(0, 500)); process.exit(1); }
const res = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (res.error) { console.error(res.error); process.exit(1); }
// a case matches when under 2% of pixels differ strongly: Fabric draws each object through a cached bitmap at a fractional position, so edges and steep gradient bands are resampled differently (0.5-1.7% in the worst random cases; a real mistake such as a shifted clip or wrong gradient shows far above that)
const BAD = 0.02, byLabel = {};
for (const r of res.rows) { const g = byLabel[r.label] ||= { n: 0, ok: 0, worstBad: 0, worstMean: 0, drawn: 0 }; g.n++; if (r.drawn) g.drawn++; if (r.bad < BAD) g.ok++; else (g.fails ||= []).push(r); g.worstBad = Math.max(g.worstBad, r.bad); g.worstMean = Math.max(g.worstMean, r.mean); }
let failed = 0;
for (const [label, g] of Object.entries(byLabel)) {
  if (g.ok < g.n) { failed++; for (const f of g.fails.sort((a, b) => b.bad - a.bad).slice(0, process.argv.includes('--verbose') ? 9 : 1)) console.log('    ' + (f.bad * 100).toFixed(2) + '%  ' + f.spec); }
  console.log(`${g.ok === g.n ? 'PASS' : 'FAIL'} ${label}: ${g.ok}/${g.n} match, ${g.drawn} with pixels on the page (worst ${(g.worstBad * 100).toFixed(2)}% strong pixels, mean diff ${g.worstMean.toFixed(2)})`);
}
if (dumpAt) { fs.mkdirSync(dumpAt, { recursive: true }); for (const [label, d] of Object.entries(res.dumps)) fs.writeFileSync(path.join(dumpAt, label.replace(/\W+/g, '_') + '.png'), Buffer.from(d.png.split(',')[1], 'base64')); }
process.exit(failed ? 1 : 0);
