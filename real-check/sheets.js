// Real-window scenario for Classroom's worksheet and game makers: each one is clicked, set up and made, then page 1
// (and the last page) go out as PNG the way Download draws them, and the whole design as a PDF, and Undo is tried.
// ONLY picks one maker by its button; 'ALL' runs every one. Decode the .b64 files with `base64 -d`.
(async () => {
  const ONLY = 'ALL';
  const out = (n, t) => invoke('test_out', { name: n, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) });
  const log = [], wait = ms => new Promise(r => setTimeout(r, ms)), set = (sel, v) => { $(sel).value = v; $(sel).onchange?.(); };
  window.addEventListener('error', e => log.push({ error: String(e.message), at: (e.filename || '').split('/').pop() + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', e => log.push({ rejection: String(e.reason && e.reason.stack || e.reason).slice(0, 400) }));
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const MAKERS = {
    'sheet-bingo': () => { set('#sheet-bingo-what', 'pictures'); set('#sheet-bingo-size', '4'); set('#sheet-bingo-count', '6'); },
    'sheet-bingo words': () => { set('#sheet-bingo-what', 'words'); set('#sheet-bingo-size', '3'); set('#sheet-bingo-count', '6'); $('#sheet-words').value = 'cat\ndog\nsun\nhat\npig\nbus\nred\nbig\nrun\njump\nplay\nbutterfly'; }
  };
  try {
    await newDesign(); await wait(1500); if (!$('#create-whatsnew').hidden) $('#create-whatsnew button').click(); // the makers live in Create's Classroom drawer, so a design is open first
    for (const [name, setup] of Object.entries(MAKERS)) {
      if (ONLY !== 'ALL' && ONLY !== name) continue;
      const id = name.split(' ')[0], tag = name.replace(/\W+/g, '-'), rec = { name }, before = design.title;
      try {
        $('#' + id).click(); await wait(300); setup(); await wait(200);
        $('#sheet-make').click();
        for (let t = 0; t < 120 && (design.title === before || $('#sheet-dialog').open); t++) await wait(250);
        await wait(1200);
        const pages = allPages();
        Object.assign(rec, { title: design.title, pages: pages.length, note: $('#sheet-note').textContent, done: $('#sheet-done').textContent, status: $('#create-saved').textContent });
        await out(tag + '-first.png.b64', (await render(1, 'png', 0.92, pages[0])).split(',')[1]);
        await out(tag + '-last.png.b64', (await render(1, 'png', 0.92, pages.at(-1))).split(',')[1]);
        const pdf = await makePdf(); rec.pdfBytes = pdf.length;
        await out(tag + '.pdf.b64', b64(pdf));
        // Undo and redo: move the first thing, undo puts it back, redo moves it again.
        const first = board.getObjects()[0], left = first.left;
        first.set('left', left + 60); first.setCoords(); commitDesign(); await wait(600);
        $('#create-undo').click(); await wait(800); const undone = board.getObjects()[0].left;
        $('#create-redo').click(); await wait(800); const redone = board.getObjects()[0].left;
        rec.undo = [left, undone, redone];
      } catch (e) { rec.threw = String(e && e.stack || e).slice(0, 400); }
      log.push(rec);
    }
    document.querySelector('#create-rail [data-drawer="classroom"]').click(); await wait(500);
    $('#sheet-done').scrollIntoView({ block: 'end' }); await wait(500);
  } catch (e) { log.push({ threw: String(e && e.stack || e).slice(0, 400) }); }
  await out('log.json', { version: await invoke('app_version').catch(() => '?'), ua: navigator.userAgent.slice(-40), log });
})();
