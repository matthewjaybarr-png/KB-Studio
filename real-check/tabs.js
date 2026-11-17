// Real-window scenario: a real photo (KB_CHECK_PHOTO path baked in by run), brushes then the Edit photo tabs.
(async () => {
  const out = (n, t) => invoke('test_out', { name: n, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) });
  const log = [], wait = ms => new Promise(r => setTimeout(r, ms)), K = window.kbe || window.fabric;
  window.addEventListener('error', e => log.push({ error: String(e.message), at: (e.filename || '').split('/').pop() + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', e => log.push({ rejection: String(e.reason && e.reason.stack || e.reason).slice(0, 400) }));
  const say = () => $('#create-saved').textContent;
  const settle = async (max = 60000) => { let last = say(), same = 0, t = 0; while (t < max && same < 8) { await wait(250); t += 250; const s = say(); same = s === last && !/…$/.test(s) ? same + 1 : 0; last = s; } return last; };
  const image = () => board.getObjects().find(o => o.type === 'image');
  let step = 0;
  const measure = async label => {
    const im = image(), rec = { step: ++step, label, status: say(), objects: board.getObjects().map(o => o.type).join(',') };
    if (im) {
      const el = im.getElement(), nw = el.naturalWidth || el.width, nh = el.naturalHeight || el.height;
      const k = document.createElement('canvas'); k.width = 48; k.height = 32; const kx = k.getContext('2d'); kx.drawImage(el, 0, 0, 48, 32);
      const d = kx.getImageData(0, 0, 48, 32).data; let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i];
      Object.assign(rec, { natural: [nw, nh], box: [im.width, im.height, +im.scaleX.toFixed(4), im.cropX || 0, im.cropY || 0], alpha: +(a / (48 * 32 * 255)).toFixed(3), tiny: Array.from(d).filter((_, i) => i % 4 < 3 && (i >> 2) % 7 === 0).join(' ') });
    }
    log.push(rec);
    await out(`s${String(step).padStart(2, '0')}-${label}.txt`, board.lowerCanvasEl.toDataURL('image/jpeg', 0.7));
  };
  const client = uv => { const p = K.util.transformPoint(fromPicture(image(), uv), board.viewportTransform), r = board.upperCanvasEl.getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; };
  const ev = (type, uv) => { const [cx, cy] = client(uv); board.upperCanvasEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1, view: window })); };
  const stroke = async pts => { ev('mousemove', pts[0]); ev('mousedown', pts[0]); for (const p of pts.slice(1)) { ev('mousemove', p); await wait(15); } ev('mouseup', pts.at(-1)); await wait(50); await touchQueue; await settle(); };
  const line = (a, b, n = 14) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  const click = async sel => { const b = typeof sel === 'string' ? $(sel) : sel; if (!b) throw new Error('no ' + sel); b.click(); await wait(200); return settle(); };
  const tab = async name => { document.querySelector(`#photo-tabs [data-photo-tab="${name}"]`).click(); await wait(300); if (image()) { /* the tabs act on the picked picture */ } };
  const run = async (label, fn) => { try { await fn(); } catch (e) { log.push({ label, threw: String(e && e.stack || e).slice(0, 400) }); } await measure(label); };
  try {
    const bytes = new Uint8Array(await invoke('read_dropped', { uri: 'PHOTO' }));
    await editPhoto(new File([bytes], 'house.jpg', { type: 'image/jpeg' })); await wait(1500);
    log.push({ ua: navigator.userAgent.slice(-30), zoom: board.getZoom(), tabs: [...document.querySelectorAll('#photo-tabs [data-photo-tab]')].map(b => b.dataset.photoTab) });
    await measure('open');
    await run('remove', async () => { if (touch.tool !== 'remove') pickTouchTool('remove'); await stroke(line([0.55, 0.55], [0.62, 0.7])); });
    await run('blur', async () => { pickTouchTool('blur'); await stroke(line([0.1, 0.2], [0.35, 0.3])); });
    await run('spot', async () => { pickTouchTool('spot'); await stroke(line([0.8, 0.2], [0.81, 0.2], 2)); });
    await run('dodge', async () => { pickTouchTool('dodge'); await stroke(line([0.7, 0.8], [0.9, 0.8])); });
    await run('undo', async () => { await click('#create-undo'); });
    await run('effects-tab', async () => { await tab('effects'); board.setActiveObject(image()); board.requestRenderAll(); paintTouch(); await wait(300); log.push({ fun: [...document.querySelectorAll('#fun-list button')].map(b => b.textContent.trim()).slice(0, 30) }); });
    for (const i of [0, 3]) await run('effect-' + i, async () => { const b = document.querySelectorAll('#fun-list button')[i]; await click(b); await wait(1500); await settle(); });
    await run('effects-back', async () => { await click('#fun-back'); });
    await run('cutout-tab', async () => { await tab('cutout'); board.setActiveObject(image()); board.requestRenderAll(); paintTouch(); await wait(300); });
    await run('blur-background', async () => { await click('#cut-focus'); await wait(1000); await settle(90000); });
    await run('cut-auto', async () => { await click('#cut-auto'); await wait(1000); await settle(90000); log.push({ cutActions: [...document.querySelectorAll('#cut-actions button')].map(b => b.textContent.trim()) }); });
    await run('cut-keep', async () => { const b = [...document.querySelectorAll('#cut-actions button')].find(b => /keep|done|cut/i.test(b.textContent)); if (b) await click(b); await wait(1000); await settle(60000); });
  } catch (e) { log.push({ fatal: String(e), message: e && e.message, stack: e && e.stack, mode: typeof mode === 'string' ? mode : null, hasBoard: typeof board !== 'undefined' && !!board, home: document.querySelector('#home-status')?.textContent }); }
  await out('tabs.json', log);
})();
