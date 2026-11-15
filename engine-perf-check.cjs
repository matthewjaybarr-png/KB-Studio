// Speed of the live canvas, Fabric (from git history, see fabric-ref.cjs) against the own engine: a busy design (about 90 objects: shapes with shadows,
// text boxes, pictures, paths) is drawn over and over, then an object is dragged across it frame by frame, at device scale 1 and 2.
//   node engine-perf-check.cjs [--objects 90]   (prints ms per frame for both, and the ratio; fails when own is over MAX_RATIO times slower)
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = __dirname, argv = process.argv.slice(2), N = Number(argv[argv.indexOf('--objects') + 1]) || 90, MAX_RATIO = Number(process.env.MAX_RATIO || 1.5);
const FABRIC = require('./fabric-ref.cjs').fabric();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-perf-check-')), sleep = ms => new Promise(r => setTimeout(r, ms));
const own = ['model', 'render', 'text', 'editor', 'canvas', 'image', 'svg', 'extras'].map(n => path.join(root, 'ui/engine', n + '.js'));
const page = (libs, ns) => `<html><body style="margin:0"><canvas id="c"></canvas>${libs.map(f => `<script src="file://${f}"></script>`).join('')}<script>window.L = ${ns};
window.setup = async () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shot = document.createElement('canvas'); shot.width = 500; shot.height = 400; const sx = shot.getContext('2d'); const g = sx.createLinearGradient(0, 0, 500, 400); g.addColorStop(0, '#f6a'); g.addColorStop(1, '#3ad'); sx.fillStyle = g; sx.fillRect(0, 0, 500, 400);
  for (let i = 0; i < 40; i++) { sx.fillStyle = 'hsl(' + (i * 9) + ',70%,60%)'; sx.fillRect(rnd() * 480, rnd() * 380, 40, 30); }
  const url = shot.toDataURL('image/jpeg', 0.9), img = new Image(); img.src = url; await img.decode();
  const canvas = window.canvas = new L.Canvas(document.getElementById('c'), { width: 794, height: 1123, backgroundColor: '#ffffff', preserveObjectStacking: true });
  const cols = ['#e8607e', '#9b6bd6', '#5aa6e6', '#f2b636', '#7fb069', '#f08a5d'];
  for (let i = 0; i < ${N}; i++) {
    const k = ${process.env.KIND ?? "-1"} >= 0 ? ${process.env.KIND ?? "-1"} : i % 6, at = { left: rnd() * 650, top: rnd() * 980 }, fill = cols[i % cols.length]; let o;
    if (k === 0) o = new L.Rect({ ...at, width: 80 + rnd() * 120, height: 50 + rnd() * 90, fill, rx: 12, ry: 12, angle: rnd() * 30, shadow: new L.Shadow({ color: 'rgba(0,0,0,0.3)', blur: 12, offsetX: 4, offsetY: 6 }) });
    else if (k === 1) o = new L.Circle({ ...at, radius: 30 + rnd() * 50, fill, stroke: '#333', strokeWidth: 3, opacity: 0.85 });
    else if (k === 2) o = new L.Textbox('Class notes and a longer line of words ' + i, { ...at, width: 200, fontSize: 22, fontFamily: 'sans-serif', fill: '#222', angle: rnd() * 10 });
    else if (k === 3) { o = new L.FabricImage(img); o.set({ ...at, scaleX: 0.3 + rnd() * 0.3, scaleY: 0.3 + rnd() * 0.3, angle: rnd() * 20 }); }
    else if (k === 4) o = new L.Path('M 0 0 C 40 -50 90 50 140 0 S 200 40 220 0', { ...at, fill: '', stroke: fill, strokeWidth: 6 });
    else o = new L.Triangle({ ...at, width: 90, height: 80, fill });
    canvas.add(o);
  }
  canvas.renderAll();
};
window.flushGpu = () => canvas.lowerCanvasEl.getContext("2d").getImageData(0, 0, 1, 1);
window.bench = (frames) => {
  const t0 = performance.now(); for (let i = 0; i < frames; i++) { canvas.renderAll(); flushGpu(); } const full = (performance.now() - t0) / frames;
  const o = canvas.getObjects()[Math.min(canvas.getObjects().length - 1, 3)]; canvas.setActiveObject(o); const t1 = performance.now();
  for (let i = 0; i < frames; i++) { o.set({ left: 100 + i * 3, top: 200 + i * 2 }); o.setCoords(); canvas.fire("object:moving", { target: o }); canvas.renderAll(); flushGpu(); }
  return { render: +full.toFixed(2), drag: +((performance.now() - t1) / frames).toFixed(2) };
};</script></body></html>`;
(async () => {
  const chromium = cp.spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=1000,1200', '--user-data-dir=' + path.join(temp, 'p'), '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let bad = 0;
  try {
    const portFile = path.join(temp, 'p', 'DevToolsActivePort'); for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n'); const results = {};
    for (const [name, libs, ns] of [['fabric', [FABRIC], 'fabric'], ['own', own, 'kbe']]) for (const dpr of [1, 2]) {
      const file = path.join(temp, name + dpr + '.html'); fs.writeFileSync(file, page(libs, ns));
      const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?file://' + file, { method: 'PUT' })).json();
      const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
      let id = 0; const waiting = new Map(); socket.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
      const send = (method, params = {}) => new Promise(res => { waiting.set(++id, res); socket.send(JSON.stringify({ id, method, params })); });
      await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1200, deviceScaleFactor: dpr, mobile: false });
      const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(name + ': ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
      for (let i = 0; i < 100 && !(await ev('typeof window.setup === "function"')); i++) await sleep(100); await ev('setup()'); await ev('bench(5)'); results[name + dpr] = await ev('bench(40)'); socket.close();
    }
    for (const dpr of [1, 2]) {
      const a = results['fabric' + dpr], b = results['own' + dpr], ratio = Math.max(b.render / a.render, b.drag / a.drag);
      console.log(`dpr ${dpr}: Fabric render ${a.render} ms, drag frame ${a.drag} ms | own render ${b.render} ms, drag frame ${b.drag} ms | own/Fabric ${(b.render / a.render).toFixed(2)}x, ${(b.drag / a.drag).toFixed(2)}x`);
      if (ratio > MAX_RATIO) bad++;
    }
    console.log(bad ? 'FAIL: the own engine is more than ' + MAX_RATIO + 'x slower than Fabric' : 'PASS: the own engine draws within ' + MAX_RATIO + 'x of Fabric');
  } catch (e) { console.log('harness error: ' + e.stack); bad++; } finally { const exited = new Promise(r => chromium.once('exit', r)); chromium.kill(); await exited; try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
  process.exit(bad ? 1 : 0);
})();
