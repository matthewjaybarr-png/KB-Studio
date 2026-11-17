// Classroom games and plans, in Classroom's Puzzles and worksheets: bingo cards (a different one for each child, with
// calling cards to cut apart), memory game cards, a seating plan from a class list, telling the time and missing numbers. They are Puzzles and worksheets kinds, made of ordinary text, shapes and the app's clip art.
// Needs create.js, worksheets.js, preschool.js and posters.js.

const plainLabel = name => picLabel(name).replace(/ \(.*\)$/, '');
// Words as big as fit a box, centred in it: no word wider than the box (a text box grows to fit its longest word),
// none broken over two lines, and the lines no taller than the box.
function fitText(text, x, y, w, h, o = {}) {
  const words = text.split(/\s+/).length;
  let size = o.fontSize || h * 0.56;
  const t = T(text, x, y, { width: w, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#3a3a3a', kbName: 'Square words', ...o, fontSize: size });
  while ((t.width > w || t.textLines.length > words || t.height > h) && size > 8) { size *= 0.92; t.set({ fontSize: size, width: w }); t.initDimensions(); }
  t.set({ left: x + (w - t.width) / 2, top: y + (h - t.height) / 2 });
  return t;
}
// One thing in a square `s` wide at (x, y): a picture (with its word under it if `label`), or words as big as fit
// (`item.size` caps them, as a share of the square).
async function squareItem(item, x, y, s, label) {
  if (item.pic && !label) return [await pic(item.pic, x + s / 2, y + s / 2, s * 0.76)];
  if (!item.pic) return [fitText(item.text, x + 4, y, s - 8, s, item.size ? { fontSize: s * item.size } : {})];
  return [await pic(item.pic, x + s / 2, y + s * 0.4, s * 0.58), fitText(item.text, x + 4, y + s * 0.72, s - 8, s * 0.26, { fontSize: s * 0.15 })];
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

// ---- Seating plan: a desk for each name, in rows, groups, a horseshoe or a circle, facing the front ----
// "Smith, Ava" turns round; `first` keeps only the first name. Forty names at most.
const seatNames = (words, first) => words.split(/\r?\n/).map(w => w.trim().replace(/\s+/g, ' ').replace(/^([^,]+),\s*(.+)$/, '$2 $1')).filter(Boolean).map(n => first ? n.split(' ')[0] : n).slice(0, 40);
// Where each of `n` desks goes inside a 720 × 770 area: [x, y, w, h, group], group picking its colour.
function seatSpots(n, layout) {
  const W = 720, H = 770, spots = [];
  if (layout === 'circle') {
    const w = Math.min(130, 2000 / n - 8), h = Math.min(60, Math.max(30, w * 0.6)); // narrower than the gap between neighbours at the top
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + 2 * Math.PI * i / n; spots.push([W / 2 + Math.cos(a) * (W / 2 - w / 2) - w / 2, H / 2 + Math.sin(a) * (H / 2 - h / 2) - h / 2, w, h, 0]); }
  } else if (layout === 'horseshoe') {
    const side = Math.round(n / 3), across = n - 2 * side, px = W / Math.max(across, 3), py = Math.min(110, H / (side + 1)), w = Math.min(px - 10, 150), h = Math.min(py - 10, 80);
    for (let i = 0; i < side; i++) spots.push([0, i * py, w, h, 0]);
    for (let i = 0; i < across; i++) spots.push([i * px + (px - 10 - w) / 2, side * py, w, h, 0]);
    for (let i = side - 1; i >= 0; i--) spots.push([W - w, i * py, w, h, 0]);
  } else if (layout === 'rows') {
    const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(n * 0.9)))), rows = Math.ceil(n / cols), px = W / cols, py = Math.min(120, H / rows);
    for (let i = 0; i < n; i++) spots.push([(i % cols) * px + 8, Math.floor(i / cols) * py, px - 16, Math.min(py - 16, 84), 0]);
  } else { // groups of four (2 × 2 desks) or six (3 × 2), tables two or three across
    const per = layout === 'groups6' ? 6 : 4, across = per / 2, tables = Math.ceil(n / per), tcols = per === 4 && tables > 4 ? 3 : 2, trows = Math.ceil(tables / tcols);
    const px = W / tcols, py = Math.min(250, H / trows), w = (px - 36) / across, h = Math.min(84, (py - 36) / 2);
    for (let i = 0; i < n; i++) { const t = Math.floor(i / per), k = i % per; spots.push([(t % tcols) * px + 18 + (k % across) * w, Math.floor(t / tcols) * py + Math.floor(k / across) * h, w, h, t]); }
  }
  return spots;
}
// Each desk is its box and name grouped, so it drags as one thing.
function seatingPage(title, names, layout) {
  const parts = [T(title, 48, 36, { width: 720, fontSize: 44, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
    new kbe.Group([R(208, 112, 400, 44, { rx: 10, ry: 10, fill: '#3a3a3a', stroke: '#3a3a3a', kbName: 'Board' }), fitText('Front of the room', 218, 112, 380, 44, { fontSize: 22, fill: '#ffffff', fontWeight: 'normal' })], { kbName: 'Front of the room' })];
  for (const [i, [x, y, w, h, group]] of seatSpots(names.length, layout).entries()) {
    const [fill, edge] = CARD_COLOURS[group % CARD_COLOURS.length];
    parts.push(new kbe.Group([R(48 + x, 200 + y, w, h, { rx: 8, ry: 8, fill, stroke: edge, strokeWidth: 2.5, kbName: 'Desk' }), fitText(names[i], 48 + x + 5, 200 + y + 3, w - 10, h - 6, { fontSize: Math.min(24, h * 0.42), kbName: 'Name' })], { kbName: 'Desk: ' + names[i] }));
  }
  return toPage(parts);
}

// ---- Telling the time: six clock faces to read, or six times to draw the hands for ----
const CLOCK_STEPS = { hour: [0], half: [0, 30], quarter: [0, 15, 30, 45], five: Array.from({ length: 12 }, (_, i) => i * 5) };
// `n` different times as [hour, minutes].
function clockTimes(level, rand, n = 6) {
  const all = [];
  for (let h = 1; h <= 12; h++) for (const m of CLOCK_STEPS[level] || CLOCK_STEPS.hour) all.push([h, m]);
  return shuffled(all, rand).slice(0, n);
}
const clockText = ([h, m]) => h + ':' + String(m).padStart(2, '0');
// Degrees clockwise from 12 for the hour hand (it creeps on as the minutes pass) and the minute hand.
const clockAngles = ([h, m]) => [(h % 12 + m / 60) * 30, m * 6];
const clockPoint = (cx, cy, deg, len) => [cx + Math.sin(deg * Math.PI / 180) * len, cy - Math.cos(deg * Math.PI / 180) * len];
// The face as one group, and the two hands (if wanted) as their own lines so they can be turned or recoloured.
function clockParts(cx, cy, r, time, hands, colour = '#333333') {
  const ticks = Array.from({ length: 60 }, (_, i) => { const [x1, y1] = clockPoint(cx, cy, i * 6, r * (i % 5 ? 0.95 : 0.9)), [x2, y2] = clockPoint(cx, cy, i * 6, r); return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`; }).join(' ');
  const size = r * 0.24, face = [new kbe.Circle({ left: cx - r, top: cy - r, radius: r, fill: '#ffffff', stroke: '#333333', strokeWidth: 4, kbName: 'Face' }),
    new kbe.Path(ticks, { fill: '', stroke: '#333333', strokeWidth: 2, kbName: 'Minute marks' })];
  for (let n = 1; n <= 12; n++) { const [x, y] = clockPoint(cx, cy, n * 30, r * 0.74); face.push(T(String(n), x - size, y - size * 0.58, { width: size * 2, fontSize: size, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Number' })); }
  const parts = [new kbe.Group(face, { kbName: 'Clock' })];
  if (hands) {
    const [hour, minute] = clockAngles(time), hand = (deg, len, width, kbName) => { const [x, y] = clockPoint(cx, cy, deg, len); return new kbe.Path(`M${cx} ${cy} L${x.toFixed(1)} ${y.toFixed(1)}`, { fill: '', stroke: colour, strokeWidth: width, strokeLineCap: 'round', kbName }); };
    parts.push(hand(hour, r * 0.45, 8, 'Hour hand'), hand(minute, r * 0.68, 5, 'Minute hand'));
  }
  parts.push(new kbe.Circle({ left: cx - 7, top: cy - 7, radius: 7, fill: colour, stroke: colour, strokeWidth: 0, kbName: 'Middle' }));
  return parts;
}
function clockPage(title, times, mode, answers) {
  const parts = [...preHeader(answers ? keyTitle(title) : title), T(mode === 'draw' ? 'Draw the hands to show the time.' : 'Write the time under each clock.', 48, 150, { width: 720, fontSize: 20, textAlign: 'center', fill: '#666666', kbName: 'Instructions' })];
  for (const [i, time] of times.entries()) {
    const cx = 228 + (i % 2) * 360, cy = 300 + Math.floor(i / 2) * 272, r = 100, shown = mode === 'draw' || answers;
    parts.push(...clockParts(cx, cy, r, time, mode === 'read' || answers, answers && mode === 'draw' ? SHEET_PINK : '#333333'),
      T(shown ? clockText(time) : '____ : ____', cx - 120, cy + r + 10, { width: 240, fontSize: 34, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: answers && mode === 'read' ? SHEET_PINK : '#222222', kbName: answers && mode === 'read' ? 'Answer' : 'Time' }));
  }
  return toPage(parts);
}

// ---- Memory game: pairs of cards to cut apart, twelve to a page ----
// `pairs` pairs of card faces: the same picture twice, a big and a small letter, a number and that many dots, or a
// picture and its word.
function memoryPairs(what, pairs, rand) {
  if (what === 'numbers') return Array.from({ length: pairs }, (_, i) => [{ text: String(i + 1) }, { dots: i + 1 }]);
  if (what === 'letters') return shuffled(Object.keys(LETTER_PICS), rand).slice(0, pairs).sort().map(l => [{ text: l }, { text: l.toLowerCase() }]);
  return shuffled(BINGO_PICS, rand).slice(0, pairs).map(p => [{ pic: p }, what === 'words' ? { text: plainLabel(p), size: 0.24 } : { pic: p }]);
}
// `n` dots (12 at most) in rows, centred in a square.
function dotParts(n, x, y, s, colour) {
  const cols = n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : 4, rows = Math.ceil(n / cols), pitch = Math.min(s / cols, s / rows, s / 3), r = pitch * 0.36;
  return Array.from({ length: n }, (_, i) => { const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols); return new kbe.Circle({ left: x + s / 2 + (i % cols - (inRow - 1) / 2) * pitch - r, top: y + s / 2 + (row - (rows - 1) / 2) * pitch - r, radius: r, fill: colour, stroke: colour, strokeWidth: 0, kbName: 'Dot' }); });
}
async function memoryPages(title, pairs) {
  const cards = pairs.flatMap((pair, i) => pair.map(face => [face, i])), pages = [], w = 240, h = 228;
  for (let first = 0; first < cards.length; first += 12) {
    const parts = [T(title, 48, 28, { width: 720, fontSize: 36, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
      T('Cut the cards apart, turn them face down and find the pairs.', 48, 78, { width: 720, fontSize: 18, textAlign: 'center', fill: '#666666', kbName: 'Instructions' })];
    for (const [j, [face, pair]] of cards.slice(first, first + 12).entries()) {
      const x = 48 + (j % 3) * w, y = 116 + Math.floor(j / 3) * h, [fill, edge] = CARD_COLOURS[pair % CARD_COLOURS.length], s = h - 56;
      parts.push(R(x, y, w, h, { stroke: '#999999', strokeWidth: 1.5, strokeDashArray: [8, 6], kbName: 'Line to cut' }),
        R(x + 14, y + 14, w - 28, h - 28, { rx: 16, ry: 16, fill, stroke: edge, strokeWidth: 3, kbName: 'Card' }),
        ...(face.dots ? dotParts(face.dots, x + (w - s) / 2, y + 28, s, edge) : await squareItem(face, x + (w - s) / 2, y + 28, s, false)));
    }
    pages.push(toPage(parts));
  }
  return pages;
}

// ---- Missing numbers: a number grid with gaps to fill in ----
const MISSING_SHARE = { few: 0.25, half: 0.5, most: 0.75 };
// Which of 1 to `upto` are left out, in order; 1 always stays to start them off.
function missingNumbers(upto, share, rand) {
  return shuffled(Array.from({ length: upto - 1 }, (_, i) => i + 2), rand).slice(0, Math.round(upto * (MISSING_SHARE[share] || 0.5))).sort((a, b) => a - b);
}
function missingPage(title, upto, missing, answers) {
  const cols = upto <= 20 ? 5 : 10, cell = 720 / cols, gone = new Set(missing);
  const parts = [...preHeader(answers ? keyTitle(title) : title), T('Fill in the missing numbers.', 48, 150, { width: 720, fontSize: 20, textAlign: 'center', fill: '#666666', kbName: 'Instructions' })];
  for (let n = 1; n <= upto; n++) {
    const x = 48 + ((n - 1) % cols) * cell, y = 200 + Math.floor((n - 1) / cols) * cell, out = gone.has(n);
    parts.push(R(x, y, cell, cell, { fill: out ? '#ffffff' : '#ece4fb', stroke: '#9a86d6', strokeWidth: 2, kbName: out ? 'Empty square' : 'Square' }));
    if (!out || answers) parts.push(fitText(String(n), x + 4, y, cell - 8, cell, { fontSize: cell * 0.46, fill: out ? SHEET_PINK : '#3a3a3a', kbName: out ? 'Answer' : 'Number' }));
  }
  return toPage(parts);
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
    } },
  seating: { title: 'Seating plan', words: true, key: false, wordsLabel: 'Their names', hint: 'One name per line, up to 40. Pick your class list above to fill it in.', placeholder: 'Ava\nBen\nCharlie',
    async make(title, key, seed, words) {
      let names = seatNames(words, $('#sheet-seat-first').checked);
      if (names.length < 2) return { error: 'Type their names first, one per line, or pick your class list.' };
      if ($('#sheet-seat-order').value === 'mixed') names = shuffled(names, seededRandom(seed));
      return { pages: [seatingPage(title, names, $('#sheet-seat-layout').value)], note: `${names.length} desks. Drag a desk to move it; Ungroup it to change the name.` };
    } },
  clock: { title: 'Telling the time', words: false,
    async make(title, key, seed) {
      const times = clockTimes($('#sheet-clock-level').value, seededRandom(seed)), mode = $('#sheet-clock-mode').value;
      return { pages: [clockPage(title, times, mode, false), ...(key ? [clockPage(title, times, mode, true)] : [])] };
    } },
  memory: { title: 'Memory game', words: false, key: false,
    async make(title, key, seed) {
      const pairs = memoryPairs($('#sheet-memory-what').value, +$('#sheet-memory-pairs').value, seededRandom(seed));
      return { pages: await memoryPages(title, pairs), note: `${pairs.length} pairs to cut apart. Print on card so the pictures don't show through.` };
    } },
  missing: { title: 'Missing numbers', words: false,
    async make(title, key, seed) {
      const upto = +$('#sheet-missing-upto').value, missing = missingNumbers(upto, $('#sheet-missing-share').value, seededRandom(seed));
      return { pages: [missingPage(title, upto, missing, false), ...(key ? [missingPage(title, upto, missing, true)] : [])] };
    } }
});
const bingoWords = () => { $('#sheet-words-part').hidden = $('#sheet-bingo-what').value !== 'words'; };
$('#sheet-bingo-what').onchange = bingoWords;
$('#sheet-bingo').onclick = () => { openSheet('bingo'); bingoWords(); };
$('#sheet-seating').onclick = () => openSheet('seating');
$('#sheet-clock').onclick = () => openSheet('clock');
$('#sheet-memory').onclick = () => openSheet('memory');
$('#sheet-missing').onclick = () => openSheet('missing');
