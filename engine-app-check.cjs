// A/B of what the app itself produces: the same generators run in the build on `main` (Fabric) and in this working tree (own engine),
// through the app's real scripts in headless Chromium with the Tauri commands mocked as in ui-check.cjs. Each case is drawn to a PNG in
// both and compared pixel by pixel, and the saved JSON (toObject) is compared field by field.
//   node engine-app-check.cjs [--only text] [--dump DIR] [--threshold 3] [--selftest] [--verbose]
// OLD_UI=dir uses an unpacked `ui` folder as the old build (default: `git archive main` into a temp folder).
// A case passes when under THRESHOLD % of its pixels differ strongly (any channel off by more than 40) and the saved JSON matches
// within 0.001. Cases that fail are written to DUMP as old | new | difference.
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = __dirname, argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const ONLY = opt('only', ''), DUMP = opt('dump', ''), THRESHOLD = Number(opt('threshold', 3)), VERBOSE = opt('verbose', false), SELFTEST = opt('selftest', false), JOBS = String(opt('jobs', 'starters,items,fixture,roundtrip,sheets,ops,exports')).split(',');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-app-check-'));
let oldRoot = process.env.OLD_UI && path.dirname(process.env.OLD_UI);
if (!oldRoot) { oldRoot = path.join(temp, 'old'); fs.mkdirSync(oldRoot); cp.execSync('git archive main ui test-data | tar -x -C ' + oldRoot, { cwd: root }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the Tauri mock shared with ui-check.cjs
const checkSrc = fs.readFileSync(path.join(root, 'ui-check.cjs'), 'utf8');
const mockLiteral = checkSrc.match(/const mock = (`[\s\S]*?`);\nconst test = /)[1];
const mock = (0, eval)(mockLiteral);

function assemble(uiDir) {
  const ui = f => fs.readFileSync(path.join(uiDir, f), 'utf8');
  let html = ui('index.html').replace('<link rel="stylesheet" href="style.css">', () => '<style>' + ui('style.css') + '</style>').replace('<head>', () => '<head><base href="file://' + uiDir + '/">');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, f) => (f === 'develop.js' ? mock : '') + '<script>' + ui(f) + '</script>');
  const at = html.lastIndexOf('</body>');
  return html.slice(0, at) + '<script>window.kbe = window.kbe || window.fabric; window.ENGINE = window.fabric ? "fabric" : "kbe";</script>' + html.slice(at);
}

// ---- what runs inside each page
const jobs = `
window.H = {
  async settle() { await Promise.allSettled([...adding]); await flush(); },
  async starter(name, width) {
    await fonts(); const [w, h] = sizeIn(starterPage(name)).map(v => Math.round(v * PX));
    const sc = new kbe.StaticCanvas(document.createElement('canvas'), { width: w, height: h, backgroundColor: '#ffffff' });
    try { await STARTERS[name](sc); sc.renderAll(); return { png: sc.toDataURL({ format: 'png', multiplier: width / w }), json: sc.toObject(KEEP) }; } finally { sc.dispose(); }
  },
  starters() { return Object.keys(STARTERS); },
  async item(kind, value, width) {
    await fonts(); await newDesign(); await H.settle();
    dropItem([kind, value], new kbe.Point(300, 400)); await new Promise(r => setTimeout(r, 30)); await H.settle();
    const [w] = pagePx(), json = board.toObject(KEEP), png = await render(width / w, 'png');
    return { png, json, count: board.getObjects().length };
  },
  items() {
    const out = [];
    for (const [k] of SHAPE_TILES) out.push(['shape', k]);
    for (const k of Object.keys(COMBOS)) out.push(['combo', k]);
    for (const [k] of FRAME_TILES) out.push(['frame', k]);
    for (const k of Object.keys(GRIDS)) out.push(['grid', k]);
    out.push(['text', 'Hello Class']);
    if (typeof CHART_KINDS !== 'undefined') for (const [k] of CHART_KINDS) out.push(['chart', k]);
    return out;
  },
  async fixture(json, index, width) {
    await fonts(); const page = json.pages[index], sc = new kbe.StaticCanvas(document.createElement('canvas'), { width: json.width || 816, height: json.height || 1056 });
    try { await sc.loadFromJSON(page); sc.renderAll(); return { png: sc.toDataURL({ format: 'png', multiplier: width / sc.width }), json: sc.toObject(KEEP) }; } finally { sc.dispose(); }
  },
  async sheetKinds() { return [...new Set([...Object.keys(SHEET_KINDS), 'search', 'crossword', 'math'])]; },
  async sheet(kind, width) {
    await fonts(); await newDesign(); await H.settle(); openSheet(kind); sheet.seed = 7;
    const k = SHEET_KINDS[kind] || {}; if (k.words || kind === 'search' || kind === 'crossword') $('#sheet-words').value = kind === 'crossword' ? 'apple: a red fruit\\nplum: a purple fruit\\npear: a green fruit\\nlemon: a sour fruit' : kind === 'search' ? 'apple\\nplum\\npear\\nlemon\\nmango' : (k.placeholder || 'Ava\\nBen\\nCharlie');
    $('#sheet-make').click(); for (let i = 0; i < 300; i++) { await new Promise(r => setTimeout(r, 100)); if (!navigating && !$('#sheet-dialog').open) break; }
    await H.settle(); const pages = allPages().slice(0, 4), shots = [], jsons = [];
    for (const p of pages) { jsons.push(p); shots.push(await render(width / pagePx()[0], 'png', 0.92, p)); }
    const imgs = await Promise.all(shots.map(u => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
    const c = document.createElement('canvas'); c.width = imgs[0].width; c.height = imgs.reduce((n, i) => n + i.height, 0); let y = 0; const x = c.getContext('2d'); for (const i of imgs) { x.drawImage(i, 0, y); y += i.height; }
    return { png: c.toDataURL('image/png'), json: { title: design.title, pages: jsons, count: allPages().length } };
  },
  async ops(width) {
    await fonts(); await newDesign(); await H.settle(); const snap = () => board.toObject(KEEP), out = {}, wait = async () => { await new Promise(r => setTimeout(r, 40)); await H.settle(); };
    for (const [i, k] of ['rect', 'circle', 'star'].entries()) { dropItem(['shape', SHAPE_TILES[i][0]], new kbe.Point(200 + i * 160, 300 + i * 40)); await wait(); }
    dropItem(['text', 'Hello Class'], new kbe.Point(300, 600)); await wait(); out.added = snap();
    board.setActiveObject(new kbe.ActiveSelection(board.getObjects().slice(0, 2), { canvas: board })); groupSelected(); await wait(); out.grouped = snap();
    groupSelected(true); await wait(); out.ungrouped = snap();
    board.setActiveObject(board.getObjects()[0]); copySelected(); pasteSelected(); await wait(); out.pasted = snap();
    duplicateSelected(); await wait(); out.duplicated = snap();
    await undoDesign(); await undoDesign(); await wait(); out.undone = snap(); await redoDesign(); await wait(); out.redone = snap();
    board.setActiveObject(board.getObjects()[1]); alignTo('center', false, (r, w) => (w - r.width) / 2 - r.left); await wait(); out.aligned = snap();
    reorderSelected(1); await wait(); out.reordered = snap(); removeSelected(); await wait(); out.removed = snap();
    board.discardActiveObject(); const [w] = pagePx();
    return { png: await render(width / w, 'png'), json: out };
  },
  async exports(width) {
    await fonts(); await newDesign(); await H.settle(); dropItem(['shape', SHAPE_TILES[0][0]], new kbe.Point(300, 400)); dropItem(['text', 'Export check'], new kbe.Point(300, 700)); await new Promise(r => setTimeout(r, 40)); await H.settle();
    const bytes = await makePdf(), text = new TextDecoder('latin1').decode(bytes), [w] = pagePx(), jpg = await render(width / w, 'jpeg', 0.92);
    return { png: jpg, json: { pdfPages: (text.match(/\\/Type\\s*\\/Page\\b/g) || []).length, mediaBox: ((text.match(/\\/MediaBox\\s*\\[([^\\]]*)\\]/) || [0, ''])[1]).trim().split(/\\s+/).map(Number), isPdf: text.startsWith('%PDF'), images: (text.match(/\\/Subtype\\s*\\/Image/g) || []).length } };
  },
  async roundtrip(json, index, width) {
    await fonts(); const page = json.pages[index], sc = new kbe.StaticCanvas(document.createElement('canvas'), { width: 816, height: 1056 });
    try {
      await sc.loadFromJSON(page); const once = sc.toObject(KEEP); await sc.loadFromJSON(once); const twice = sc.toObject(KEEP); sc.renderAll();
      const diff = (a, b, p = '', n = []) => { if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 0.001) n.push(p); } else if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p + '.' + k, n); } else if (a !== b) n.push(p); return n; };
      return { png: sc.toDataURL({ format: 'png', multiplier: width / 816 }), json: { objects: once.objects.length, original: page.objects.length, stable: diff(once, twice).length, changedByLoad: diff(page, once).filter(p => !/\\.version$/.test(p)).length } };
    } finally { sc.dispose(); }
  },
  async rawpage(page, w, h, width, mutate) {
    await fonts(); const sc = new kbe.StaticCanvas(document.createElement('canvas'), { width: w, height: h });
    try { await sc.loadFromJSON(page); if (mutate) sc.getObjects()[0].set({ left: sc.getObjects()[0].left + 3 }); sc.renderAll(); return { png: sc.toDataURL({ format: 'png', multiplier: width / w }), json: sc.toObject(KEEP) }; } finally { sc.dispose(); }
  },
  async diff(a, b) {
    const load = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const [A, B] = await Promise.all([load(a), load(b)]), w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
    const px = i => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#00ff00'; x.fillRect(0, 0, w, h); x.drawImage(i, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(A), db = px(B), out = document.createElement('canvas'); out.width = w; out.height = h; const ox = out.getContext('2d'), od = ox.createImageData(w, h);
    let strong = 0, sum = 0, max = 0, minx = w, miny = h, maxx = -1, maxy = -1;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
      sum += d; if (d > max) max = d;
      if (d > 40) { strong++; const p = i / 4, x = p % w, y = (p / w) | 0; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
      od.data[i] = od.data[i + 1] = od.data[i + 2] = 255 - Math.min(255, d * 4); od.data[i + 3] = 255; if (d > 40) { od.data[i] = 255; od.data[i + 1] = od.data[i + 2] = 0; }
    }
    ox.putImageData(od, 0, 0);
    const sheet = document.createElement('canvas'); sheet.width = w * 3; sheet.height = h; const sx = sheet.getContext('2d'); sx.fillStyle = '#888'; sx.fillRect(0, 0, w * 3, h); sx.drawImage(A, 0, 0); sx.drawImage(B, w, 0); sx.drawImage(out, 2 * w, 0);
    return { w, h, sizeOld: [A.width, A.height], sizeNew: [B.width, B.height], strongPct: 100 * strong / (w * h), meanAbs: sum / (w * h), max, box: strong ? [minx, miny, maxx, maxy] : null, sheet: sheet.toDataURL('image/png') };
  }
};
`;

// ---- the browser plumbing
(async () => {
  const chromium = cp.spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=1300,850',
    '--user-data-dir=' + path.join(temp, 'profile'), '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let failed = 0, total = 0; const rows = [];
  try {
    const portFile = path.join(temp, 'profile', 'DevToolsActivePort');
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const open = async (name, uiDir) => {
      const file = path.join(temp, name + '.html'); fs.writeFileSync(file, assemble(uiDir));
      const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?file://' + file, { method: 'PUT' })).json();
      const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
      let id = 0; const waiting = new Map(); socket.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
      const send = (method, params = {}) => new Promise(res => { waiting.set(++id, res); socket.send(JSON.stringify({ id, method, params })); });
      await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
      const evalIn = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(name + ': ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
      for (let i = 0; i < 400; i++) { if (await evalIn('typeof STARTERS !== "undefined" && typeof board !== "undefined" && typeof newDesign === "function"').catch(() => false)) break; await sleep(100); }
      await evalIn(jobs); return { evalIn, name };
    };
    const oldPage = await open('old', path.join(oldRoot, 'ui')), newPage = await open('new', path.join(root, 'ui'));
    console.log('engines:', await oldPage.evalIn('ENGINE'), 'vs', await newPage.evalIn('ENGINE'));
    const J = JSON.stringify;
    if (opt('eval', '')) { // --eval 'expression' (a file path works too): run it in both pages and print what each returns, for debugging
      let code = String(opt('eval', '')); if (fs.existsSync(code)) code = fs.readFileSync(code, 'utf8');
      for (const p of [oldPage, newPage]) console.log(p.name + ': ' + J(await p.evalIn('(async () => { ' + code + ' })()').catch(e => 'ERROR ' + e.message), null, 1));
      throw new Error('eval done');
    }
    const same = (a, b, p = '', out = []) => {
      if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 0.001) out.push(p + ': ' + a + ' vs ' + b); }
      else if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) same(a[k], b[k], p + '.' + k, out); }
      else if (a !== b && !/\.kbTable$/.test(p)) out.push(p + ': ' + J(a) + ' vs ' + J(b)); return out; // kbTable is a fresh random id each time
    };
    const compare = async (label, oldRes, newRes) => {
      total++; const d = await newPage.evalIn(`H.diff(${J(oldRes.png)}, ${J(newRes.png)})`), jd = same(oldRes.json, newRes.json), sheet = d.sheet; delete d.sheet;
      const ok = d.strongPct < THRESHOLD && !jd.length && J(d.sizeOld) === J(d.sizeNew); if (!ok) failed++;
      rows.push({ label, ok, strongPct: +d.strongPct.toFixed(3), meanAbs: +d.meanAbs.toFixed(3), max: d.max, json: jd.length });
      if (!ok || VERBOSE) console.log((ok ? 'ok   ' : 'FAIL ') + label + '  strong ' + d.strongPct.toFixed(3) + '%  mean ' + d.meanAbs.toFixed(3) + '  max ' + d.max + (d.box ? '  box ' + d.box : '') + (J(d.sizeOld) !== J(d.sizeNew) ? '  sizes ' + J(d.sizeOld) + ' vs ' + J(d.sizeNew) : '') + (jd.length ? '\n     json diffs (' + jd.length + '): ' + jd.slice(0, 4).join(' | ') : ''));
      if (DUMP && (!ok || VERBOSE) && sheet) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, label.replace(/[^\w]+/g, '-') + '.png'), Buffer.from(sheet.split(',')[1], 'base64')); }
      return ok;
    };
    const run = async (label, call) => { if (ONLY && !label.includes(ONLY)) return; try { const [o, n] = await Promise.all([oldPage.evalIn(call), newPage.evalIn(call)]); await compare(label, o, n); } catch (e) { total++; failed++; console.log('FAIL ' + label + ' threw: ' + e.message.slice(0, 300)); } };
    const WIDTH = 600;
    if (SELFTEST) { // the comparison must notice a small deliberate change
      const page = { version: '7.4.0', objects: [{ type: 'Rect', version: '7.4.0', left: 40, top: 40, width: 200, height: 120, fill: '#336699', stroke: '#000000', strokeWidth: 2 }, { type: 'Circle', version: '7.4.0', left: 90, top: 90, radius: 60, fill: '#cc6633' }] };
      const call = m => `H.rawpage(${J(page)}, 300, 300, 300, ${m})`;
      const [a, b, c] = await Promise.all([newPage.evalIn(call(false)), newPage.evalIn(call(false)), newPage.evalIn(call(true))]);
      const same1 = await newPage.evalIn(`H.diff(${J(a.png)}, ${J(b.png)})`), moved = await newPage.evalIn(`H.diff(${J(a.png)}, ${J(c.png)})`);
      console.log('selftest identical: strong ' + same1.strongPct.toFixed(4) + '%; one object moved 3px: strong ' + moved.strongPct.toFixed(4) + '%, json diffs ' + same(a.json, c.json).length);
      if (same1.strongPct !== 0 || moved.strongPct < 0.3 || !same(a.json, c.json).length) { console.log('SELFTEST FAILED: the comparison cannot tell a moved object from the same picture'); failed++; }
      else console.log('selftest ok');
    }
    if (JOBS.includes('starters')) for (const name of await newPage.evalIn('H.starters()')) await run('starter:' + name, `H.starter(${J(name)}, ${WIDTH})`);
    if (JOBS.includes('items')) for (const [k, v] of await newPage.evalIn('H.items()')) await run('item:' + k + ':' + v, `H.item(${J(k)}, ${J(v)}, ${WIDTH})`);
    if (JOBS.includes('sheets')) for (const kind of await newPage.evalIn('H.sheetKinds()')) await run('sheet:' + kind, `H.sheet(${J(kind)}, ${WIDTH})`);
    if (JOBS.includes('ops')) await run('ops', `H.ops(${WIDTH})`);
    if (JOBS.includes('exports')) await run('exports', `H.exports(${WIDTH})`);
    if (JOBS.includes('roundtrip')) {
      const fx = JSON.parse(fs.readFileSync(path.join(root, 'test-data/create-fabric6.json'), 'utf8')), pg = fx.doc.pages || [fx.doc.canvas];
      for (let i = 0; i < pg.length; i++) await run('roundtrip:page' + i, `H.roundtrip(${J({ pages: pg })}, ${i}, ${WIDTH})`);
    }
    if (JOBS.includes('fixture')) {
      const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test-data/create-fabric6.json'), 'utf8')), pages = fixture.doc.pages || [fixture.doc.canvas];
      for (let i = 0; i < pages.length; i++) await run('fixture:page' + i, `H.fixture(${J({ pages, width: 816, height: 1056 })}, ${i}, ${WIDTH})`);
    }
    console.log((failed ? 'FAIL: ' : 'PASS: ') + (total - failed) + '/' + total + ' cases match' + (rows.length ? '; worst strong ' + Math.max(...rows.map(r => r.strongPct)).toFixed(3) + '% (' + rows.sort((a, b) => b.strongPct - a.strongPct)[0].label + ')' : ''));
    if (opt('report', '')) fs.writeFileSync(String(opt('report', '')), J(rows, null, 1));
  } catch (e) { console.log('harness error: ' + e.stack); failed++; } finally { const exited = new Promise(r => chromium.once('exit', r)); chromium.kill(); await exited; try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
  process.exit(failed ? 1 : 0);
})();
