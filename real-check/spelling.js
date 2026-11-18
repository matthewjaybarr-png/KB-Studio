// Real-window scenario for Check spelling: a page with slips on it, the window opened from File, a close word clicked,
// a word added to My words, then the window left open on the next word for the screenshot.
(async () => {
  const out = (n, t) => invoke('test_out', { name: n, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) });
  const log = [], wait = ms => new Promise(r => setTimeout(r, ms));
  window.addEventListener('error', e => log.push({ error: String(e.message), at: (e.filename || '').split('/').pop() + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', e => log.push({ rejection: String(e.reason && e.reason.stack || e.reason).slice(0, 400) }));
  const state = () => ({ status: $('#spell-status').textContent, word: $('#spell-word').textContent, ideas: [...document.querySelectorAll('#spell-ideas button')].map(b => b.textContent), context: $('#spell-context').textContent, shown: !$('#pop-spell').hidden });
  try {
    await newDesign(); await wait(1500); if (!$('#create-whatsnew').hidden) $('#create-whatsnew button').click();
    const a = addText('heading'); a.exitEditing(); a.set({ text: 'Our clas newsletter' });
    const b = addText('body'); b.exitEditing(); b.set({ text: 'Dear familys, on wendesday we are makeing playdough. Please send a snack becuase Zorblat is comming!', top: 420, width: 520 }); b.initDimensions();
    commitDesign(); await wait(800);
    const t0 = performance.now();
    $('#file-open').click(); await wait(200); $('#file-spell').click();
    for (let t = 0; t < 80 && $('#spell-actions').hidden && !/No spelling|Could not/.test($('#spell-status').textContent); t++) await wait(100);
    log.push({ step: 'open', ms: Math.round(performance.now() - t0), words: spellWords && spellWords.size, ...state() });
    for (let n = 0; n < 12 && spell.hits[0]; n++) {
      const word = spell.hits[0].word;
      if (word === 'Zorblat') { $('#spell-add').click(); await wait(700); log.push({ step: 'add ' + word, mine: settings.words, ...state() }); continue; }
      if (word === 'comming') break; // left showing for the screenshot
      const idea = document.querySelector('#spell-ideas button');
      if (idea) idea.click(); else $('#spell-skip').click();
      await wait(700); log.push({ step: (idea ? 'change ' : 'skip ') + word, ...state() });
    }
    log.push({ texts: board.getObjects().map(o => o.text), saved: $('#create-saved').textContent });
    $('#create-undo').click(); await wait(700); log.push({ afterUndo: board.getObjects().map(o => o.text) });
    $('#create-redo').click(); await wait(700);
    await out('page.png.b64', (await render(1, 'png', 0.92, allPages()[0])).split(',')[1]);
  } catch (e) { log.push({ threw: String(e && e.stack || e).slice(0, 400) }); }
  await out('log.json', { version: await invoke('app_version').catch(() => '?'), log });
})();
