// Textbox for the own engine: wrapping, per-character styles, alignment, decorations, drawing. Original code; it reads and
// writes the same saved JSON as Fabric's Textbox. The in-place editor is in editor.js. Needs model.js.
(function () {
'use strict';
const kbe = globalThis.kbe, { FabricObject, Gradient } = kbe, { registry, enlivenProps, round, VERSION } = kbe.internal;
const SIZE_MULT = 1.13, BASELINE_FRACTION = 0.222, MEASURE_SIZE = 400; // line height per font size; share of a line under the baseline; font size widths are measured at
const OFFSETS = { underline: 0.1, linethrough: -0.28167, overline: -0.81333 }; // decoration positions, in font sizes from the baseline
const LIFT = { underline: 0, linethrough: 0.5, overline: 1 }; // how much of its thickness a decoration is raised above its offset
const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'underline', 'overline', 'linethrough', 'textBackgroundColor', 'deltaY'];
const RELAYOUT = new Set(['text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'charSpacing', 'textAlign', 'styles', 'splitByGrapheme', 'width', 'minWidth']);
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = s => segmenter ? [...segmenter.segment(s)].map(x => x.segment) : Array.from(s);

let probe;
const measureText = (font, text) => { probe ||= document.createElement('canvas').getContext('2d'); probe.font = font; return probe.measureText(text).width; };

// styles are {lineIndex: {charIndex: {...}}}; saved files hold them as runs {start, end, style} counted over the text without its line breaks
function stylesFromArray(runs, text) {
  const out = {}, lines = text.split('\n').map(l => graphemes(l).length);
  for (const { start, end, style } of runs) for (let at = start; at < end; at++) {
    let line = 0, rest = at; while (line < lines.length && rest >= lines[line]) rest -= lines[line++];
    if (line < lines.length) (out[line] ||= {})[rest] = { ...style };
  }
  return out;
}
function stylesToArray(styles, text) {
  const runs = []; let at = -1, last = null;
  text.split('\n').forEach((line, l) => {
    const n = graphemes(line).length;
    if (!styles[l]) { at += n; return; }
    for (let c = 0; c < n; c++) {
      at++; const st = styles[l][c];
      if (!st || !Object.keys(st).length) continue;
      if (last && last.end === at && JSON.stringify(last.style) === JSON.stringify(st)) last.end++;
      else runs.push(last = { start: at, end: at + 1, style: { ...st } });
    }
  });
  return runs;
}

class Textbox extends FabricObject {
  static ownDefaults = {
    fontSize: 40, fontWeight: 'normal', fontFamily: 'Times New Roman', fontStyle: 'normal', lineHeight: 1.16, text: '', charSpacing: 0, textAlign: 'left',
    styles: {}, pathStartOffset: 0, pathSide: 'left', pathAlign: 'baseline', underline: false, overline: false, linethrough: false, textBackgroundColor: '',
    direction: 'ltr', textDecorationThickness: 66.667, minWidth: 20, splitByGrapheme: false, deltaY: 0,
    isEditing: false, selectionStart: 0, selectionEnd: 0, editable: true, cursorWidth: 2, cursorColor: '', selectionColor: 'rgba(17,119,255,0.3)'
  };
  constructor(text = '', options = {}) {
    const { text: _t, styles, ...rest } = options;
    super(rest); // the text and its styles go in together, once the font is known
    this._batch = true; this.text = String(text); this.styles = Array.isArray(styles) ? stylesFromArray(styles, this.text) : { ...(styles || {}) };
    this._batch = false; this.dynamicMinWidth = 0; this.initDimensions();
  }
  set(key, value) {
    if (typeof key === 'object') { const was = this._batch; this._batch = true; let relayout = false; for (const k in key) { if (RELAYOUT.has(k)) relayout = true; this.set(k, key[k]); } this._batch = was; if (relayout && !was && this.styles && this._lines) this.initDimensions(); return this; }
    if (key === 'styles' && Array.isArray(value)) value = stylesFromArray(value, this.text);
    if (key === 'text') value = String(value ?? '');
    super.set(key, value);
    if (RELAYOUT.has(key) && !this._batch && this.styles && this._lines) this.initDimensions();
    return this;
  }
  get _fontSizeMult() { return SIZE_MULT; } get _fontSizeFraction() { return BASELINE_FRACTION; } // Fabric's names, read by the Canva importer
  get textLines() { return this._lines.map(l => l.chars.map(c => c.g).join('')); }
  _getFontDeclaration(style = this, forMeasure) {
    const family = style.fontFamily ?? this.fontFamily, quoted = /['",]/.test(family) || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(family) ? family : `"${family}"`;
    return [style.fontStyle ?? this.fontStyle, style.fontWeight ?? this.fontWeight, (forMeasure ? MEASURE_SIZE : style.fontSize ?? this.fontSize) + 'px', quoted].join(' ');
  }
  // the look of one character: this box's settings with that character's own on top
  getCompleteStyleDeclaration(line, char) {
    const own = this.styles[line]?.[char], out = {};
    for (const k of STYLE_KEYS) out[k] = own && own[k] !== undefined ? own[k] : this[k];
    return out;
  }
  _unwrapped() { return this.text.split('\n').map(graphemes); }
  _advance(g, style, prev, prevStyle) { // how far the pen moves after g, with the kerning against the previous character
    const font = this._getFontDeclaration(style, true), k = style.fontSize / MEASURE_SIZE;
    let w = measureText(font, g);
    if (prev !== undefined && prevStyle && prevStyle.fontSize === style.fontSize && this._getFontDeclaration(prevStyle, true) === font) w = measureText(font, prev + g) - measureText(font, prev);
    return w * k + (this.charSpacing ? this.fontSize * this.charSpacing / 1000 : 0); // the spacing follows the box's size, not the character's
  }
  _wordWidth(chars, li, from) {
    let w = 0, prev, prevStyle;
    chars.forEach((g, i) => { const st = this.getCompleteStyleDeclaration(li, from + i); w += this._advance(g, st, prev, prevStyle); prev = g; prevStyle = st; });
    return w;
  }
  // break one paragraph into lines that fit `width`; lines hold {g, idx} (idx: place in the paragraph)
  _wrap(chars, li, width) {
    const spacing = this.charSpacing ? this.fontSize * this.charSpacing / 1000 : 0, byGrapheme = this.splitByGrapheme;
    const words = []; // {chars, from}
    if (byGrapheme) chars.forEach((g, i) => words.push({ chars: [g], from: i }));
    else { let from = 0, cur = []; chars.forEach((g, i) => { if (g === ' ' || g === '\t' || g === '\r') { words.push({ chars: cur, from }); cur = []; from = i + 1; } else cur.push(g); }); words.push({ chars: cur, from }); }
    const wordW = words.map(w => this._wordWidth(w.chars, li, w.from)), widest = Math.max(0, ...wordW);
    const infixW = i => byGrapheme ? 0 : this._wordWidth([' '], li, Math.max(0, words[i].from - 1)); // a space is as wide as the character it stands for
    const lines = []; let line = [], lineW = 0, started = true;
    words.forEach((w, i) => {
      lineW += (i ? infixW(i) : 0) + wordW[i] - spacing;
      if (lineW > width && !started) { lines.push(line); line = []; lineW = wordW[i]; started = true; } else lineW += spacing;
      if (!started && !byGrapheme) line.push({ g: ' ', idx: w.from - 1 });
      w.chars.forEach((g, k) => line.push({ g, idx: w.from + k }));
      started = false;
    });
    lines.push(line);
    this.dynamicMinWidth = Math.max(this.dynamicMinWidth, widest - spacing); this._widest = Math.max(this._widest || 0, widest);
    return lines;
  }
  initDimensions() {
    const wrapAll = desired => {
      this._lines = []; this._paragraphEnds = [];
      this._unwrapped().forEach((chars, li) => {
        const wrapped = this._wrap(chars, li, desired);
        wrapped.forEach((line, k) => { this._lines.push({ chars: line, line: li, start: line.length ? line[0].idx : (k ? this._lines.at(-1).start : 0) }); this._paragraphEnds.push(k === wrapped.length - 1); });
      });
    };
    // the box never gets narrower than its longest word, and every paragraph wraps to that wider limit
    this.dynamicMinWidth = 0; this._widest = 0; wrapAll(this.width);
    if (this._widest > this.width) wrapAll(this._widest);
    if (this.dynamicMinWidth > this.width) this.width = this.dynamicMinWidth;
    this._measureLines();
    this.height = this._lines.reduce((h, _, i) => h + this._lineHeight(i) * (i === this._lines.length - 1 ? 1 : this.lineHeight), 0);
  }
  _measureLines() {
    this.__lineHeights = []; this.__lineWidths = []; this._boxes = [];
    this._lines.forEach((ln, i) => {
      let max = 0, x = 0, prev, prevStyle; const boxes = [];
      ln.chars.forEach(({ g, idx }) => {
        const st = this.getCompleteStyleDeclaration(ln.line, idx), w = this._advance(g, st, prev, prevStyle);
        boxes.push({ g, idx, style: st, left: x, width: w }); x += w; max = Math.max(max, st.fontSize); prev = g; prevStyle = st;
      });
      if (!ln.chars.length) max = this.getCompleteStyleDeclaration(ln.line, ln.start).fontSize;
      this.__lineHeights.push(max * SIZE_MULT); this.__lineWidths.push(boxes.length && this.charSpacing ? x - this.fontSize * this.charSpacing / 1000 : x); this._boxes.push(boxes); // the last letter's spacing is not part of the line's width
    });
    if (/^justify/.test(this.textAlign)) this._justify();
  }
  _justify() { // spread the spaces of lines that are followed by more of their paragraph
    this._boxes.forEach((boxes, i) => {
      if (this._paragraphEnds[i] && this.textAlign !== 'justify') return; // plain justify spreads the last line of a paragraph too, like Fabric
      const spaces = boxes.filter(b => b.g === ' ').length, extra = spaces ? (this.width - this.__lineWidths[i]) / spaces : 0;
      if (extra <= 0) return;
      let shift = 0; for (const b of boxes) { b.left += shift; if (b.g === ' ') { b.width += extra; shift += extra; } }
      this.__lineWidths[i] = this.width;
    });
  }
  _lineHeight(i) { return this.__lineHeights[i]; }
  _lineLeftOffset(i) { // justified text only moves its last lines (justify-center, justify-right)
    const a = this.textAlign, room = this.width - this.__lineWidths[i];
    if (a.startsWith('justify') && !this._paragraphEnds[i]) return 0;
    return a === 'center' || a === 'justify-center' ? room / 2 : a === 'right' || a === 'justify-right' ? room : 0;
  }
  _removeShadow() {} // the engine lays shadows on whole objects, so there is nothing to switch off here
  _setTextStyles(ctx) { ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; }

  // ---- drawing, in the object's own space (middle at 0, 0)
  _lineTop(i) { let t = -this.height / 2; for (let k = 0; k < i; k++) t += this._lineHeight(k) * this.lineHeight; return t; }
  _runs(i, key) { // runs of neighbouring characters with the same value of key(box)
    const runs = []; for (const b of this._boxes[i]) { const v = key(b), last = runs.at(-1); if (last && last.v === v) { last.chars.push(b); last.width += b.width; } else runs.push({ v, chars: [b], left: b.left, width: b.width }); }
    return runs;
  }
  _paint(ctx, v, style) { return v && v.colorStops ? this._gradient(ctx, v) : v; }
  _gradient(ctx, g) { return kbe.gradientFor ? kbe.gradientFor(ctx, g, this) : '#000'; }
  _renderBackgrounds(ctx) {
    this._lines.forEach((_, i) => {
      const top = this._lineTop(i), left = -this.width / 2 + this._lineLeftOffset(i);
      for (const r of this._runs(i, b => b.style.textBackgroundColor || '')) if (r.v) { ctx.fillStyle = r.v; ctx.fillRect(left + r.left, top, r.width, this._lineHeight(i)); }
    });
  }
  _renderDecoration(ctx, kind) {
    this._lines.forEach((_, i) => {
      const top = this._lineTop(i), baseline = top + this._lineHeight(i) * (1 - BASELINE_FRACTION), left = -this.width / 2 + this._lineLeftOffset(i);
      for (const r of this._runs(i, b => b.style[kind] ? (b.style.fill ?? this.fill) + '|' + b.style.fontSize + '|' + b.style.deltaY : '')) {
        if (!r.v) continue;
        const st = r.chars[0].style, size = st.fontSize, thick = size * this.textDecorationThickness / 1000;
        ctx.fillStyle = this._paint(ctx, st.fill, st); ctx.fillRect(left + r.left, baseline + OFFSETS[kind] * size - thick * LIFT[kind] + st.deltaY, r.width - (r.chars.at(-1) === this._boxes[i].at(-1) ? this.fontSize * this.charSpacing / 1000 : 0), thick); // a line's last letter has no spacing after it
      }
    });
  }
  _renderText(ctx, method) {
    this._lines.forEach((_, i) => {
      const baseline = this._lineTop(i) + this._lineHeight(i) * (1 - BASELINE_FRACTION), left = -this.width / 2 + this._lineLeftOffset(i);
      const spaced = !!this.charSpacing || /^justify/.test(this.textAlign);
      const keyOf = b => { const s = b.style; return [this._getFontDeclaration(s), s.fill && s.fill.colorStops ? JSON.stringify(s.fill) : s.fill, s.stroke, s.strokeWidth, s.deltaY].join('|'); };
      for (const r of spaced ? this._boxes[i].map(b => ({ v: keyOf(b), chars: [b], left: b.left })) : this._runs(i, keyOf)) {
        const st = r.chars[0].style, text = r.chars.map(c => c.g).join('');
        if (method === 'fillText') { if (!st.fill) continue; ctx.fillStyle = this._paint(ctx, st.fill, st); }
        else { if (!st.stroke || !st.strokeWidth) continue; ctx.strokeStyle = this._paint(ctx, st.stroke, st); ctx.lineWidth = st.strokeWidth; ctx.lineJoin = this.strokeLineJoin; ctx.lineCap = this.strokeLineCap; ctx.miterLimit = this.strokeMiterLimit; }
        ctx.font = this._getFontDeclaration(st); ctx[method](text, left + r.left, baseline + st.deltaY);
      }
    });
  }
  _render(ctx) {
    ctx.save(); this._setTextStyles(ctx);
    if (this.isEditing && this.selectionStart !== this.selectionEnd) this._renderSelection(ctx);
    this._renderBackgrounds(ctx); this._renderDecoration(ctx, 'underline');
    if (this.paintFirst === 'stroke') { this._renderText(ctx, 'strokeText'); this._renderText(ctx, 'fillText'); } else { this._renderText(ctx, 'fillText'); this._renderText(ctx, 'strokeText'); }
    this._renderDecoration(ctx, 'overline'); this._renderDecoration(ctx, 'linethrough');
    if (this.isEditing && this._cursorOn !== false) this._renderCursor(ctx);
    ctx.restore();
  }
  _renderSelection() {} _renderCursor() {} // editor.js

  _own() {
    return { fontSize: this.fontSize, fontWeight: this.fontWeight, fontFamily: this.fontFamily, fontStyle: this.fontStyle, lineHeight: this.lineHeight, text: this.text, charSpacing: this.charSpacing,
      textAlign: this.textAlign, styles: stylesToArray(this.styles, this.text), pathStartOffset: this.pathStartOffset, pathSide: this.pathSide, pathAlign: this.pathAlign, underline: this.underline,
      overline: this.overline, linethrough: this.linethrough, textBackgroundColor: this.textBackgroundColor, direction: this.direction, textDecorationThickness: this.textDecorationThickness,
      minWidth: this.minWidth, splitByGrapheme: this.splitByGrapheme };
  }
  toObject(keys = []) { const o = super.toObject(keys); o.fontSize = round(o.fontSize); return o; }
  static async fromObject(object, options) {
    const { type, version, text, ...rest } = object;
    return new Textbox(text, await enlivenProps(rest, options));
  }
}
Textbox.stylesFromArray = stylesFromArray; Textbox.stylesToArray = stylesToArray; Textbox.graphemes = graphemes;
registry.set('textbox', Textbox);
kbe.Textbox = Textbox;
// FabricText: a label that never wraps; its width is its longest line (the app's charts and shape labels use it)
class FabricText extends Textbox {
  static get type() { return 'Text'; }
  initDimensions() {
    this.width = 1e7; super.initDimensions();
    this.width = Math.max(0, ...this.__lineWidths) || this.cursorWidth;
  }
  _own() { const { minWidth, splitByGrapheme, ...rest } = super._own(); return rest; }
  static async fromObject(object, options) {
    const { type, version, text, ...rest } = object;
    return new FabricText(text, await enlivenProps(rest, options));
  }
}
registry.set('text', FabricText); registry.set('fabrictext', FabricText);
kbe.FabricText = FabricText; kbe.Text = FabricText;
})();
