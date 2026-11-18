// A/B check of the own interactive canvas (ui/engine/canvas.js) against Fabric's (Fabric 7.4.0 from git history, see fabric-ref.cjs). The same scripted
// sequence of real mouse events (CDP Input.dispatchMouseEvent: hover, click, drags with Shift and Alt, a wheel zoom, double click,
// free drawing) runs once through each engine in headless Chromium, at device scale 1 and 2. After every step both report the
// object transforms (as page corners), what is selected, the cursor, the zoom and the events that fired; those are compared, and
// so are the canvas pixels. Usage: node engine-canvas-check.cjs [--verbose] [--dump DIR]; CHROMIUM selects the browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const zlib = require('node:zlib');
const root = __dirname;
const verbose = process.argv.includes('--verbose');
const dumpAt = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
const font = (f, w) => `@font-face{font-family:${f};font-weight:${w};src:url(file://${root}/ui/fonts/${f.toLowerCase()}-latin-${w}-normal.woff2)}`;
const SCRIPTS = { fabric: [require('./fabric-ref.cjs').fabric()], own: ['ui/engine/model.js', 'ui/engine/render.js', 'ui/engine/text.js', 'ui/engine/editor.js', 'ui/engine/canvas.js'] };
const pageFor = engine => `<style>${font('Andika', 400)}${font('Andika', 700)} body{margin:0;background:#888}</style>${SCRIPTS[engine].map(s => `<script src="file://${path.resolve(root, s)}"></script>`).join('')}
<canvas id=c></canvas><script>
const L = ${engine === 'fabric' ? 'fabric' : 'kbe'}; L.FabricObject.ownDefaults.originX = 'left'; L.FabricObject.ownDefaults.originY = 'top';
const canvas = new L.Canvas(document.getElementById('c'), { width: 600, height: 420, backgroundColor: '#ffffff', preserveObjectStacking: true, fireRightClick: true, fireMiddleClick: true, stopContextMenu: true });
window.canvas = canvas; window.log = [];
const kind = o => !o ? '-' : /activeselection/i.test(o.type) ? 'AS' : canvas._objects.indexOf(o);
const names = ['mouse:down', 'mouse:up', 'mouse:over', 'mouse:out', 'mouse:dblclick', 'mouse:wheel', 'object:added', 'object:removed', 'object:moving', 'object:scaling', 'object:rotating', 'object:resizing', 'object:modified', 'selection:created', 'selection:updated', 'selection:cleared', 'before:selection:cleared', 'text:editing:entered', 'text:editing:exited', 'text:changed', 'path:created', 'before:transform'];
for (const n of names) canvas.on(n, ev => {
  let s = n + ':' + kind(ev.target || ev.path || (ev.transform && ev.transform.target));
  if (ev.transform && ev.transform.action) s += '/' + ev.transform.action;
  if (ev.action) s += '/' + ev.action;
  if (ev.selected) s += '+' + ev.selected.map(kind).join(','); if (ev.deselected) s += '-' + ev.deselected.map(kind).join(',');
  if (n === 'mouse:wheel') s += '/' + ev.e.deltaY;
  if (log.length && log[log.length - 1] === s && /moving|scaling|rotating|resizing|mouse:wheel/.test(n)) return; log.push(s);
});
let move = 0; canvas.on('mouse:move', () => { move++; }); window.moveCount = () => move;
canvas.on('mouse:wheel', ({ e }) => { e.preventDefault(); if (e.ctrlKey) canvas.zoomToPoint(canvas.getViewportPoint(e), Math.max(0.2, Math.min(5, canvas.getZoom() * Math.exp(-e.deltaY * 0.002)))); else canvas.relativePan(new L.Point(-e.deltaX, -e.deltaY)); });
canvas.on('object:rotating', ({ target, e }) => { target.set(e.shiftKey ? { snapAngle: 15, snapThreshold: undefined } : { snapAngle: 45, snapThreshold: 4 }); });
const sh = { color: 'rgba(0,0,0,0.4)', blur: 8, offsetX: 5, offsetY: 5 };
canvas.add(
  new L.Rect({ left: 60, top: 60, width: 120, height: 80, fill: '#cc3333', stroke: '#222222', strokeWidth: 3 }),
  new L.Circle({ left: 260, top: 70, radius: 50, fill: '#3366cc', shadow: new L.Shadow(sh) }),
  new L.Triangle({ left: 130, top: 230, width: 100, height: 90, fill: '#33aa33', angle: 20 }),
  new L.Textbox('Hello world', { left: 330, top: 250, width: 150, fontSize: 28, fontFamily: 'Andika', fill: '#222222' }),
  new L.Rect({ left: 230, top: 150, width: 80, height: 70, fill: '#ffcc33', angle: 30, opacity: 0.8 }));
canvas.renderAll(); log.length = 0;
const r2 = n => typeof n === 'number' ? Math.round(n * 100) / 100 : n;
window.snap = () => JSON.stringify({
  objs: canvas._objects.map(o => o.getCoords().flatMap(p => [r2(p.x), r2(p.y)]).concat([o.flipX ? 1 : 0, o.flipY ? 1 : 0, r2(o.width), r2(o.height), r2(o.angle), r2(o.scaleX), r2(o.scaleY)])),
  props: canvas._objects.map(o => [r2(o.angle), r2(o.scaleX), r2(o.scaleY)].join(',')),
  active: canvas.getActiveObjects().map(kind), cursor: canvas.upperCanvasEl.style.cursor, vpt: canvas.viewportTransform.map(n => r2(n)), size: [canvas.width, canvas.height],
  editing: canvas._objects.filter(o => o.isEditing).map(kind), text: canvas._objects[3] && canvas._objects[3].text, log: log.splice(0),
  paths: canvas._objects.filter(o => /path/i.test(o.type)).map(p => p.path.map(c => c.map(r2).join(' ')).join('|')),
  oc: canvas.getActiveObject() && canvas.getActiveObject().oCoords ? Object.fromEntries(Object.entries(canvas.getActiveObject().oCoords).map(([k, v]) => [k, [r2(v.x), r2(v.y)]])) : null
});
window.px = () => canvas.lowerCanvasEl.toDataURL('image/png');
window.pxTop = () => canvas.upperCanvasEl.toDataURL('image/png');
window.frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
window.where = what => { const v = canvas.viewportTransform; if (what.handle) return canvas.getActiveObject().oCoords[what.handle]; const q = canvas._objects[what.i].getCoords(), x = q.reduce((n, p) => n + p.x, 0) / 4, y = q.reduce((n, p) => n + p.y, 0) / 4; return { x: x * v[0] + v[4], y: y * v[3] + v[5] }; };
window.ready = true;
</script>`;

function decodePng(url) { // canvas.toDataURL('image/png') -> {w, h, rgba}
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'); let at = 8, w = 0, h = 0; const parts = [];
  while (at < buf.length) { const len = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8); if (type === 'IHDR') { w = buf.readUInt32BE(at + 8); h = buf.readUInt32BE(at + 12); } else if (type === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + len)); at += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(parts)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, rgba: out };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOD = { shift: 8, alt: 1, ctrl: 2 };

// one run of the whole script through one engine; returns [{label, state, px, pxTop}]
async function run(engine, dpr, temp) {
  const file = path.join(temp, `${engine}-${dpr}.html`); fs.writeFileSync(file, pageFor(engine));
  const browser = cp.spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=900,700', '--user-data-dir=' + path.join(temp, 'profile-' + engine + dpr), '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  const steps = [];
  try {
    const portFile = path.join(temp, 'profile-' + engine + dpr, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?file://' + file, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
    let id = 0; const waiting = new Map(); socket.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(resolve => { waiting.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: dpr, mobile: false });
    const ev = async expr => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw new Error(engine + ': ' + JSON.stringify(m.result.exceptionDetails).slice(0, 500)); return m.result?.result?.value; };
    for (let i = 0; i < 100 && !(await ev('window.ready === true')); i++) await sleep(100);
    const flags = mods => mods.reduce((n, m) => n | MOD[m], 0);
    const mouse = (type, p, mods = [], extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left', buttons: type === 'mousePressed' || extra.buttons ? 1 : 0, modifiers: flags(mods), ...extra });
    const at = what => ev(`JSON.stringify(where(${JSON.stringify(what)}))`).then(JSON.parse);
    const look = async (label, { pixels = true } = {}) => { await ev('frames()'); steps.push({ label, state: JSON.parse(await ev('snap()')), px: pixels ? decodePng(await ev('px()')) : null, pxTop: pixels ? decodePng(await ev('pxTop()')) : null }); };
    const hover = async (p, mods = []) => { await mouse('mouseMoved', p, mods); };
    const drag = async (from, to, { mods = [], n = 6, hold = false } = {}) => {
      await mouse('mouseMoved', from, mods); await mouse('mousePressed', from, mods, { clickCount: 1 });
      for (let i = 1; i <= n; i++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }, mods, { buttons: 1 });
      if (!hold) await mouse('mouseReleased', to, mods, { clickCount: 1 });
    };
    const click = async (p, mods = [], count = 1) => { await mouse('mouseMoved', p, mods); for (let c = 1; c <= count; c++) { await mouse('mousePressed', p, mods, { clickCount: c }); await mouse('mouseReleased', p, mods, { clickCount: c }); } };
    const add = (p, dx, dy) => ({ x: p.x + dx, y: p.y + dy });
    const handle = async name => at({ handle: name });
    const center = async i => at({ i });

    // --- hover and click selection
    await look('start');
    await hover(await center(0)); await look('hover rect');
    await hover({ x: 580, y: 400 }); await look('hover nothing');
    await click(await center(0)); await look('click rect');
    if (process.env.PROBE) { for (const [nm, pt] of [['center', await center(0)], ['br', await handle('br')], ['mtr', await handle('mtr')], ['ml', await handle('ml')], ['empty', { x: 580, y: 400 }], ['br', await handle('br')], ['center', await center(0)]]) { await hover(pt); await ev('frames()'); console.log(engine, nm, JSON.stringify(pt.x + ',' + pt.y), await ev(`JSON.stringify({ log: log.splice(0), hov: canvas._objects.indexOf(canvas._hoveredTarget || canvas._hovered), cur: canvas.upperCanvasEl.style.cursor })`)); } }
    await hover(await handle('br')); await look('hover br handle');
    await hover(await handle('mtr')); await look('hover rotate handle');
    await hover(await handle('ml')); await look('hover left handle');
    // --- transforms
    await drag(await center(0), add(await center(0), 40, 25)); await look('drag move');
    if (process.env.DEBUG) { const h = await handle('br'); console.log(engine, 'br', h, await ev(`(() => { const e = { clientX: ${h.x}, clientY: ${h.y} }; const f = canvas.findTarget(e); const q = canvas._objects[0]; return JSON.stringify({ target: canvas._objects.indexOf(f), active: canvas._objects.indexOf(canvas.getActiveObject()), coords: q.getCoords().map(p => [p.x, p.y]), c4: canvas._objects[4].getCoords().map(p => [p.x, p.y]), c4in: canvas._objects[4].containsPoint(canvas.getScenePoint(e)), hov: canvas._objects.indexOf(canvas._hoveredTarget || canvas._hovered) }); })()`)); }
    if (process.env.PROBE2) { const hv = `JSON.stringify({ log: log.splice(0), hov: canvas._objects.indexOf(canvas._hoveredTarget || canvas._hovered) })`; console.log(engine, 'before', await ev(hv)); const h = await handle('br'); console.log(engine, 'contains', await ev(`(() => { const o = canvas._objects[0], sp = canvas.getScenePoint({ clientX: ${h.x}, clientY: ${h.y} }); return JSON.stringify({ sp, c: o.containsPoint(sp), coords: o.getCoords().map(p => [p.x, p.y]), act: canvas._objects.indexOf(canvas.getActiveObject()) }); })()`)); for (const q of [{ x: h.x + 30, y: h.y + 30 }, h, h]) { await hover(q); await ev('frames()'); console.log(engine, q.x + ',' + q.y, await ev(hv)); } }
    await drag(await handle('br'), add(await handle('br'), 30, 10)); await look('drag corner br (uniform)');
    await drag(await handle('mr'), add(await handle('mr'), 25, 0)); await look('drag side mr');
    await drag(await handle('mb'), add(await handle('mb'), 0, -15)); await look('drag side mb');
    await drag(await handle('br'), add(await handle('br'), -20, 30), { mods: ['shift'] }); await look('shift drag corner br (free)');
    await drag(await handle('tl'), add(await handle('tl'), 15, 12), { mods: ['alt'] }); await look('alt drag corner tl (from centre)');
    { const m = await handle('mtr'), c = await center(0), r = Math.hypot(m.x - c.x, m.y - c.y), a0 = Math.atan2(m.y - c.y, m.x - c.x); const pts = [0, 10, 20, 30, 37].map(d => ({ x: c.x + r * Math.cos(a0 + d * Math.PI / 180), y: c.y + r * Math.sin(a0 + d * Math.PI / 180) }));
      await mouse('mouseMoved', pts[0]); await mouse('mousePressed', pts[0], [], { clickCount: 1 }); for (const p of pts.slice(1)) await mouse('mouseMoved', p, [], { buttons: 1 }); await mouse('mouseReleased', pts.at(-1), [], { clickCount: 1 }); }
    await look('rotate 37 (snaps near 45)');
    { const m = await handle('mtr'), c = await center(0), r = Math.hypot(m.x - c.x, m.y - c.y), a0 = Math.atan2(m.y - c.y, m.x - c.x); const pts = [0, 12, 24, 33].map(d => ({ x: c.x + r * Math.cos(a0 + d * Math.PI / 180), y: c.y + r * Math.sin(a0 + d * Math.PI / 180) }));
      await mouse('mouseMoved', pts[0], ['shift']); await mouse('mousePressed', pts[0], ['shift'], { clickCount: 1 }); for (const p of pts.slice(1)) await mouse('mouseMoved', p, ['shift'], { buttons: 1 }); await mouse('mouseReleased', pts.at(-1), ['shift'], { clickCount: 1 }); }
    await look('shift rotate 33 (snaps to 15s)');
    await hover(await handle('tr')); await look('hover tr handle on a turned object');
    await drag(await handle('br'), add(await handle('tl'), -30, -30)); await look('drag corner past the opposite one (flip)');
    // --- text box
    await click(await center(3)); await look('click textbox');
    await drag(await handle('mr'), add(await handle('mr'), 40, 0)); await look('textbox width handle');
    // --- selection and ActiveSelection
    await click({ x: 580, y: 20 }); await look('click empty: discard');
    await click(await center(1)); await click(await center(2), ['shift']); await look('click circle, shift-click triangle');
    await click(await center(4), ['shift']); await look('shift-click a third');
    await drag(await center(2), add(await center(2), 30, -20)); await look('drag the selection');
    await drag(await handle('br'), add(await handle('br'), 25, 20)); await look('scale the selection');
    { const m = await handle('mtr'), c = { x: (await handle('tl')).x / 2 + (await handle('br')).x / 2, y: (await handle('tl')).y / 2 + (await handle('br')).y / 2 }, r = Math.hypot(m.x - c.x, m.y - c.y), a0 = Math.atan2(m.y - c.y, m.x - c.x); const pts = [0, 10, 20].map(d => ({ x: c.x + r * Math.cos(a0 + d * Math.PI / 180), y: c.y + r * Math.sin(a0 + d * Math.PI / 180) }));
      await mouse('mouseMoved', pts[0]); await mouse('mousePressed', pts[0], [], { clickCount: 1 }); for (const p of pts.slice(1)) await mouse('mouseMoved', p, [], { buttons: 1 }); await mouse('mouseReleased', pts.at(-1), [], { clickCount: 1 }); }
    await look('rotate the selection');
    await click(await center(1), ['shift']); await look('shift-click removes one from the selection');
    await click(await center(1), ['shift']); await look('shift-click adds one to the turned selection');
    await click({ x: 590, y: 410 }); await look('discard to the page');
    await drag({ x: 8, y: 8 }, { x: 340, y: 300 }, { hold: true }); await look('drag-box in progress');
    await mouse('mouseReleased', { x: 340, y: 300 }, [], { clickCount: 1 }); await look('drag-box released');
    await click({ x: 590, y: 410 }); await look('discard again');
    // --- zoom and pan
    await mouse('mouseWheel', { x: 300, y: 200 }, ['ctrl'], { deltaX: 0, deltaY: -150 }); await look('ctrl+wheel zoom in');
    await mouse('mouseWheel', { x: 100, y: 100 }, [], { deltaX: 0, deltaY: 60 }); await look('wheel pan');
    await click(await center(2)); await look('click a triangle while zoomed');
    await hover(await handle('br')); await look('hover handle while zoomed');
    await drag(await handle('br'), add(await handle('br'), 20, 20)); await look('scale while zoomed');
    await ev(`canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); canvas.discardActiveObject(); 0`); await look('viewport reset');
    await ev(`canvas.setDimensions({ width: 520, height: 380 }); 0`); await look('setDimensions');
    // --- text editing through the canvas
    await ev(`canvas.setDimensions({ width: 600, height: 420 }); 0`);
    await click(await center(3)); await click(await center(3), [], 1); await look('second click on the textbox goes in');
    await ev(`canvas.discardActiveObject(); 0`); await look('discard leaves editing');
    await click(await center(3), [], 2); await look('double click');
    await ev(`canvas.discardActiveObject(); 0`);
    // --- z-order, add, remove
    await ev(`canvas.sendObjectToBack(canvas._objects[3]); canvas.moveObjectTo(canvas._objects[0], 3); canvas.remove(canvas._objects[4]); 0`); await look('stacking changes and remove');
    await ev(`canvas.insertAt(1, new L.Rect({ left: 400, top: 20, width: 40, height: 40, fill: '#9933cc' })); 0`); await look('insertAt');
    // --- the per-pixel hit test
    const tr = await ev(`JSON.stringify([canvas.isTargetTransparent(canvas._objects[2], 0, 0), canvas.isTargetTransparent(canvas._objects[2], 285, 120)])`); steps.push({ label: 'isTargetTransparent', state: { transparent: JSON.parse(tr) }, px: null, pxTop: null });
    // --- free drawing
    await ev(`canvas.discardActiveObject(); canvas.isDrawingMode = true; canvas.freeDrawingBrush = new L.PencilBrush(canvas); canvas.freeDrawingBrush.color = '#444444'; canvas.freeDrawingBrush.width = 5; 0`);
    await mouse('mouseMoved', { x: 420, y: 330 }); await mouse('mousePressed', { x: 420, y: 330 }, [], { clickCount: 1 });
    for (const [x, y] of [[430, 335], [445, 350], [460, 352], [480, 345], [500, 330], [520, 335]]) await mouse('mouseMoved', { x, y }, [], { buttons: 1 });
    await look('drawing in progress'); await mouse('mouseReleased', { x: 520, y: 335 }, [], { clickCount: 1 }); await look('drawn path');
    socket.close();
  } finally { const exited = new Promise(r => browser.once('exit', r)); browser.kill(); await exited; }
  return steps;
}

const num = (a, b, tol) => Math.abs(a - b) <= tol;
function sameJSON(a, b, tol = 0.06, p = '') { // numbers within tol, everything else equal; returns the first difference
  if (typeof a === 'number' && typeof b === 'number') return num(a, b, tol) ? null : `${p}: ${a} vs ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return `${p}: length ${a.length} vs ${b.length} (${JSON.stringify(a).slice(0, 160)} vs ${JSON.stringify(b).slice(0, 160)})`; for (let i = 0; i < a.length; i++) { const d = sameJSON(a[i], b[i], tol, p + '[' + i + ']'); if (d) return d; } return null; }
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = sameJSON(a[k], b[k], tol, p + '.' + k); if (d) return d; } return null; }
  return a === b ? null : `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}
function pixelDiff(a, b) {
  if (!a || !b) return { bad: 0, mean: 0 }; if (a.w !== b.w || a.h !== b.h) return { bad: 1, mean: 255, size: [a.w, a.h, b.w, b.h] };
  let strong = 0, sum = 0; const n = a.w * a.h;
  for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(a.rgba[i * 4 + c] - b.rgba[i * 4 + c])); sum += m; if (m > 48) strong++; }
  return { bad: strong / n, mean: sum / n };
}
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-canvas-check-')); let failed = 0, checked = 0;
  for (const dpr of [1, 2]) {
    const [fab, own] = [await run('fabric', dpr, temp), await run('own', dpr, temp)];
    console.log(`--- device scale ${dpr}`);
    if (fab.length !== own.length) { console.log('FAIL step count', fab.length, own.length); failed++; }
    fab.forEach((f, i) => {
      const o = own[i]; if (!o) return; checked++;
      const problems = [], { log: fl = [], ...fs0 } = f.state, { log: ol = [], ...os0 } = o.state;
      const sd = sameJSON(fs0, os0); if (sd) { problems.push('state ' + sd); if (process.env.STATE === f.label) console.log(JSON.stringify(fs0.objs[0]), JSON.stringify(os0.objs[0])); }
      if (JSON.stringify(fl) !== JSON.stringify(ol)) problems.push('events fabric=' + JSON.stringify(fl).slice(0, 400) + ' own=' + JSON.stringify(ol).slice(0, 400));
      const pd = pixelDiff(f.px, o.px); if (pd.bad > 0.02) problems.push(`pixels ${(pd.bad * 100).toFixed(2)}% strong, mean ${pd.mean.toFixed(2)}`);
      const pt = pixelDiff(f.pxTop, o.pxTop); if (pt.bad > 0.02) problems.push(`top layer ${(pt.bad * 100).toFixed(2)}% strong`);
      if (problems.length) { failed++; console.log(`FAIL ${f.label}\n    ` + problems.join('\n    ')); if (dumpAt) { fs.mkdirSync(dumpAt, { recursive: true }); } }
      else if (verbose) console.log(`pass ${f.label} (pixels ${(pd.bad * 100).toFixed(2)}%)`);
      if (verbose && /hover/.test(f.label)) console.log('   cursor fabric=' + f.state.cursor + ' own=' + o.state.cursor);
    });
    if (dumpAt) { fs.mkdirSync(dumpAt, { recursive: true }); for (const [name, steps] of [['fabric', fab], ['own', own]]) steps.forEach((s, i) => { if (s.px) { /* raw RGBA saved as PPM-free PNG is not needed: the data URLs are enough */ } }); }
  }
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`${failed ? 'FAIL' : 'PASS'} canvas: ${checked - failed}/${checked} steps match`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
