// Classroom games, in Classroom's Puzzles and worksheets: bingo cards (a different one for each child, with calling
// cards to cut apart). They are Puzzles and worksheets kinds, made of ordinary text, shapes and the app's clip art.
// Needs create.js, worksheets.js, preschool.js and posters.js.

const plainLabel = name => picLabel(name).replace(/ \(.*\)$/, '');
// One thing in a square `s` wide at (x, y): a picture (with its word under it if `label`), or words as big as fit.
async function squareItem(item, x, y, s, label) {
  if (item.pic && !label) return [await pic(item.pic, x + s / 2, y + s / 2, s * 0.76)];
  const words = item.text.split(/\s+/).length, room = item.pic ? s * 0.26 : s;
  let size = item.pic ? s * 0.15 : s * 0.56;
  const t = T(item.text, x + 4, y, { width: s - 8, fontSize: size, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#3a3a3a', kbName: 'Square words' });
  // No word wider than the square (a text box grows to fit its longest word), and the lines no taller than their room.
  while ((t.width > s - 8 || t.textLines.length > words || t.height > room) && size > 8) { size *= 0.92; t.set({ fontSize: size, width: s - 8 }); t.initDimensions(); }
  t.set('top', item.pic ? y + s * 0.72 + (room - t.height) / 2 : y + (s - t.height) / 2);
  return item.pic ? [await pic(item.pic, x + s / 2, y + s * 0.4, s * 0.58), t] : [t];
}

// ---- Bingo ----
const BINGO_PICS = [...new Set(MATCH_PICS.concat(COUNT_PICS, PATTERN_PICS))];
// What can be called: pictures, letters, numbers, or her own words (one a line, no repeats, 60 at most).
function bingoPool(what, words = '') {
  if (what === 'pictures') return BINGO_PICS.map(p => ({ pic: p, text: plainLabel(p) }));
  if (what === 'capitals' || what === 'small') return Object.keys(LETTER_PICS).map(l => ({ text: what === 'small' ? l.toLowerCase() : l }));
  if (what === 'n20' || what === 'n50') return Array.from({ length: what === 'n20' ? 20 : 50 }, (_, i) => ({ text: String(i + 1) }));
  const seen = new Set();
  return words.split(/\r?\n/).map(w => w.trim().slice(0, 30)).filter(w => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase())).slice(0, 60).map(text => ({ text }));
}
const bingoNeeds = size => size * size - (size === 5 ? 1 : 0);
// `count` cards of size × size squares, no two the same; a 5 × 5 card's middle square is free (null).
function bingoCards(pool, size, count, rand) {
  const need = bingoNeeds(size), cards = [], seen = new Set();
  if (pool.length < need) return null;
  for (let tries = 0; cards.length < count && tries < count * 20; tries++) {
    const cells = shuffled(pool, rand).slice(0, need), key = cells.map(c => c.text).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    if (size === 5) cells.splice(12, 0, null);
    cards.push(cells);
  }
  return cards;
}
async function bingoPage(title, cells, size, n) {
  const side = 672, left = (816 - side) / 2, top = 200, cell = side / size, [fill, edge] = CARD_COLOURS[n % CARD_COLOURS.length];
  const parts = [T(title, 48, 56, { width: 720, fontSize: 72, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: edge, kbName: 'Title' }),
    R(left - 14, top - 14, side + 28, side + 28, { rx: 24, ry: 24, fill, stroke: edge, strokeWidth: 4, kbName: 'Card' })];
  for (const [i, c] of cells.entries()) {
    const x = left + (i % size) * cell + 4, y = top + Math.floor(i / size) * cell + 4;
    parts.push(R(x, y, cell - 8, cell - 8, { rx: 10, ry: 10, fill: '#ffffff', stroke: edge, strokeWidth: 2, kbName: c ? 'Square' : 'Free square' }),
      ...await squareItem(c || { pic: 'star', text: 'FREE' }, x, y, cell - 8, !c));
  }
  parts.push(T('Card ' + (n + 1), 48, top + side + 40, { width: 720, fontSize: 18, textAlign: 'center', fill: '#888888', kbName: 'Card number' }));
  return toPage(parts);
}
// Everything that can be called, thirty to a page, with dashed edges to cut along.
async function callingPages(pool) {
  const pages = [];
  for (let first = 0; first < pool.length; first += 30) {
    const parts = [T('Calling cards', 48, 36, { width: 720, fontSize: 40, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
      T('Cut them apart, mix them up, then pull one out and call it.', 48, 92, { width: 720, fontSize: 20, textAlign: 'center', fill: '#666666', kbName: 'Instructions' })];
    for (const [i, item] of pool.slice(first, first + 30).entries()) {
      const x = 48 + (i % 5) * 144, y = 140 + Math.floor(i / 5) * 148;
      parts.push(R(x, y, 144, 148, { stroke: '#999999', strokeWidth: 1.5, strokeDashArray: [8, 6], kbName: 'Line to cut' }), ...await squareItem(item, x + 6, y + 8, 132, true));
    }
    pages.push(toPage(parts));
  }
  return pages;
}

Object.assign(SHEET_KINDS, {
  bingo: { title: 'Bingo', words: false, key: false, hint: 'One word per line, up to 60. Pick one of your lists above to fill it in.',
    async make(title, key, seed, words) {
      const what = $('#sheet-bingo-what').value, size = +$('#sheet-bingo-size').value, pool = bingoPool(what, words), need = bingoNeeds(size);
      const cards = bingoCards(pool, size, +$('#sheet-bingo-count').value, seededRandom(seed));
      if (!cards) return { error: what === 'words' ? `A ${size} × ${size} card needs at least ${need} different words, and there ${pool.length === 1 ? 'is' : 'are'} ${pool.length}. Add more words or pick fewer squares.` : `A ${size} × ${size} card needs ${need} different squares, and there are only ${pool.length} of these. Pick fewer squares.` };
      const pages = [];
      for (const [n, cells] of cards.entries()) pages.push(await bingoPage(title, cells, size, n));
      pages.push(...await callingPages(pool));
      return { pages, note: `${cards.length} cards, each one different, then the calling cards to cut apart.` + (pool.length === need ? ' Every card has the same squares in a different order, so everyone finishes together: add more words for a real race.' : '') };
    } }
});
const bingoWords = () => { $('#sheet-words-part').hidden = $('#sheet-bingo-what').value !== 'words'; };
$('#sheet-bingo-what').onchange = bingoWords;
$('#sheet-bingo').onclick = () => { openSheet('bingo'); bingoWords(); };
