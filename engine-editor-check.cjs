// Behaviour check of the own text editor (ui/engine/editor.js) in headless Chromium, driven over DevTools with real input events:
// key presses, IME composition, mouse clicks and drags, copy, cut and paste events. Nothing here assigns .value. Set CHROMIUM to
// select the browser. Usage: node engine-editor-check.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = __dirname;
const font = (f, w) => `@font-face{font-family:${f};font-weight:${w};src:url(file://${root}/ui/fonts/${f.toLowerCase()}-latin-${w}-normal.woff2)}`;
const page = `<style>${font('Andika', 400)}${font('Andika', 700)} body{margin:0} canvas{display:block}</style><script src="file://${root}/ui/engine/model.js"></script><script src="file://${root}/ui/engine/render.js"></script><script src="file://${root}/ui/engine/text.js"></script><script src="file://${root}/ui/engine/editor.js"></script>
<canvas id=c width=500 height=300></canvas><script>
kbe.FabricObject.ownDefaults.originX = 'left'; kbe.FabricObject.ownDefaults.originY = 'top';
const el = document.getElementById('c'), canvas = new kbe.StaticCanvas(el, { width: 500, height: 300, backgroundColor: '#fff' }); kbe.attachTextEditing(canvas, el);
window.log = [];
for (const n of ['text:changed', 'text:editing:entered', 'text:editing:exited', 'object:modified', 'text:selection:changed']) canvas.on(n, () => log.push(n));
window.make = (text, opts = {}) => { window.t?.exitEditing(); canvas.clear(); const t = new kbe.Textbox(text, { left: 20, top: 20, width: 200, fontSize: 24, fontFamily: 'Andika', ...opts }); for (const n of ['changed', 'editing:entered', 'editing:exited', 'modified']) t.on(n, () => log.push('obj:' + n)); canvas.add(t); canvas.renderAll(); log.length = 0; window.t = t; return t; };
window.state = () => JSON.stringify({ text: t.text, a: t.selectionStart, b: t.selectionEnd, editing: t.isEditing, focus: document.activeElement === t.hiddenTextarea, styles: t.styles, log });
document.title = 'ready';
</script>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEYS = { Backspace: 8, Delete: 46, Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, Escape: 27 };
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-editor-check-'));
  const file = path.join(temp, 'page.html'); fs.writeFileSync(file, page);
  const browser = cp.spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=900,700', '--user-data-dir=' + path.join(temp, 'profile'), '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let failed = 0, passed = 0, crash;
  try {
    const portFile = path.join(temp, 'profile', 'DevToolsActivePort');
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?file://' + file, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const waiting = new Map();
    socket.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(resolve => { waiting.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const ev = async expr => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400)); return m.result?.result?.value; };
    for (let i = 0; i < 100 && await ev('document.title') !== 'ready'; i++) await sleep(100);
    const st = async () => JSON.parse(await ev('state()'));
    const mod = (ctrl, shift) => (ctrl ? 2 : 0) | (shift ? 8 : 0);
    // a key press as the keyboard sends it: text keys carry their character, the others a key code
    const press = async (key, { ctrl, shift, commands } = {}) => {
      const printable = key.length === 1 && !ctrl, code = KEYS[key] || key.toUpperCase().charCodeAt(0), base = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: code, modifiers: mod(ctrl, shift) };
      await send('Input.dispatchKeyEvent', printable ? { ...base, type: 'keyDown', text: key, unmodifiedText: key } : key === 'Enter' ? { ...base, type: 'keyDown', text: '\r' } : { ...base, type: 'rawKeyDown', commands });
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    };
    const type = async s => { for (const ch of s) await press(ch); };
    const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra });
    const click = async (x, y, count = 1) => { for (let n = 1; n <= count; n++) { await mouse('mousePressed', x, y, { clickCount: n }); await mouse('mouseReleased', x, y, { clickCount: n }); } };
    const check = (name, ok, detail) => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
    const expectState = async (name, want) => { const s = await st(); const bad = Object.entries(want).filter(([k, v]) => JSON.stringify(s[k]) !== JSON.stringify(v)); check(name, !bad.length, bad.map(([k, v]) => k + ' want ' + JSON.stringify(v) + ' got ' + JSON.stringify(s[k])).join('; ')); return s; };

    // --- double-click enters editing and picks the word; typing replaces it; one undo per run of typing
    await ev(`make('Hello world')`);
    await click(50, 35, 2); await sleep(50);
    let s = await expectState('double-click enters and selects the word', { text: 'Hello world', a: 0, b: 5, editing: true, focus: true });
    check('entering fires the events', s.log.includes('obj:editing:entered') && s.log.includes('text:editing:entered'), s.log.join());
    await type('X'); await type('yz');
    await expectState('typing replaces the selection and goes on', { text: 'Xyz world', a: 3, b: 3 });
    await press('z', { ctrl: true }); await expectState('undo takes back the typed run', { text: 'X world' });
    await press('z', { ctrl: true }); await expectState('undo again restores the selection and text', { text: 'Hello world', a: 0, b: 5 });
    await press('y', { ctrl: true }); await expectState('redo', { text: 'X world' });
    await press('z', { ctrl: true, shift: true }); await expectState('Ctrl+Shift+Z redoes the next step too', { text: 'Xyz world' });
    await press('z', { ctrl: true }); await press('z', { ctrl: true }); await expectState('undo twice more', { text: 'Hello world' });
    s = await st(); check('text:changed fired for each edit', s.log.filter(x => x === 'text:changed').length >= 5, s.log.join());

    // --- movement keys
    await press('End'); await expectState('End', { a: 11, b: 11 });
    await press('Home'); await expectState('Home', { a: 0, b: 0 });
    await press('ArrowRight'); await press('ArrowRight'); await expectState('Right twice', { a: 2, b: 2 });
    await press('ArrowRight', { shift: true }); await press('ArrowRight', { shift: true }); await expectState('Shift+Right selects', { a: 2, b: 4 });
    await press('ArrowLeft'); await expectState('Left collapses to the start', { a: 2, b: 2 });
    await press('ArrowRight', { ctrl: true }); await expectState('Ctrl+Right jumps a word', { a: 5, b: 5 });
    await press('ArrowRight', { ctrl: true }); await expectState('Ctrl+Right again', { a: 11, b: 11 });
    await press('ArrowLeft', { ctrl: true }); await expectState('Ctrl+Left', { a: 6, b: 6 });
    await press('a', { ctrl: true }); await expectState('Ctrl+A selects all', { a: 0, b: 11 });

    // --- native deletion and Enter
    await press('End'); await press('Backspace'); await expectState('Backspace deletes', { text: 'Hello worl', a: 10, b: 10 });
    await press('Home'); await press('Delete'); await expectState('Delete deletes forward', { text: 'ello worl', a: 0, b: 0 });
    await press('ArrowRight'); await press('Enter'); await expectState('Enter breaks the line', { text: 'e\nllo worl', a: 2, b: 2 });
    await press('Backspace', { ctrl: true }); await expectState('Ctrl+Backspace deletes back over the break', { text: 'ello worl' });

    // --- up and down through wrapped lines, keeping the column
    await ev(`make('one two three four five six seven', { width: 120 }); t.enterEditing(); t.setSelectionStyles({}, 0, 0)`);
    s = await ev(`JSON.stringify(t.textLines)`); const lines = JSON.parse(s); check('text wraps to several lines', lines.length >= 3, s);
    await press('Home', { ctrl: true }); await press('ArrowRight'); await press('ArrowRight'); await press('ArrowDown');
    s = await st(); const secondStart = lines[0].length + 1; check('Down moves onto the next line, same column', s.a >= secondStart && s.a <= secondStart + lines[1].length, JSON.stringify([s.a, lines]));
    await press('ArrowUp'); await expectState('Up comes back to the same column', { a: 2 });
    await press('ArrowUp'); await expectState('Up on the first line goes to the start', { a: 0 });
    await press('ArrowDown', { shift: true }); s = await st(); check('Shift+Down extends the selection', s.a === 0 && s.b > 0 && s.editing, JSON.stringify(s));
    await press('End', { ctrl: true }); await expectState('Ctrl+End', { a: 33, b: 33 });
    await press('ArrowDown'); await expectState('Down on the last line goes to the end', { a: 33, b: 33 });

    // --- styles follow typing, and copy, cut and paste keep them
    await ev(`make('Hello world'); t.enterEditing(); t.selectAll()`);
    await ev(`t.setSelectionStyles({ fontWeight: 'bold' }, 0, 5); t.selectionStart = t.selectionEnd = 5`);
    await type('!'); s = await st(); check('a letter typed after bold text is bold', s.styles[0]?.[5]?.fontWeight === 'bold', JSON.stringify(s.styles));
    await press('Home'); await press('ArrowRight', { ctrl: true, shift: true }); await expectState('Ctrl+Shift+Right selects the word', { a: 0, b: 5 });
    await press('c', { ctrl: true, commands: ['copy'] });
    await press('End'); await ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Hello'); t.hiddenTextarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    s = await expectState('paste puts the copied text in', { text: 'Hello! worldHello', a: 17, b: 17 });
    check('paste keeps the copied styles', s.styles[0]?.[12]?.fontWeight === 'bold' && s.styles[0]?.[16]?.fontWeight === 'bold' && !s.styles[0]?.[8], JSON.stringify(s.styles));
    await ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'a\\r\\nb'); t.hiddenTextarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await expectState('pasting text from elsewhere inserts it plain, line breaks normalised', { text: 'Hello! worldHelloa\nb' });
    await press('a', { ctrl: true }); await press('x', { ctrl: true, commands: ['cut'] }); await expectState('cut removes the selection', { text: '', a: 0, b: 0 });
    await press('z', { ctrl: true }); await expectState('undo puts a cut back', { text: 'Hello! worldHelloa\nb' });

    // --- IME composition: live text while composing, one undo step for the whole composition
    await ev(`make('ab'); t.enterEditing()`); await press('Home'); await press('ArrowRight');
    await send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    await expectState('composition text shows while composing', { text: 'anib' });
    await send('Input.imeSetComposition', { text: 'ni hao', selectionStart: 6, selectionEnd: 6 });
    await expectState('composition updates in place', { text: 'ani haob' });
    await send('Input.insertText', { text: '你好' });
    s = await expectState('the committed text replaces the composition', { text: 'a你好b', a: 3, b: 3 });
    await press('z', { ctrl: true }); await expectState('one undo takes back the whole composition', { text: 'ab' });

    // --- emoji count as one letter
    await ev(`make('a'); t.enterEditing()`); await press('End');
    await send('Input.insertText', { text: '👍' }); await expectState('an emoji moves the caret by one', { text: 'a👍', a: 2, b: 2 });
    await press('ArrowLeft'); await expectState('Left steps over the whole emoji', { a: 1 });
    await press('End'); await press('Backspace'); await expectState('Backspace removes the whole emoji', { text: 'a', a: 1, b: 1 });

    // --- mouse: click places the caret, drag selects, triple-click picks the line, clicking outside leaves
    await ev(`make('Hello world', { width: 300 }); t.enterEditing(); canvas.renderAll(); JSON.stringify(t._boxes[0].map(b => b.left))`);
    const lefts = JSON.parse(await ev(`JSON.stringify(t._boxes[0].map(b => b.left))`)), at = i => 20 + lefts[i] + 1;
    await click(at(3), 35); await expectState('a click puts the caret in the text', { a: 3, b: 3 });
    await mouse('mousePressed', at(1), 35, { clickCount: 1 }); await mouse('mouseMoved', at(4), 35); await mouse('mouseMoved', at(7), 35); await mouse('mouseReleased', at(7), 35, { clickCount: 1 });
    await expectState('dragging selects', { a: 1, b: 7 });
    await click(at(8), 35, 3); await expectState('triple click selects the line', { a: 0, b: 11 });
    const pix = await ev(`(() => { canvas.renderAll(); const d = el.getContext('2d').getImageData(0, 0, 500, 300).data; let blue = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 25 && d[i + 2] > 150) blue++; return blue; })()`);
    check('the selection is drawn', pix > 200, 'tinted pixels: ' + pix);
    await ev(`log.length = 0`);
    await click(450, 280); s = await st(); check('clicking outside leaves editing', !s.editing && s.log.includes('text:editing:exited') && s.log.includes('obj:editing:exited'), JSON.stringify(s));
    check('no change, no modified event', !s.log.includes('obj:modified') && !s.log.includes('object:modified'), s.log.join());

    // --- the IME candidate window follows the caret
    await ev(`make('Hello there'); t.enterEditing(); t.selectionStart = t.selectionEnd = 0`);
    const imeAt = async i => ev(`(${i}, (r => ({ x: r.left, y: r.top, h: r.height }))(document.querySelector('[data-kb-editor]').getBoundingClientRect()))`);
    await press('Home'); const a0 = await imeAt(0); await press('End'); const a1 = await imeAt(11), box = await ev(`(r => ({ l: r.left + t.left, t: r.top + t.top, w: t.width, h: t.height }))(document.getElementById('c').getBoundingClientRect())`);
    check('the IME box moves right with the caret', a1.x > a0.x + 40, JSON.stringify([a0, a1]));
    check('the IME box sits on the text line', a0.y >= box.t - 2 && a0.y <= box.t + box.h + 2 && Math.abs(a0.y - a1.y) < 1, JSON.stringify([a0, box]));
    await ev(`t.exitEditing()`);
    // --- leaving after a change tells everyone, in Fabric's order
    await ev(`make('Hi'); t.enterEditing(); t.selectionStart = t.selectionEnd = 2`);
    await type('!'); await ev(`log.length = 0`); await press('Escape'); s = await st();
    check('Escape leaves editing', !s.editing && s.text === 'Hi!', JSON.stringify(s));
    check('leaving after a change fires modified and object:modified', JSON.stringify(s.log) === JSON.stringify(['obj:editing:exited', 'obj:modified', 'text:editing:exited', 'object:modified']), s.log.join());
    check('the hidden textarea is gone', await ev(`!document.querySelector('[data-kb-editor]')`));
    check('the saved text carries the edit', await ev(`t.toObject().text === 'Hi!'`));

    // --- own drawing of the caret
    await ev(`make('Hi'); t.enterEditing(); t.selectionStart = t.selectionEnd = 1; t.cursorColor = '#ff0000'; t._cursorOn = true; canvas.renderAll(); 0`);
    const red = await ev(`(() => { const d = el.getContext('2d').getImageData(0, 0, 500, 300).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++; return n; })()`);
    check('the caret is drawn', red > 20, 'red pixels: ' + red);
    socket.close();
  } catch (e) { crash = e; } finally { const exited = new Promise(r => browser.once('exit', r)); browser.kill(); await exited; }
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left for the system to clear */ }
  if (crash) { console.error('editor check stopped: ' + (crash.stack || crash)); process.exit(1); }
  console.log(`${failed ? 'FAIL' : 'PASS'} editor: ${passed}/${passed + failed} checks`);
  process.exit(failed ? 1 : 0);
})();
