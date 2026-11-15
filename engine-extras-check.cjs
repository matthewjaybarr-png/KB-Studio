// A/B check of the two tools the app takes from Fabric's extension package: snapping guides (AligningGuidelines) and picture crop mode
// (enterCropMode), own engine (ui/engine/extras.js) against Fabric 7.4 + fabric-extensions (read from git history by fabric-ref.cjs).
// The same real mouse events (CDP Input.dispatchMouseEvent) run through both in headless Chromium, at device scale 1 and 2; after every
// step the objects' numbers (position, size, scale, crop, angle), the selection, the cursor and the pixels of both canvases are compared.
//   node engine-extras-check.cjs [--verbose] [--dump DIR]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), zlib = require('node:zlib');
const root = __dirname, verbose = process.argv.includes('--verbose'), dumpAt = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
const FABRIC = require('./fabric-ref.cjs').fabric(), FABRIC_EXT = require('./fabric-ref.cjs').extensions();
const SCRIPTS = { fabric: [FABRIC, FABRIC_EXT], own: ['model', 'render', 'text', 'editor', 'canvas', 'image', 'svg', 'extras'].map(n => path.join(root, 'ui/engine', n + '.js')) };
const pageFor = engine => `<style>body{margin:0;background:#888}</style>${SCRIPTS[engine].map(s => `<script src="file://${s}"></script>`).join('')}
<canvas id=c></canvas><script>
const L = ${engine === 'fabric' ? 'fabric' : 'kbe'}, X = ${engine === 'fabric' ? 'fabricExtensions' : 'kbe'}; L.FabricObject.ownDefaults.originX = 'left'; L.FabricObject.ownDefaults.originY = 'top';
const canvas = window.canvas = new L.Canvas(document.getElementById('c'), { width: 600, height: 420, backgroundColor: '#ffffff', preserveObjectStacking: true });
const pic = document.createElement('canvas'); pic.width = 400; pic.height = 300; { const x = pic.getContext('2d'), g = x.createLinearGradient(0, 0, 400, 300); g.addColorStop(0, '#ee5588'); g.addColorStop(1, '#3399dd'); x.fillStyle = g; x.fillRect(0, 0, 400, 300); x.fillStyle = '#fff'; for (let i = 0; i < 8; i++) x.fillRect(20 + i * 45, 20 + (i % 3) * 80, 30, 30); x.fillStyle = '#222'; x.font = '40px sans-serif'; x.fillText('CROP', 130, 160); }
const A = new L.Rect({ left: 60, top: 60, width: 150, height: 90, fill: '#ffcc33' }), B = new L.Rect({ left: 300, top: 220, width: 120, height: 80, fill: '#66bb66' }), C = new L.Triangle({ left: 120, top: 260, width: 90, height: 80, fill: '#9966cc' });
const I = new L.FabricImage(pic); I.set({ left: 330, top: 30, scaleX: 0.5, scaleY: 0.5 });
canvas.add(A, B, C, I); const guides = new X.AligningGuidelines(canvas); canvas.renderAll();
const r2 = n => typeof n === 'number' ? Math.round(n * 100) / 100 : n;
window.snap = () => JSON.stringify({ objs: canvas._objects.map(o => [o.left, o.top, o.width, o.height, o.scaleX, o.scaleY, o.cropX || 0, o.cropY || 0, o.angle].map(r2)), active: canvas._objects.indexOf(canvas.getActiveObject()), cursor: canvas.upperCanvasEl.style.cursor });
window.px = () => canvas.lowerCanvasEl.toDataURL('image/png'); window.pxTop = () => canvas.upperCanvasEl.toDataURL('image/png');
window.frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
window.where = what => { const v = canvas.viewportTransform; if (what.handle) return canvas.getActiveObject().oCoords[what.handle]; const q = canvas._objects[what.i].getCoords(), x = q.reduce((n, p) => n + p.x, 0) / 4, y = q.reduce((n, p) => n + p.y, 0) / 4; return { x: x * v[0] + v[4], y: y * v[3] + v[5] }; };
window.crop = () => { guides.dispose(); /* Fabric's guides snap the frame while a picture is panned (stale corners); the own ones leave it, so crop mode is compared without them */ X.enterCropMode({ target: I }); canvas.requestRenderAll(); };
window.ready = true;
</script>`;
function decodePng(url) {
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'); let at = 8, w = 0, h = 0; const parts = [];
  while (at < buf.length) { const len = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8); if (type === 'IHDR') { w = buf.readUInt32BE(at + 8); h = buf.readUInt32BE(at + 12); } else if (type === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + len)); at += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(parts)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1; for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0; let v = raw[src + x]; if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } out[y * stride + x] = v & 255; } }
  return { w, h, rgba: out };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(engine, dpr, temp) {
  const file = path.join(temp, `${engine}-${dpr}.html`); fs.writeFileSync(file, pageFor(engine));
  const browser = cp.spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=900,700', '--user-data-dir=' + path.join(temp, 'profile-' + engine + dpr), '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  const steps = [];
  try {
    const portFile = path.join(temp, 'profile-' + engine + dpr, 'DevToolsActivePort'); for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?file://' + file, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
    let id = 0; const waiting = new Map(); socket.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(resolve => { waiting.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true }); await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: dpr, mobile: false });
    const ev = async expr => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw new Error(engine + ': ' + JSON.stringify(m.result.exceptionDetails).slice(0, 500)); return m.result?.result?.value; };
    for (let i = 0; i < 100 && !(await ev('window.ready === true')); i++) await sleep(100);
    const mouse = (type, p, mods = 0, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left', buttons: type === 'mousePressed' || extra.buttons ? 1 : 0, modifiers: mods, ...extra });
    const at = what => ev(`JSON.stringify(where(${JSON.stringify(what)}))`).then(JSON.parse), look = async label => { await ev('frames()'); steps.push({ label, state: JSON.parse(await ev('snap()')), px: decodePng(await ev('px()')), pxTop: decodePng(await ev('pxTop()')) }); };
    const drag = async (from, to, { n = 8, hold = false, mods = 0 } = {}) => { await mouse('mouseMoved', from, mods); await mouse('mousePressed', from, mods, { clickCount: 1 }); for (let i = 1; i <= n; i++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }, mods, { buttons: 1 }); if (!hold) await mouse('mouseReleased', to, mods, { clickCount: 1 }); };
    const add = (p, dx, dy) => ({ x: p.x + dx, y: p.y + dy }), click = async (p, count = 1) => { await mouse('mouseMoved', p); for (let c = 1; c <= count; c++) { await mouse('mousePressed', p, 0, { clickCount: c }); await mouse('mouseReleased', p, 0, { clickCount: c }); } };
    const handle = name => at({ handle: name }), center = i => at({ i });

    // ---- snapping guides while moving: A is dragged until its centre is within a few pixels of B's centre (x) and of C's top edge (y)
    await look('start');
    await click(await center(0)); const a0 = await center(0), b0 = await center(1);
    await drag(a0, { x: a0.x + (b0.x - a0.x) + 2, y: a0.y + 25 }, { hold: true }); await look('moving A near B centre x (guides shown)'); await mouse('mouseReleased', { x: a0.x + (b0.x - a0.x) + 2, y: a0.y + 25 }, 0, { clickCount: 1 }); await look('released');
    const a1 = await center(0); await drag(a1, { x: a1.x + 1, y: a1.y + 165 }, { hold: true }); await look('moving A down near B/C rows (guides shown)'); await mouse('mouseReleased', { x: a1.x + 1, y: a1.y + 165 }, 0, { clickCount: 1 });
    await look('released again');
    // ---- snapping guides while resizing: a corner, a side
    await click({ x: 20, y: 400 }); await click(await center(0)); const br = await handle('br'); const bt = await center(1);
    await drag(br, { x: bt.x - 58, y: br.y + 6 }, { hold: true }); await look('resize corner br near B left (guides shown)'); await mouse('mouseReleased', { x: bt.x - 58, y: br.y + 6 }, 0, { clickCount: 1 }); await look('released corner');
    const mr = await handle('mr'); await drag(mr, { x: mr.x - 80, y: mr.y }, { hold: true }); await look('resize side mr (guides shown)'); await mouse('mouseReleased', { x: mr.x - 80, y: mr.y }, 0, { clickCount: 1 }); await look('released side');
    // ---- crop mode on the picture
    await click({ x: 20, y: 400 }); await click(await center(3)); await ev('crop()'); await look('crop mode entered');
    const names = ['mrc', 'mbc', 'mlc', 'mtc'], inward = { mrc: [-30, 0], mbc: [0, -25], mlc: [20, 0], mtc: [0, 15] };
    for (const nm of names) { await drag(await handle(nm), add(await handle(nm), ...inward[nm])); await look('crop edge ' + nm); }
    for (const [nm, d] of [['brc', [-15, -10]], ['tlc', [12, 8]], ['trc', [-10, 10]], ['blc', [10, -8]]]) { await drag(await handle(nm), add(await handle(nm), ...d)); await look('crop corner ' + nm); }
    await drag(await center(3), add(await center(3), 14, 9)); await look('pan the picture inside the frame');
    await drag(await center(3), add(await center(3), -60, -30)); await look('pan the picture past its edge');
    for (const [nm, d] of [['brs', [20, 15]], ['tls', [-10, -8]], ['trs', [-14, 8]], ['bls', [10, -6]]]) { await drag(await handle(nm), add(await handle(nm), ...d)); await look('scale picture with ' + nm); }
    await drag(await handle('mrc'), add(await handle('mrc'), 200, 0)); await look('crop edge mrc outward (limit)');
    await click(await center(3), 2); await look('double click leaves crop mode'); await drag(await center(3), add(await center(3), -20, 10)); await look('moving the picture after crop mode');
    socket.close();
  } finally { const exited = new Promise(r => browser.once('exit', r)); browser.kill(); await exited; }
  return steps;
}
const sameJSON = (a, b, tol = 0.06, p = '') => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol ? null : `${p}: ${a} vs ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = sameJSON(a[k], b[k], tol, p + '.' + k); if (d) return d; } return null; }
  return a === b ? null : `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
};
const pixelDiff = (a, b) => { if (a.w !== b.w || a.h !== b.h) return { bad: 1, mean: 255 }; let strong = 0, sum = 0; const n = a.w * a.h; for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(a.rgba[i * 4 + c] - b.rgba[i * 4 + c])); sum += m; if (m > 48) strong++; } return { bad: strong / n, mean: sum / n }; };
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-extras-check-')); let failed = 0, checked = 0;
  for (const dpr of [1, 2]) {
    const [fab, own] = [await run('fabric', dpr, temp), await run('own', dpr, temp)]; console.log(`--- device scale ${dpr}`);
    if (fab.length !== own.length) { console.log('FAIL step count', fab.length, own.length); failed++; }
    fab.forEach((f, i) => {
      const o = own[i]; if (!o) return; checked++; const problems = [], sd = sameJSON(f.state, o.state); if (sd) problems.push('state ' + sd);
      const pd = pixelDiff(f.px, o.px), pt = pixelDiff(f.pxTop, o.pxTop); if (pd.bad > 0.02) problems.push(`pixels ${(pd.bad * 100).toFixed(2)}% strong, mean ${pd.mean.toFixed(2)}`); if (pt.bad > 0.004) problems.push(`top layer ${(pt.bad * 100).toFixed(3)}% strong`);
      if (problems.length) { failed++; console.log(`FAIL ${f.label}\n    ` + problems.join('\n    ') + (verbose ? '\n    fabric ' + JSON.stringify(f.state.objs) + '\n    own    ' + JSON.stringify(o.state.objs) : '')); }
      else if (verbose) console.log(`pass ${f.label} (pixels ${(pd.bad * 100).toFixed(2)}%, top ${(pt.bad * 100).toFixed(3)}%)`);
    });
  }
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`${failed ? 'FAIL' : 'PASS'} extras: ${checked - failed}/${checked} steps match`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
