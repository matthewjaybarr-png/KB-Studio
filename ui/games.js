// Classroom games and plans, in Classroom's Puzzles and worksheets: bingo cards (a different one for each child, with
// calling cards to cut apart), memory game cards, a seating plan from a class list, telling the time, missing numbers, a word scramble, picture sudoku and feelings wall cards. They are Puzzles and worksheets kinds, made of ordinary text, shapes and the app's clip art.
// Needs create.js, worksheets.js, preschool.js and posters.js.

const plainLabel = name => picLabel(name).replace(/ \(.*\)$/, '');
// Words as big as fit a box, centred in it: no word wider than the box (a text box grows to fit its longest word),
// none broken over two lines, and the lines no taller than the box.
function fitInto(t, x, y, w, h, size) {
  const words = t.text.split(/\s+/).length;
  t.set({ fontSize: size, width: w }); t.initDimensions();
  while ((t.width > w || t.textLines.length > words || t.height > h) && size > 8) { size *= 0.92; t.set({ fontSize: size, width: w }); t.initDimensions(); }
  t.set({ left: x + (w - t.width) / 2, top: y + (h - t.height) / 2 });
  return t;
}
function fitText(text, x, y, w, h, o = {}) {
  const size = o.fontSize || h * 0.56;
  return fitInto(T(text, x, y, { width: w, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#3a3a3a', kbName: 'Square words', ...o, fontSize: size }), x, y, w, h, size);
}
// ---- Her own photos in the games: chosen in the window, each cut square and made small once ----
let sheetPhotos = [];
const photoUrls = new Map();
const photoName = file => file.name.replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 30) || 'photo';
// The middle square of a photo, 360 pixels across: plenty for a card, and small enough for thirty cards of them.
async function photoUrl(file) {
  if (photoUrls.has(file)) return photoUrls.get(file);
  const bitmap = await createImageBitmap(file), side = Math.min(bitmap.width, bitmap.height), out = Object.assign(document.createElement('canvas'), { width: 360, height: 360 });
  out.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 360, 360);
  bitmap.close?.();
  photoUrls.set(file, out.toDataURL('image/jpeg', 0.85));
  return photoUrls.get(file);
}
const photoItems = () => sheetPhotos.map(file => ({ photo: file, text: photoName(file) }));
// A clip-art picture or one of her photos, `size` square, centred on (cx, cy).
async function itemPic(item, cx, cy, size) {
  if (!item.photo) return pic(item.pic, cx, cy, size);
  const image = await kbe.FabricImage.fromURL(await photoUrl(item.photo));
  image.set({ left: cx - size / 2, top: cy - size / 2, scaleX: size / image.width, scaleY: size / image.height, kbName: 'Photo ' + item.text });
  return image;
}
function paintSheetPhotos() {
  const what = sheet.kind === 'bingo' ? $('#sheet-bingo-what').value : sheet.kind === 'memory' ? $('#sheet-memory-what').value : '';
  $('#sheet-photos-row').hidden = $('#sheet-photos-hint').hidden = !what.startsWith('photo');
  $('#sheet-photos-count').textContent = sheetPhotos.length ? `${sheetPhotos.length} photo${sheetPhotos.length === 1 ? '' : 's'} chosen` : 'None chosen yet';
}
$('#sheet-photos-add').onclick = () => $('#sheet-photos-file').click();
$('#sheet-photos-file').onchange = e => { sheetPhotos = [...e.target.files].filter(f => f.type.startsWith('image/') || pictureType(f.name)).slice(0, 60); e.target.value = ''; paintSheetPhotos(); };

// One thing in a square `s` wide at (x, y): a picture or photo (with its word under it if `label`), or words as big
// as fit (`item.size` caps them, as a share of the square).
async function squareItem(item, x, y, s, label) {
  const art = item.pic || item.photo;
  if (art && !label) return [await itemPic(item, x + s / 2, y + s / 2, s * (item.photo ? 0.9 : 0.76))];
  if (!art) return [fitText(item.text, x + 4, y, s - 8, s, item.size ? { fontSize: s * item.size } : {})];
  return [await itemPic(item, x + s / 2, y + s * 0.4, s * (item.photo ? 0.66 : 0.58)), fitText(item.text, x + 4, y + s * 0.74, s - 8, s * 0.24, { fontSize: s * 0.15 })];
}

// ---- Bingo ----
const BINGO_PICS = [...new Set(MATCH_PICS.concat(COUNT_PICS, PATTERN_PICS))];
// What can be called: pictures, her photos, letters, numbers, or her own words (one a line, no repeats, 60 at most).
function bingoPool(what, words = '') {
  if (what === 'pictures') return BINGO_PICS.map(p => ({ pic: p, text: plainLabel(p) }));
  if (what === 'photos') return photoItems();
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
// Each desk is its box and name grouped, so it drags as one thing; Change name in the toolbar retypes who sits there.
KEEP.push('kbDesk');
const deskSize = h => Math.min(24, h * 0.42);
function renameDesk(desk, name) {
  const box = desk.getObjects().find(o => o.type === 'rect'), t = desk.getObjects().find(o => o.type === 'textbox');
  t.set('text', name);
  fitInto(t, box.left + 5, box.top + 3, box.width - 10, box.height - 6, deskSize(box.height));
  desk.set({ kbName: 'Desk: ' + name, dirty: true });
}
$('#desk-rename').onclick = async () => {
  const desk = board.getActiveObject();
  if (!desk?.kbDesk) return;
  const name = await askName('Who sits here?', desk.kbName.replace(/^Desk: /, ''));
  if (!name) return;
  renameDesk(desk, name); board.requestRenderAll(); commitDesign();
};
function seatingPage(title, names, layout) {
  const parts = [T(title, 48, 36, { width: 720, fontSize: 44, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
    new kbe.Group([R(208, 112, 400, 44, { rx: 10, ry: 10, fill: '#3a3a3a', stroke: '#3a3a3a', kbName: 'Board' }), fitText('Front of the room', 218, 112, 380, 44, { fontSize: 22, fill: '#ffffff', fontWeight: 'normal' })], { kbName: 'Front of the room' })];
  for (const [i, [x, y, w, h, group]] of seatSpots(names.length, layout).entries()) {
    const [fill, edge] = CARD_COLOURS[group % CARD_COLOURS.length];
    parts.push(new kbe.Group([R(48 + x, 200 + y, w, h, { rx: 8, ry: 8, fill, stroke: edge, strokeWidth: 2.5, kbName: 'Desk' }), fitText(names[i], 48 + x + 5, 200 + y + 3, w - 10, h - 6, { fontSize: deskSize(h), kbName: 'Name' })], { kbName: 'Desk: ' + names[i], kbDesk: true }));
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
  if (what.startsWith('photo')) return shuffled(photoItems(), rand).slice(0, pairs).map(item => [item, what === 'photo-names' ? { text: item.text, size: 0.24 } : item]);
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

// ---- Word scramble: her words with their letters mixed up, a line to write each on, and a word bank if wanted ----
// The words to use: letters only, small, no repeats, twelve at most.
const scrambleList = words => [...new Set(words.split(/\r?\n/).map(w => w.toLowerCase().replace(/[^\p{L}]/gu, '')).filter(w => w.length >= 2))].slice(0, 12);
// The word's letters in another order (the same order only when every letter is the same).
function scrambled(word, rand) {
  for (let tries = 0; tries < 20; tries++) { const mixed = shuffled([...word], rand).join(''); if (mixed !== word) return mixed; }
  return word;
}
function scramblePage(title, words, mixed, bank, answers) {
  const parts = [...preHeader(answers ? keyTitle(title) : title), T('Put the letters in the right order and write the word.', 48, 150, { width: 720, fontSize: 20, textAlign: 'center', fill: '#666666', kbName: 'Instructions' })];
  const pitch = Math.min(72, (bank ? 660 : 820) / words.length), size = Math.min(34, pitch * 0.5);
  for (const [i, word] of words.entries()) {
    const y = 195 + i * pitch;
    // Non-breaking spaces between the letters keep them on one line, shrunk to fit if the word is long.
    parts.push(fitText(`${i + 1}.`, 56, y, 50, pitch, { fontSize: size * 0.7, fontWeight: 'normal', fill: '#666666', kbName: 'Number' }),
      fitText([...mixed[i]].join(' '), 116, y, 320, pitch, { fontSize: size, textAlign: 'left', kbName: 'Mixed-up word' }),
      new kbe.Path(`M460 ${y + pitch * 0.78} L750 ${y + pitch * 0.78}`, { fill: '', stroke: '#333333', strokeWidth: 2, kbName: 'Line to write on' }));
    if (answers) parts.push(fitText(word, 460, y, 290, pitch * 0.78, { fontSize: size, fill: SHEET_PINK, kbName: 'Answer' }));
  }
  if (bank) parts.push(R(48, 880, 720, 136, { rx: 16, ry: 16, fill: '#ece4fb', stroke: '#9a86d6', strokeWidth: 2.5, kbName: 'Word bank box' }),
    T('Word bank', 48, 890, { width: 720, fontSize: 18, textAlign: 'center', fill: '#666666', kbName: 'Word bank title' }),
    fitText(bank.join('    '), 64, 918, 688, 90, { fontSize: 26, fontWeight: 'normal', kbName: 'Word bank' }));
  return toPage(parts);
}

// ---- Picture sudoku: a 4 × 4 grid where each row, column and box of four has each picture once ----
const SUDOKU_BASE = [0, 1, 2, 3, 2, 3, 0, 1, 1, 0, 3, 2, 3, 2, 1, 0], SUDOKU_GAPS = { easy: 5, medium: 7, hard: 9 };
// How many ways a grid (-1 for an empty square) can be finished, counting no further than `limit`.
function sudokuSolutions(g, limit = 2) {
  const i = g.indexOf(-1);
  if (i < 0) return 1;
  const r = i >> 2, c = i & 3;
  let n = 0;
  for (let v = 0; v < 4 && n < limit; v++) {
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) ok = g[r * 4 + k] !== v && g[k * 4 + c] !== v && g[((r >> 1) * 2 + (k >> 1)) * 4 + (c >> 1) * 2 + (k & 1)] !== v;
    if (ok) { g[i] = v; n += sudokuSolutions(g, limit - n); g[i] = -1; }
  }
  return n;
}
// A finished grid (the base one with its rows, columns and pictures mixed) and the puzzle: squares taken out one at
// a time, only while there is still just one way to finish it.
function sudoku(gaps, rand) {
  const sym = shuffled([0, 1, 2, 3], rand), order = () => { const a = shuffled([0, 1], rand), b = shuffled([2, 3], rand); return rand() < 0.5 ? [...a, ...b] : [...b, ...a]; }, rows = order(), cols = order();
  const solution = Array.from({ length: 16 }, (_, i) => sym[SUDOKU_BASE[rows[i >> 2] * 4 + cols[i & 3]]]), puzzle = solution.slice();
  let out = 0;
  for (const i of shuffled([...puzzle.keys()], rand)) {
    if (out >= gaps) break;
    puzzle[i] = -1;
    if (sudokuSolutions(puzzle.slice()) === 1) out++; else puzzle[i] = solution[i];
  }
  return { solution, puzzle };
}
async function sudokuPage(title, s, items, answers) {
  const cell = 124, left = (816 - cell * 4) / 2, top = 214, mid = left + cell * 2, parts = [...preHeader(answers ? keyTitle(title) : title),
    T('Every row, every column and every box of four needs each one once. Cut out the squares at the bottom and stick them in.', 48, 148, { width: 720, fontSize: 18, textAlign: 'center', fill: '#666666', kbName: 'Instructions' })];
  for (const [i, v] of s.solution.entries()) {
    const x = left + (i & 3) * cell, y = top + (i >> 2) * cell, gap = s.puzzle[i] < 0;
    parts.push(R(x, y, cell, cell, { fill: '#ffffff', stroke: '#9a86d6', strokeWidth: 1.5, kbName: gap ? 'Empty square' : 'Square' }));
    if (!gap || answers) parts.push(...await squareItem(items[v], x + 10, y + 10, cell - 20, false));
    if (gap && answers) parts.push(R(x + 6, y + 6, cell - 12, cell - 12, { rx: 8, ry: 8, stroke: SHEET_PINK, strokeWidth: 4, kbName: 'Answer' }));
  }
  parts.push(R(left, top, cell * 4, cell * 4, { stroke: '#3a3a3a', strokeWidth: 5, kbName: 'Grid edge' }),
    new kbe.Path(`M${mid} ${top} L${mid} ${top + cell * 4} M${left} ${top + cell * 2} L${left + cell * 4} ${top + cell * 2}`, { fill: '', stroke: '#3a3a3a', strokeWidth: 5, kbName: 'Box lines' }));
  if (!answers) {
    const pieces = s.solution.filter((_, i) => s.puzzle[i] < 0).sort(), per = 7, size = 92;
    for (const [j, v] of pieces.entries()) {
      const row = Math.floor(j / per), inRow = Math.min(per, pieces.length - row * per), x = 408 + (j % per - inRow / 2) * size, y = 760 + row * (size + 12);
      parts.push(R(x, y, size, size, { stroke: '#999999', strokeWidth: 1.5, strokeDashArray: [8, 6], kbName: 'Line to cut' }), ...await squareItem(items[v], x + 8, y + 8, size - 16, false));
    }
  }
  return toPage(parts);
}

// ---- Feelings: wall cards with a face and its word, for circle time ----
const FEELINGS = [['Happy', 'grinning face'], ['Sad', 'crying face'], ['Angry', 'angry face'], ['Scared', 'fearful face'], ['Surprised', 'astonished face'], ['Tired', 'yawning face'],
  ['Excited', 'star-struck'], ['Shy', 'flushed face'], ['Silly', 'zany face'], ['Calm', 'relieved face'], ['Worried', 'worried face'], ['Sick', 'face with thermometer'],
  ['Loved', 'smiling face with hearts'], ['Proud', 'beaming face with smiling eyes'], ['Confused', 'confused face'], ['Sleepy', 'sleeping face']];
async function feelingCard([word, face], x, y, w, h, i) {
  return [cardWords('I feel', x, y + h * 0.06, w, h * 0.06, { fontWeight: 'normal', fill: '#666666', kbName: 'I feel' }),
    await pic(face, x + w / 2, y + h * 0.46, Math.min(w * 0.68, h * 0.52), { kbName: word + ' face' }),
    cardWords(word, x, y + h * 0.78, w, h * 0.11, { fill: CARD_COLOURS[i % CARD_COLOURS.length][1] })];
}

Object.assign(SHEET_KINDS, {
  bingo: { title: 'Bingo', words: false, key: false, hint: 'One word per line, up to 60. Pick one of your lists above to fill it in.',
    async make(title, key, seed, words) {
      const what = $('#sheet-bingo-what').value, size = +$('#sheet-bingo-size').value, pool = bingoPool(what, words), need = bingoNeeds(size);
      const cards = bingoCards(pool, size, +$('#sheet-bingo-count').value, seededRandom(seed));
      // Her words the same size on the cards: the size that fits four in five of them, so one long word shrinks alone.
      if (what === 'words' && pool.length) { const s = 672 / size - 8, sizes = pool.map(item => fitText(item.text, 0, 0, s - 8, s).fontSize).sort((a, b) => a - b), share = sizes[Math.floor(sizes.length * 0.2)] / s; for (const item of pool) item.size = share; }
      if (!cards && what === 'photos') return { error: `A ${size} × ${size} card needs at least ${need} photos, and ${pool.length === 1 ? 'there is 1' : 'there are ' + pool.length} chosen. Choose more photos or pick fewer squares.` };
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
      return { pages: [seatingPage(title, names, $('#sheet-seat-layout').value)], note: `${names.length} desks. Drag a desk to move it; click one, then Change name, to change who sits there.` };
    } },
  clock: { title: 'Telling the time', words: false,
    async make(title, key, seed) {
      const times = clockTimes($('#sheet-clock-level').value, seededRandom(seed)), mode = $('#sheet-clock-mode').value;
      return { pages: [clockPage(title, times, mode, false), ...(key ? [clockPage(title, times, mode, true)] : [])] };
    } },
  memory: { title: 'Memory game', words: false, key: false,
    async make(title, key, seed) {
      const pairs = memoryPairs($('#sheet-memory-what').value, +$('#sheet-memory-pairs').value, seededRandom(seed));
      if (pairs.length < +$('#sheet-memory-pairs').value) return { error: `${$('#sheet-memory-pairs').value} pairs need that many photos, and ${sheetPhotos.length === 1 ? 'there is 1' : 'there are ' + sheetPhotos.length} chosen. Choose more photos or fewer pairs.` };
      return { pages: await memoryPages(title, pairs), note: `${pairs.length} pairs to cut apart. Print on card so the pictures don't show through.` };
    } },
  missing: { title: 'Missing numbers', words: false,
    async make(title, key, seed) {
      const upto = +$('#sheet-missing-upto').value, missing = missingNumbers(upto, $('#sheet-missing-share').value, seededRandom(seed));
      return { pages: [missingPage(title, upto, missing, false), ...(key ? [missingPage(title, upto, missing, true)] : [])] };
    } },
  scramble: { title: 'Word scramble', words: true, hint: 'One word per line, up to 12. Pick one of your lists above to fill it in.',
    async make(title, key, seed, typed) {
      const words = scrambleList(typed), rand = seededRandom(seed);
      if (!words.length) return { error: 'Type a few words first, one per line.' };
      const mixed = words.map(w => scrambled(w, rand)), bank = $('#sheet-scramble-bank').checked ? shuffled(words, rand) : null;
      return { pages: [scramblePage(title, words, mixed, bank, false), ...(key ? [scramblePage(title, words, mixed, bank, true)] : [])] };
    } },
  sudoku: { title: 'Picture sudoku', words: false,
    async make(title, key, seed) {
      const rand = seededRandom(seed), s = sudoku(SUDOKU_GAPS[$('#sheet-sudoku-level').value], rand);
      const items = $('#sheet-sudoku-what').value === 'numbers' ? ['1', '2', '3', '4'].map(text => ({ text })) : shuffled(BINGO_PICS, rand).slice(0, 4).map(p => ({ pic: p }));
      return { pages: [await sudokuPage(title, s, items, false), ...(key ? [await sudokuPage(title, s, items, true)] : [])] };
    } },
  'feelings-cards': { title: 'Feelings', words: false, key: false,
    async make() { return { pages: await cardPages(FEELINGS, cardLayout(), feelingCard), note: `${FEELINGS.length} feelings, from Happy to Sleepy.` }; } }
});
const bingoWords = () => { $('#sheet-words-part').hidden = $('#sheet-bingo-what').value !== 'words'; paintSheetPhotos(); };
$('#sheet-bingo-what').onchange = bingoWords;
$('#sheet-bingo').onclick = () => { openSheet('bingo'); bingoWords(); };
$('#sheet-seating').onclick = () => openSheet('seating');
$('#sheet-clock').onclick = () => openSheet('clock');
$('#sheet-memory-what').onchange = paintSheetPhotos;
$('#sheet-memory').onclick = () => { openSheet('memory'); paintSheetPhotos(); };
$('#sheet-missing').onclick = () => openSheet('missing');
$('#sheet-scramble').onclick = () => openSheet('scramble');
$('#sheet-sudoku').onclick = () => openSheet('sudoku');
$('#sheet-feelings-cards').onclick = () => openSheet('feelings-cards');
