// A/B of the own Textbox (ui/engine/text.js) against Fabric's in headless Chromium: the same constructor calls give the same
// lines, size and saved JSON, saved text loads back the same, and both draw the same pixels. Usage: node engine-text-check.cjs
// [--verbose] [--dump DIR]; SEED=n, CHROMIUM=path. Bundled fonts (Andika, Caveat) plus sans-serif are used so results repeat.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = __dirname;
let seed = Number(process.env.SEED) || 4242;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)], num = (lo, hi, dp = 2) => +(lo + rnd() * (hi - lo)).toFixed(dp);
const WORDS = ['Hello', 'wide', 'world', 'of', 'text', 'Student', 'Name', 'Room', 'fish', 'Tooth', 'AVAVA', 'Typography', 'jumped', 'over', 'the', 'lazy', 'dog', 'a', 'I', '12345', 'W', 'fi', 'office', 'quick,', 'brown!'];
const sentence = () => Array.from({ length: 1 + Math.floor(rnd() * 9) }, () => pick(WORDS)).join(rnd() < 0.05 ? '  ' : ' ');
const FAMILIES = ['Andika', 'Caveat', 'sans-serif'];
const textSpec = () => {
  const paras = Array.from({ length: pick([1, 1, 2, 3]) }, sentence), text = paras.join('\n'), o = { width: num(60, 400, 0), fontSize: pick([14, 20, 24, 33, 40, 64]), fontFamily: pick(FAMILIES), left: num(0, 200, 0), top: num(0, 200, 0) };
  if (rnd() < 0.3) o.fontWeight = 'bold'; if (rnd() < 0.2) o.fontStyle = 'italic';
  if (rnd() < 0.5) o.textAlign = pick(['center', 'right', 'justify', 'justify-center', 'justify-right']);
  if (rnd() < 0.3) o.lineHeight = pick([0.9, 1, 1.4, 1.16]);
  if (rnd() < 0.2) o.charSpacing = pick([50, 200, -30, 400]);
  if (rnd() < 0.3) o.fill = pick(['#cc2200', 'rgba(0,0,0,0.5)', '#336699']);
  if (rnd() < 0.2) { o.stroke = pick(['#000', '#f00']); o.strokeWidth = pick([1, 2, 4]); if (rnd() < 0.5) o.paintFirst = 'stroke'; }
  if (rnd() < 0.2) o.underline = true; if (rnd() < 0.15) o.linethrough = true; if (rnd() < 0.1) o.overline = true;
  if (rnd() < 0.15) o.textBackgroundColor = '#ffee88';
  if (rnd() < 0.15) o.splitByGrapheme = true;
  if (rnd() < 0.3) o.angle = num(-40, 40);
  if (rnd() < 0.2) Object.assign(o, { scaleX: num(0.5, 2), scaleY: num(0.5, 2) });
  if (rnd() < 0.2) o.shadow = { color: '#00000066', blur: 6, offsetX: 4, offsetY: 4 };
  if (rnd() < 0.15) o.kbName = 'Name box';
  if (rnd() < 0.5) { // per-character styles, as imports and the style tools write them
    const styles = {}; text.split('\n').forEach((l, li) => { for (let c = 0; c < l.length; c++) if (rnd() < 0.2) (styles[li] ||= {})[c] = pick([{ fill: '#ff0000' }, { fontWeight: 'bold' }, { fontSize: 30 }, { fontStyle: 'italic', fill: '#0066cc' }, { underline: true }, { linethrough: true }, { textBackgroundColor: '#ccffcc' }, { deltaY: -6 }, { fontFamily: 'Caveat' }, { stroke: '#000', strokeWidth: 1 }]); });
    o.styles = styles;
  }
  return { text, opts: o };
};
const specs = process.env.SPECFILE ? JSON.parse(fs.readFileSync(process.env.SPECFILE, 'utf8')) : Array.from({ length: Number(process.env.COUNT) || 140 }, textSpec); // SPECFILE: a JSON list of {text, opts} to check instead
const dumpAt = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
const font = (f, w) => `@font-face{font-family:${f};font-weight:${w};src:url(file://${root}/ui/fonts/${f.toLowerCase()}-latin-${w}-normal.woff2)}`;
const page = `<style>${font('Andika', 400)}${font('Andika', 700)}${font('Caveat', 400)}${font('Caveat', 700)}</style><script src="file://${require("./fabric-ref.cjs").fabric()}"></script><script src="file://${root}/ui/engine/model.js"></script><script src="file://${root}/ui/engine/render.js"></script><script src="file://${root}/ui/engine/text.js"></script><pre id=out></pre><script>
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
Object.assign(kbe.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });
const specs = ${JSON.stringify(specs)}, DUMP = ${JSON.stringify(!!dumpAt)}, S = 600, clean = v => JSON.parse(JSON.stringify(v));
const make = (L, s) => { const o = { ...s.opts }; if (o.shadow) o.shadow = new L.Shadow(o.shadow); return new L.Textbox(s.text, clean(o)); };
const diff = (a, b, p = '', out = []) => {
  if (out.length > 5) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p + '.' + k, out);
  else if (a !== b && !(typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 2e-3)) out.push(p + ': fabric=' + JSON.stringify(a) + ' own=' + JSON.stringify(b));
  return out;
};
const px = c => c.getContext('2d').getImageData(0, 0, S, S).data;
function compare(a, b) { let sum = 0, bad = 0; for (let i = 0; i < a.length; i += 4) { const wa = a[i + 3] / 255, wb = b[i + 3] / 255; let worst = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] * wa + 255 * (1 - wa) - (b[i + k] * wb + 255 * (1 - wb))); sum += d; if (d > worst) worst = d; } if (worst > 48) bad++; } return { mean: sum / (a.length / 4 * 3), bad: bad / (a.length / 4) }; }
(async () => {
  await Promise.all(['Andika', 'Caveat'].flatMap(f => ['400', '700'].map(w => document.fonts.load(w + ' 20px ' + f))));
  const res = { layout: [], load: [], pixels: [], counts: {}, dumps: null }, worst = { bad: -1 };
  let ok = { layout: 0, load: 0, pixels: 0 };
  for (const [i, s] of specs.entries()) {
    const f = make(fabric, s), k = make(kbe, s);
    const d1 = [...diff(f.textLines, k.textLines, 'lines'), ...diff(clean(f.toObject(['kbName'])), clean(k.toObject(['kbName'])))];
    d1.length ? res.layout.push({ i, diff: d1, spec: JSON.stringify(s).slice(0, 500) }) : ok.layout++;
    const saved = clean(f.toObject(['kbName'])), [f2] = await fabric.util.enlivenObjects([clean(saved)]), [k2] = await kbe.util.enlivenObjects([clean(saved)]);
    const d2 = diff(clean(f2.toObject(['kbName'])), clean(k2.toObject(['kbName']))); d2.length ? res.load.push({ i, diff: d2, spec: JSON.stringify(s).slice(0, 500) }) : ok.load++;
    const fc = new fabric.StaticCanvas(null, { width: S, height: S }); fc.add(f2); fc.renderAll();
    const oc = document.createElement('canvas'); oc.width = oc.height = S; kbe.render(oc.getContext('2d'), [k2]);
    const r = compare(px(fc.getElement()), px(oc)); r.i = i; r.spec = JSON.stringify(s).slice(0, 500);
    if (r.bad < 0.03) ok.pixels++; else res.pixels.push(r);
    if (DUMP && r.bad > worst.bad) { worst.bad = r.bad; const c = document.createElement('canvas'); c.width = S * 2; c.height = S; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, S * 2, S); x.drawImage(fc.getElement(), 0, 0); x.drawImage(oc, S, 0); res.dumps = c.toDataURL(); }
  }
  res.counts = ok; res.total = specs.length;
  document.getElementById('out').textContent = JSON.stringify(res);
})().catch(e => { document.getElementById('out').textContent = JSON.stringify({ error: String(e && e.stack || e) }); });
</script>`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-engine-text-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, page);
const run = cp.spawnSync(process.env.CHROMIUM || 'chromium', ['--headless', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--virtual-time-budget=120000', '--dump-dom', 'file://' + file], { encoding: 'utf8', maxBuffer: 1 << 30 });
fs.rmSync(dir, { recursive: true, force: true });
const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout || '');
if (!m) { console.error('no result from the browser', (run.stderr || '').slice(0, 500)); process.exit(1); }
const res = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (res.error) { console.error(res.error); process.exit(1); }
let bad = 0;
for (const tag of ['layout', 'load', 'pixels']) {
  bad += res[tag].length; console.log(`${res[tag].length ? 'FAIL' : 'PASS'} ${tag}: ${res.counts[tag]}/${res.total} match`);
  for (const f of res[tag].slice(0, process.argv.includes('--verbose') ? 99 : 2)) console.log('    ' + (f.diff ? f.diff.join('\n    ') : (f.bad * 100).toFixed(2) + '% strong pixels, mean ' + f.mean.toFixed(2)) + '\n    ' + f.spec);
}
if (dumpAt && res.dumps) { fs.mkdirSync(dumpAt, { recursive: true }); fs.writeFileSync(path.join(dumpAt, 'worst-text.png'), Buffer.from(res.dumps.split(',')[1], 'base64')); }
process.exit(bad ? 1 : 0);
