// KB Studio's own QR code encoder (MIT), written from ISO/IEC 18004: byte mode, error-correction level M, versions 1-40.
// makeQr(text) gives { count, isDark(row, col) } for the smallest version that holds the UTF-8 bytes; it throws if the text is too long.
// shortcut: byte mode and level M only (all Create needs), no Kanji/numeric packing; add modes here if a smaller code ever matters.
(function () {
  // Per version at level M: [check bytes per block, blocks of the first size, data bytes each, blocks of the second size, data bytes each].
  const M = [[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],
    [30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],[28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42],
    [26,17,42,0,0],[28,17,46,0,0],[28,4,47,14,48],[28,6,45,14,46],[28,8,47,13,48],[28,19,46,4,47],[28,22,45,3,46],[28,3,45,23,46],[28,21,45,7,46],[28,19,47,10,48],
    [28,2,46,29,47],[28,10,46,23,47],[28,14,46,21,47],[28,14,46,23,47],[28,12,47,26,48],[28,6,47,34,48],[28,29,46,14,47],[28,13,46,32,47],[28,40,47,7,48],[28,18,47,31,48]];
  const capacity = v => M[v - 1][1] * M[v - 1][2] + M[v - 1][3] * M[v - 1][4];

  // Arithmetic in GF(256) with the QR polynomial 0x11D, for the Reed-Solomon check bytes.
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function checkBytes(data, n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
      g = next;
    }
    const r = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ r.shift(); r.push(0);
      for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f);
    }
    return r;
  }

  // The message as bytes: mode, length, text, terminator, padding; then split into blocks with check bytes, interleaved.
  function codewords(bytes, v) {
    const bits = [], put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const total = capacity(v) * 8;
    put(0, Math.min(4, total - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; data.length < capacity(v); pad ^= 0xEC ^ 0x11) data.push(pad);
    const [ec, b1, d1, b2, d2] = M[v - 1], blocks = [];
    let at = 0;
    for (let i = 0; i < b1 + b2; i++) { const n = i < b1 ? d1 : d2; blocks.push(data.slice(at, at + n)); at += n; }
    const checks = blocks.map(b => checkBytes(b, ec)), out = [];
    for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ec; i++) for (const c of checks) out.push(c[i]);
    return out;
  }

  const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r * c) % 3 + (r + c) % 2) % 2 === 0];
  const bch = (value, poly, shift) => {
    const len = x => 32 - Math.clz32(x);
    let d = value << shift;
    while (len(d) >= len(poly)) d ^= poly << (len(d) - len(poly));
    return (value << shift) | d;
  };

  function build(codes, v, mask) {
    const size = 17 + 4 * v, mod = Array.from({ length: size }, () => new Array(size).fill(false)), fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => { if (r >= 0 && c >= 0 && r < size && c < size) { mod[r][c] = dark; fixed[r][c] = true; } };
    for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) { const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3)); set(r + dr, c + dc, d !== 2 && d !== 4); }
    }
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    if (v > 1) {
      const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((size - 13) / (n - 1) / 2) * 2, at = [6];
      for (let p = size - 7; at.length < n; p -= step) at.splice(1, 0, p);
      for (const r of at) for (const c of at) {
        if ((r === 6 && (c === 6 || c === size - 7)) || (r === size - 7 && c === 6)) continue; // the finder corners
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
    const format = bch(mask, 0x537, 10) ^ 0x5412; // level M is 00, then the mask number
    for (let i = 0; i < 15; i++) {
      const bit = ((format >> i) & 1) === 1;
      set(i < 6 ? i : i < 8 ? i + 1 : size - 15 + i, 8, bit);
      set(8, i < 8 ? size - i - 1 : i < 9 ? 7 : 14 - i, bit);
    }
    set(size - 8, 8, true); // the always-dark module
    if (v >= 7) {
      const info = bch(v, 0x1F25, 12);
      for (let i = 0; i < 18; i++) { const bit = ((info >> i) & 1) === 1; set(Math.floor(i / 3), i % 3 + size - 11, bit); set(i % 3 + size - 11, Math.floor(i / 3), bit); }
    }
    // Data goes in two-column strips from the bottom right, zig-zagging up and down, skipping the timing column.
    let n = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < size; i++) {
        const r = up ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (fixed[r][c]) continue;
          const bit = n < codes.length * 8 ? ((codes[n >> 3] >> (7 - (n & 7))) & 1) === 1 : false;
          n++;
          mod[r][c] = bit !== MASKS[mask](r, c);
        }
      }
      up = !up;
    }
    return mod;
  }

  // The four standard penalty rules; the mask with the fewest penalty points wins.
  function penalty(m) {
    const size = m.length, at = (r, c) => m[r][c];
    let p = 0, dark = 0;
    for (const line of [0, 1]) for (let a = 0; a < size; a++) {
      const get = b => (line ? at(b, a) : at(a, b));
      for (let b = 0, run = 1; b < size; b++) {
        if (b && get(b) === get(b - 1)) run++; else run = 1;
        if (run === 5) p += 3; else if (run > 5) p++;
      }
      for (let b = 0; b + 10 < size; b++) {
        const w = []; for (let k = 0; k < 11; k++) w.push(get(b + k) ? 1 : 0);
        const s = w.join('');
        if (s === '10111010000' || s === '00001011101') p += 40;
      }
    }
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (m[r][c]) dark++;
      if (r + 1 < size && c + 1 < size && m[r][c] === m[r + 1][c] && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c + 1]) p += 3;
    }
    return p + 10 * Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5);
  }

  // `mask` forces one mask (for tests); normally the best is chosen.
  window.makeQr = function (text, mask) {
    const bytes = new TextEncoder().encode(text);
    let v = 1;
    while (v <= 40 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > capacity(v) * 8) v++;
    if (v > 40) throw new Error('Too much text for a QR code');
    const codes = codewords(bytes, v);
    let best, bestPenalty = Infinity;
    for (const k of mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask]) {
      const m = build(codes, v, k), p = penalty(m);
      if (p < bestPenalty) { best = m; bestPenalty = p; }
    }
    return { count: best.length, isDark: (r, c) => best[r][c] };
  };
})();
