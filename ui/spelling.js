// Check spelling, in File and in the Text drawer: every text box on every page is read against a US English word
// list (words-en-us.txt, made from SCOWL's lists up to size 60 and kept in their order, commonest first; its licence is
// LICENSES/scowl-word-list.txt). A word it doesn't know is shown with a few close words to change it to; she can also skip
// it or add it to her own words, which are kept with her settings. Names in My lists are never questioned.
// Needs create.js, doctools.js (pageTexts, objectAt, replaceIn) and classroom.js.

let spellWords = null; // word → how common it is (its line in the list)
// Everyday classroom words the list lacks.
const SPELL_EXTRA = ['ok', 'playdough', 'naptime', 'storytime', 'cubby', 'cubbies', 'preschooler', 'preschoolers', 'pre-K', 'Wi-Fi', 'wi-fi', 'playdate', 'playdates', 'screentime', 'lunchbox', 'lunchboxes'];
// Never offered as a close word (still accepted if she types them): this is a classroom tool.
const SPELL_RUDE = /^(?:cum|cumm|fuck|shit|shitt|cunt|piss|cock|dick|tit|twat|wank|slut|whore|arse|ass|bitch|bastard|crap|crapp|turd|fart|damn|hell|sex|porn|rape|rap|homo|fag|dyke|nazi)(?:s|es|ed|ing|er|ers|y)?$/i;
async function spellReady() {
  if (spellWords) return spellWords;
  const response = await fetch('words-en-us.txt');
  if (!response.ok) throw Error('the word list is missing');
  const words = new Map();
  (await response.text()).split('\n').forEach((w, i) => { if (w) words.set(w, i); });
  for (const w of SPELL_EXTRA) if (!words.has(w)) words.set(w, 50000);
  return spellWords = words;
}

// A word as it is looked up: straight apostrophes, no 's or ' on the end.
const spellKey = word => word.replace(/’/g, "'").replace(/'s$|'$/i, '').replace(/^'+/, '');
const spellTitle = w => w[0].toUpperCase() + w.slice(1);
// Known as written, or as Cat or CAT for "cat" (but not monday for "Monday"); `mine` is her own words, in small letters.
function spellHas(w, mine) {
  const lower = w.toLowerCase();
  if (mine.has(lower) || spellWords.has(w)) return true;
  if (w === lower) return false;
  if (w === spellTitle(lower)) return spellWords.has(lower);
  return w === w.toUpperCase() && (spellWords.has(lower) || spellWords.has(spellTitle(lower)));
}
function spellKnown(word, mine) {
  const w = spellKey(word);
  if (w.length < 2 || /\p{N}/u.test(w) || spellHas(w, mine)) return true; // single letters and 3rd, A4 are left alone
  return w.includes('-') && w.split('-').every(part => part.length < 2 || spellHas(part, mine));
}
// The words in a text box and where they are; links and e-mail addresses are left out.
function spellTokens(text) {
  const out = [];
  for (const chunk of text.matchAll(/\S+/g)) {
    if (/@|:\/\/|^www\.|\p{L}\.\p{L}{2,4}(\/|$)/u.test(chunk[0])) continue;
    for (const m of chunk[0].matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
      const word = m[0].replace(/['’-]+$/, '');
      out.push({ start: chunk.index + m.index, end: chunk.index + m.index + word.length, word });
    }
  }
  return out;
}
// Up to five known words one or two slips away (a letter dropped, added, changed or two swapped), swaps first, then the
// closest and commonest, written with the capitals the word had.
function spellSuggest(word) {
  const key = spellKey(word), lower = key.toLowerCase(), found = new Map(), letters = "abcdefghijklmnopqrstuvwxyz'";
  const edits = w => {
    const out = [];
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) out.push(a + b.slice(1));
      if (b.length > 1) out.push(a + b[1] + b[0] + b.slice(2));
      for (const c of letters) { if (b) out.push(a + c + b.slice(1)); out.push(a + c + b); }
    }
    return out;
  };
  const take = (w, cost) => { if (!w) return; for (const form of [w, spellTitle(w)]) if (spellWords.has(form) && !found.has(form)) found.set(form, cost * 1e6 + spellWords.get(form)); };
  take(lower, -1); // only its capital was wrong: monday
  for (let i = 0; i + 1 < lower.length; i++) take(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2), -0.5); // two letters swapped is the likeliest slip
  const first = edits(lower);
  for (const w of first) take(w, 0);
  if (found.size < 3 && lower.length <= 12) for (const e of first) for (const w of edits(e)) take(w, 1);
  const caps = key.length > 1 && key === key.toUpperCase(), titled = key[0] !== key[0].toLowerCase();
  return [...new Set([...found].sort((a, b) => a[1] - b[1]).map(([w]) => caps ? w.toUpperCase() : titled ? spellTitle(w) : w))].filter(w => w !== key && !SPELL_RUDE.test(w)).slice(0, 5);
}

// ---- The panel ----
const spell = { hits: [], skipped: new Set() };
// Her own words and every word in My lists (the children's names), in small letters.
function spellMine() {
  const mine = new Set(settings.words || []);
  if (typeof classLists !== 'undefined') for (const c of classLists.values()) for (const row of toRows(c)) for (const cell of row) for (const t of spellTokens(cell || '')) mine.add(spellKey(t.word).toLowerCase());
  return mine;
}
// Every word to check: which page, which text box (by its place in the page) and where in its words.
function spellScan() {
  const mine = spellMine(), hits = [];
  allPages().forEach((page, p) => pageTexts(page).forEach(({ path, text }) => {
    for (const t of spellTokens(text)) if (!spell.skipped.has(spellKey(t.word).toLowerCase()) && !spellKnown(t.word, mine)) hits.push({ p, path, text, ...t });
  }));
  return spell.hits = hits;
}
// Shows the first word to check: its page, its text box selected and the word highlighted, with what to do about it.
async function spellShow() {
  const hits = spellScan(), hit = hits[0], kinds = new Set(hits.map(h => spellKey(h.word).toLowerCase())).size;
  $('#spell-actions').hidden = !hit;
  $('#spell-status').textContent = hit ? `${kinds} word${kinds === 1 ? '' : 's'} to check` : 'No spelling mistakes found.';
  paintSpellMine();
  if (!hit) return;
  $('#spell-word').textContent = hit.word;
  $('#spell-context').textContent = (hit.start > 24 ? '…' : '') + hit.text.slice(Math.max(0, hit.start - 24), hit.end + 24).replace(/\s+/g, ' ') + (hit.end + 24 < hit.text.length ? '…' : '');
  const ideas = spellSuggest(hit.word);
  $('#spell-ideas-label').textContent = ideas.length ? 'Change it to' : 'No close words found. Click the word on the page to fix it by hand.';
  $('#spell-ideas').replaceChildren(...ideas.map(w => Object.assign(document.createElement('button'), { type: 'button', textContent: w, onclick: () => spellChange(w) })));
  if (hit.p !== pageAt) await showPage(hit.p);
  const o = objectAt(hit.path);
  if (!o) return;
  const top = o.group ? o.group : o; // a text inside a group is shown by selecting the group
  board.setActiveObject(top);
  if (top === o && o.enterEditing) { o.enterEditing(); o.selectionStart = hit.start; o.selectionEnd = hit.end; o.hiddenTextarea?.blur(); }
  board.requestRenderAll(); paintPanel();
}
// Changes the word being shown, keeping the styles of the words around it and any 's on its end.
async function spellChange(to) {
  const hit = spell.hits[0];
  if (!hit) return;
  if (hit.p !== pageAt) await showPage(hit.p);
  const o = objectAt(hit.path), key = spellKey(hit.word);
  if (o) { replaceIn(o, hit.start, hit.start + key.length, to); o.group?.setDirty?.(true); board.requestRenderAll(); commitDesign(); }
  await spellShow();
}
function paintSpellMine() {
  const words = settings.words || [];
  $('#spell-mine').hidden = !words.length;
  $('#spell-mine-list').replaceChildren(...words.map(w => Object.assign(document.createElement('button'), { type: 'button', textContent: w + ' ×', title: `Take “${w}” out of my words`,
    onclick: () => { settings.words = settings.words.filter(x => x !== w); saveSettings(); spellShow(); } })));
}
$('#spell-skip').onclick = () => { const hit = spell.hits[0]; if (hit) spell.skipped.add(spellKey(hit.word).toLowerCase()); spellShow(); };
$('#spell-add').onclick = () => {
  const hit = spell.hits[0];
  if (hit) { settings.words = [...new Set([...(settings.words || []), spellKey(hit.word).toLowerCase()])].slice(-2000); saveSettings(); }
  spellShow();
};
async function openSpelling(anchor) {
  if (openPop?.el === $('#pop-spell')) return closeMenus();
  togglePop(anchor);
  // Under the top bar whichever button opened it, so the whole window fits (File's button sits low in its menu).
  const pop = $('#pop-spell'), top = $('#file-open').getBoundingClientRect().bottom;
  pop.style.top = top - $('#create').getBoundingClientRect().top + 6 + 'px'; pop.style.maxHeight = Math.max(160, innerHeight - top - 14) + 'px';
  $('#spell-actions').hidden = true; $('#spell-status').textContent = 'Reading the pages…';
  try { await spellReady(); await spellShow(); } catch (error) { $('#spell-status').textContent = 'Could not check the spelling: ' + (error.message || error); }
}
for (const id of ['#file-spell', '#text-spell']) $(id).onclick = () => openSpelling($(id));
