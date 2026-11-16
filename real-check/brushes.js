(async () => {
  const out = (n, t) => invoke('test_out', { name: n, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) });
  const log = [], wait = ms => new Promise(r => setTimeout(r, ms));
  window.addEventListener('error', e => log.push({ error: String(e.message), at: e.filename + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', e => log.push({ rejection: String(e.reason && e.reason.stack || e.reason) }));
  try {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1200, 800); g.addColorStop(0, '#d9b99b'); g.addColorStop(1, '#6f8fae'); x.fillStyle = g; x.fillRect(0, 0, 1200, 800);
    for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},.25)`; x.fillRect((i * 7919) % 1200, (i * 104729) % 800, 3, 3); }
    x.fillStyle = '#222'; x.fillRect(280, 180, 40, 40);                    // thing to remove / spot
    x.fillStyle = '#e01010'; x.beginPath(); x.arc(900, 200, 14, 0, 7); x.fill(); // red pupil
    x.fillStyle = '#fff'; for (let i = 0; i < 20; i++) x.fillRect(560 + i * 8, 560, 4, 80); // stripes to blur
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    await editPhoto(new File([blob], 'test.jpg', { type: 'image/jpeg' }));
    await wait(1500);
    const image = () => board.getObjects().find(o => o.type === 'image');
    log.push({ mode, drawer, photoTab, tool: touch.tool, objects: board.getObjects().map(o => o.type), zoom: board.getZoom(), ua: navigator.userAgent });
    const pixels = async () => { const im = new Image(); im.src = image().kbOriginal || image().getSrc(); await im.decode(); const k = document.createElement('canvas'); k.width = im.naturalWidth; k.height = im.naturalHeight; const kx = k.getContext('2d'); kx.drawImage(im, 0, 0); return kx.getImageData(0, 0, k.width, k.height); };
    const client = uv => { const p = kbe.util.transformPoint(fromPicture(image(), uv), board.viewportTransform), r = board.upperCanvasEl.getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; };
    const ev = (type, uv, target) => { const [cx, cy] = client(uv); (target || board.upperCanvasEl).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1, view: window })); };
    const stroke = async pts => { ev('mousemove', pts[0]); ev('mousedown', pts[0]); for (const p of pts.slice(1)) { ev('mousemove', p); await wait(20); } ev('mouseup', pts.at(-1)); await wait(50); await touchQueue; await wait(300); };
    const line = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    const diff = (a, b, box) => { let n = 0, inside = 0, sum = 0; for (let y = 0; y < a.height; y++) for (let xx = 0; xx < a.width; xx++) { const i = (y * a.width + xx) * 4, d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); if (d > 24) { n++; sum += d; if (xx >= box[0] * a.width && xx <= box[2] * a.width && y >= box[1] * a.height && y <= box[3] * a.height) inside++; } } return { changed: n, insideBox: inside, mean: n ? Math.round(sum / n) : 0, size: [a.width, a.height] }; };
    const tests = [
      ['remove', line([0.22, 0.25], [0.28, 0.25]), [0.18, 0.15, 0.32, 0.35]],
      ['spot', line([0.4, 0.4], [0.42, 0.4], 3), [0.35, 0.33, 0.47, 0.47]],
      ['soften', line([0.6, 0.3], [0.7, 0.3]), [0.55, 0.2, 0.75, 0.4]],
      ['redeye', [[0.75, 0.25]], [0.7, 0.18, 0.8, 0.32]],
      ['blur', line([0.45, 0.75], [0.62, 0.75]), [0.4, 0.62, 0.68, 0.88]],
      ['dodge', line([0.1, 0.8], [0.25, 0.8]), [0.05, 0.7, 0.3, 0.9]],
      ['burn', line([0.1, 0.55], [0.25, 0.55]), [0.05, 0.45, 0.3, 0.65]],
      ['clone', line([0.8, 0.7], [0.9, 0.7]), [0.75, 0.6, 0.95, 0.8], [0.25, 0.25]],
      ['heal', line([0.8, 0.9], [0.9, 0.9]), [0.75, 0.82, 0.95, 0.98], [0.5, 0.75]]
    ];
    for (const [tool, pts, box, source] of tests) {
      try {
        const before = await pixels();
        if (touch.tool !== tool) pickTouchTool(tool);
        if (source) { touch.picking = true; touch.offset = null; paintTouch(); ev('mousedown', source); ev('mouseup', source); await wait(100); }
        await stroke(pts);
        const after = await pixels();
        log.push({ tool, picked: touch.tool, brushing: brushing(), status: $('#create-saved').textContent, ...diff(before, after, box) });
      } catch (e) { log.push({ tool, threw: String(e && e.stack || e) }); }
    }
    await out('final.txt', image().kbOriginal || image().getSrc());
    await out('board.txt', board.lowerCanvasEl.toDataURL('image/jpeg', 0.8));
  } catch (e) { log.push({ fatal: String(e && e.stack || e) }); }
  await out('brushes.json', log);
})();
