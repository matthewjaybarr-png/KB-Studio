// In-place text editor for the own engine's Textbox: caret, selection, typing, IME, copy/paste, undo, mouse, events. Original code.
// The keyboard side is a hidden <textarea> that mirrors the text: typing, IME, paste, drag-drop and native deletes all arrive as an
// `input` event, which is turned into one edit of the model by comparing old and new text. Movement keys are handled here.
// Needs text.js. Mouse and canvas drawing are wired by kbe.attachTextEditing(canvas, element).
(function () {
'use strict';
const kbe = globalThis.kbe, { Textbox, StaticCanvas, FabricObject } = kbe, graphemes = Textbox.graphemes, P = Textbox.prototype;
const BLINK = 530, MAX_UNDO = 200;

// ---- events and the object -> canvas link (objects and canvases get on/off/fire; added objects know their canvas)
function emitter(proto) {
  if (proto.on) return;
  proto.on = function (name, fn) { if (typeof name === 'object') { for (const k in name) this.on(k, name[k]); return this; } ((this._handlers ||= {})[name] ||= []).push(fn); return this; };
  proto.off = function (name, fn) { const l = this._handlers?.[name]; if (l) this._handlers[name] = fn ? l.filter(f => f !== fn) : []; return this; };
  proto.fire = function (name, ev = {}) { for (const f of [...(this._handlers?.[name] || [])]) f.call(this, ev); return this; };
}
emitter(FabricObject.prototype); emitter(StaticCanvas.prototype);
for (const m of ['add', 'insertAt']) { const f = StaticCanvas.prototype[m]; StaticCanvas.prototype[m] = function (...a) { f.apply(this, a); for (const o of this._objects) o.canvas = this; return this; }; }
{ const f = StaticCanvas.prototype.remove; StaticCanvas.prototype.remove = function (...a) { for (const o of a) { if (o.isEditing) o.exitEditing(); o.canvas = undefined; } return f.apply(this, a); }; }
if (!FabricObject.prototype.setCoords) FabricObject.prototype.setCoords = function () { return this; };
StaticCanvas.prototype.renderAll = function () { const c = this.element?.getContext?.('2d'); if (!c) return this; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.element.width, this.element.height); this.renderTo(c); return this; };
StaticCanvas.prototype.requestRenderAll = function () { if (this._raf) return this; this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderAll(); }); return this; };

// ---- offsets: the model counts graphemes over the whole text (a line break is one); the textarea counts UTF-16 units
const toU16 = (chars, n) => chars.slice(0, n).join('').length;
function fromU16(chars, u) { let acc = 0, i = 0; while (i < chars.length && acc + chars[i].length <= u) acc += chars[i++].length; return i; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const WORD = /[\p{L}\p{N}_]/u;

// ---- text and styles as flat lists, one entry per grapheme (a line break has no style)
P._flatStyles = function () {
  const out = []; this.text.split('\n').forEach((line, li) => { const n = graphemes(line).length; for (let c = 0; c < n; c++) out.push(this.styles[li]?.[c]); out.push(undefined); });
  out.pop(); return out;
};
P._setFlat = function (chars, styles) {
  const st = {}; let li = 0, c = 0;
  chars.forEach((g, i) => { if (g === '\n') { li++; c = 0; return; } if (styles[i] && Object.keys(styles[i]).length) (st[li] ||= {})[c] = styles[i]; c++; });
  this.set({ text: chars.join(''), styles: st });
};
// replace [start, end) by text; new letters take the style of the letter before them (or after, at the start of a line) unless `given` lists styles
P._replace = function (start, end, insert, given) {
  const chars = graphemes(this.text), styles = this._flatStyles(), add = graphemes(insert).filter(g => g !== '\r');
  start = clamp(start, 0, chars.length); end = clamp(end, start, chars.length);
  const before = start > 0 && chars[start - 1] !== '\n' ? styles[start - 1] : end < chars.length && chars[end] !== '\n' ? styles[end] : undefined;
  const fresh = add.map((g, i) => g === '\n' ? undefined : given ? (given[i] && { ...given[i] }) : before && { ...before });
  chars.splice(start, end - start, ...add); styles.splice(start, end - start, ...fresh);
  this._setFlat(chars, styles); return add.length;
};
P._changed = function () {
  this._syncTextarea(); this._placeTextarea(); this._blinkReset();
  this.fire('changed', { target: this }); this.canvas?.fire('text:changed', { target: this }); this.canvas?.requestRenderAll?.();
};
P.insertChars = function (text, style, start = this.selectionStart, end = start) { this._snapshot(); this._replace(start, end, text, style); this._changed(); return this; };
P.removeChars = function (start, end = start + 1) { this._snapshot(); this._replace(start, end, ''); this.selectionStart = this.selectionEnd = Math.min(start, graphemes(this.text).length); this._changed(); return this; };
P.getSelectedText = function () { return graphemes(this.text).slice(this.selectionStart, this.selectionEnd).join(''); };
P.getSelectionStyles = function (start = this.selectionStart, end = this.selectionEnd, complete) {
  const flat = this._flatStyles(), out = []; let li = 0, c = 0; const chars = graphemes(this.text);
  chars.forEach((g, i) => { if (g === '\n') { li++; c = 0; return; } if (i >= start && i < end) out.push(complete ? this.getCompleteStyleDeclaration(li, c) : { ...(flat[i] || {}) }); c++; });
  return out;
};
P.setSelectionStyles = function (style, start = this.selectionStart, end = this.selectionEnd) {
  const chars = graphemes(this.text), styles = this._flatStyles(); this._snapshot();
  for (let i = start; i < end && i < chars.length; i++) if (chars[i] !== '\n') styles[i] = { ...(styles[i] || {}), ...style };
  this._setFlat(chars, styles); this._changed(); return this;
};

// ---- undo: snapshots of text, styles and selection; typing in one run and one IME composition are one step
P._snap = function () { return { text: this.text, styles: JSON.parse(JSON.stringify(this.styles)), start: this.selectionStart, end: this.selectionEnd }; };
P._snapshot = function (kind) {
  const u = this._undo; if (!u) return; const now = Date.now();
  if (kind && kind === u.kind && now - u.at < 1000) { u.at = now; return; }
  u.past.push(this._snap()); if (u.past.length > MAX_UNDO) u.past.shift(); u.future = []; u.kind = kind || null; u.at = now;
};
P._restore = function (s) { this.set({ text: s.text, styles: JSON.parse(JSON.stringify(s.styles)) }); this._setSel(s.start, s.end); this._undo.kind = null; this._changed(); };
P.undo = function () { const u = this._undo; if (!u?.past.length) return false; u.future.push(this._snap()); this._restore(u.past.pop()); return true; };
P.redo = function () { const u = this._undo; if (!u?.future.length) return false; u.past.push(this._snap()); this._restore(u.future.pop()); return true; };

// ---- geometry: lines hold {idx} counted in their paragraph; the editor works on offsets over the whole text
P._paraStarts = function () { if (this._psFor !== this.text) { let at = 0; this._ps = this.text.split('\n').map(l => { const s = at; at += graphemes(l).length + 1; return s; }); this._psFor = this.text; } return this._ps; };
P._lineBounds = function (i) { const ln = this._lines[i], base = this._paraStarts()[ln.line]; return ln.chars.length ? [base + ln.chars[0].idx, base + ln.chars.at(-1).idx + 1] : [base + ln.start, base + ln.start]; };
P._lineOf = function (offset) { for (let i = 0; i < this._lines.length; i++) { const [a, b] = this._lineBounds(i); if (offset >= a && offset <= b) return i; } return this._lines.length - 1; };
P._xOf = function (i, offset) { // x of the gap before `offset` on line i, from the middle of the object
  const base = this._paraStarts()[this._lines[i].line], box = this._boxes[i].find(b => base + b.idx === offset);
  return -this.width / 2 + this._lineLeftOffset(i) + (box ? box.left : this.__lineWidths[i]);
};
P._caretPoint = function (offset) { const i = this._lineOf(offset); return { line: i, x: this._xOf(i, offset), y: this._lineTop(i) }; };
P._offsetAt = function (x, y) { // object-space point (middle at 0, 0) -> nearest gap
  let i = 0, t = -this.height / 2; while (i < this._lines.length - 1 && y > t + this._lineHeight(i) * this.lineHeight) { t += this._lineHeight(i) * this.lineHeight; i++; }
  const [a, b] = this._lineBounds(i), base = this._paraStarts()[this._lines[i].line], rel = x + this.width / 2 - this._lineLeftOffset(i);
  for (const box of this._boxes[i]) if (rel < box.left + box.width / 2) return base + box.idx;
  return b;
};

// ---- selection: anchor stays, focus moves
P._sel = function () { // the app may set selectionStart/End directly
  const lo = Math.min(this._anchor ?? 0, this._focus ?? 0), hi = Math.max(this._anchor ?? 0, this._focus ?? 0);
  if (lo !== this.selectionStart || hi !== this.selectionEnd) { this._anchor = this.selectionStart; this._focus = this.selectionEnd; }
  return { anchor: this._anchor, focus: this._focus };
};
P._setSel = function (anchor, focus, keepGoal, keepRun) {
  const n = graphemes(this.text).length; anchor = clamp(anchor, 0, n); focus = clamp(focus, 0, n);
  const was = [this.selectionStart, this.selectionEnd];
  this._anchor = anchor; this._focus = focus; this.selectionStart = Math.min(anchor, focus); this.selectionEnd = Math.max(anchor, focus);
  if (!keepGoal) this._goalX = null;
  this._syncTextarea(); this._placeTextarea(); this._blinkReset(); if (this._undo && !keepRun) this._undo.kind = null;
  if (was[0] !== this.selectionStart || was[1] !== this.selectionEnd) { this.fire('selection:changed', { target: this }); this.canvas?.fire('text:selection:changed', { target: this }); }
  this.canvas?.requestRenderAll?.();
};
P.selectAll = function () { this._setSel(0, graphemes(this.text).length); return this; };
P.selectWord = function (at = this.selectionStart) {
  const chars = graphemes(this.text); let a = clamp(at, 0, chars.length), b = a; const kind = c => c === undefined || c === '\n' ? 0 : WORD.test(c) ? 1 : /\s/.test(c) ? 2 : 3;
  const k = kind(chars[a]) || kind(chars[a - 1]);
  while (a > 0 && kind(chars[a - 1]) === k) a--; while (b < chars.length && kind(chars[b]) === k) b++;
  this._setSel(a, b); return this;
};
P.selectLine = function (at = this.selectionStart) { const [a, b] = this._lineBounds(this._lineOf(at)); this._setSel(a, b); return this; };
P._wordEdge = function (from, dir) {
  const chars = graphemes(this.text), isW = c => c !== undefined && WORD.test(c); let i = from;
  if (dir > 0) { while (i < chars.length && !isW(chars[i])) i++; while (i < chars.length && isW(chars[i])) i++; }
  else { while (i > 0 && !isW(chars[i - 1])) i--; while (i > 0 && isW(chars[i - 1])) i--; }
  return i;
};
P._move = function (key, ctrl, shift) {
  const { anchor, focus } = this._sel(), n = graphemes(this.text).length; let to = focus, vertical = false;
  if (key === 'ArrowLeft') to = !shift && anchor !== focus ? Math.min(anchor, focus) : ctrl ? this._wordEdge(focus, -1) : focus - 1;
  else if (key === 'ArrowRight') to = !shift && anchor !== focus ? Math.max(anchor, focus) : ctrl ? this._wordEdge(focus, 1) : focus + 1;
  else if (key === 'Home') to = ctrl ? 0 : this._lineBounds(this._lineOf(focus))[0];
  else if (key === 'End') to = ctrl ? n : this._lineBounds(this._lineOf(focus))[1];
  else { // Up, Down: keep the column the move started from
    vertical = true; const p = this._caretPoint(focus), line = p.line + (key === 'ArrowUp' ? -1 : 1); this._goalX ??= p.x;
    to = line < 0 ? 0 : line >= this._lines.length ? n : this._offsetAt(this._goalX, this._lineTop(line) + 1);
  }
  this._setSel(shift ? anchor : to, to, vertical);
};

// ---- the hidden textarea
P._syncTextarea = function () {
  const ta = this.hiddenTextarea; if (!ta || this._composing) return;
  const chars = graphemes(this.text), s = toU16(chars, this.selectionStart), e = toU16(chars, this.selectionEnd);
  if (ta.value !== this.text) ta.value = this.text;
  if (ta.selectionStart !== s || ta.selectionEnd !== e) ta.setSelectionRange(s, e);
};
P._pullSelection = function () { // keeps the undo run going: typing moves the caret too // the textarea moved its own selection (a native edit)
  const ta = this.hiddenTextarea, chars = graphemes(this.text);
  const back = ta.selectionDirection === 'backward';
  this._setSel(fromU16(chars, back ? ta.selectionEnd : ta.selectionStart), fromU16(chars, back ? ta.selectionStart : ta.selectionEnd), false, true);
};
P._onInput = function () {
  const ta = this.hiddenTextarea, old = this.text, val = ta.value.replace(/\r\n?/g, '\n');
  if (val === old) { this._pullSelection(); return; }
  const caret = ta.selectionStart, grow = val.length - old.length; let from, to, ins; // old[from, to) became ins
  if (grow > 0 && caret - grow >= 0 && val.slice(0, caret - grow) + val.slice(caret) === old) { from = to = caret - grow; ins = val.slice(from, caret); }
  else if (grow < 0 && old.slice(0, caret) + old.slice(caret - grow) === val) { from = caret; to = caret - grow; ins = ''; }
  else { let p = 0; const max = Math.min(old.length, val.length); while (p < max && old[p] === val[p]) p++; let s = 0; while (s < max - p && old[old.length - 1 - s] === val[val.length - 1 - s]) s++; from = p; to = old.length - s; ins = val.slice(p, val.length - s); }
  const chars = graphemes(old), a = fromU16(chars, from), b = Math.min(chars.length, fromU16(chars, to) + (toU16(chars, fromU16(chars, to)) < to ? 1 : 0));
  const insertText = val.slice(toU16(chars, a), val.length - (old.length - toU16(chars, b)));
  if (!this._composing) this._snapshot(b === a && insertText ? 'type' : a !== b && !insertText ? 'delete' : null);
  this._replace(a, b, insertText);
  this._pullSelection(); this._changed();
};
P._onKey = function (e) {
  this._sel(); this._syncTextarea(); // the app may have moved the selection since the last key
  if (this._composing || e.isComposing || e.keyCode === 229) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key, low = k.length === 1 ? k.toLowerCase() : k;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) { e.preventDefault(); this._move(k, ctrl, e.shiftKey); }
  else if (ctrl && low === 'a') { e.preventDefault(); this.selectAll(); }
  else if (ctrl && low === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
  else if (ctrl && low === 'y') { e.preventDefault(); this.redo(); }
  else if (k === 'Escape') { e.preventDefault(); this.exitEditing(); }
  else if (k === 'Tab') e.preventDefault();
};
P._onCopy = function (e, cut) {
  e.preventDefault(); const a = this.selectionStart, b = this.selectionEnd; if (a === b) return;
  const text = this.getSelectedText(); e.clipboardData?.setData('text/plain', text);
  kbe.styleClipboard = { text, styles: this._flatStyles().slice(a, b).map(s => s && { ...s }) }; // same-app paste keeps the letters' looks
  if (cut) { this.removeChars(a, b); }
};
P._onPaste = function (e) {
  e.preventDefault(); const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n'); if (!text) return;
  const sc = kbe.styleClipboard, n = graphemes(text).length, at = this.selectionStart;
  this.insertChars(text, sc && sc.text === text ? sc.styles : null, at, this.selectionEnd); this._setSel(at + n, at + n);
};

// ---- the pointer, in scene coordinates (the canvas and attachTextEditing call these)
P._offsetAtScene = function (p) { return this._offsetAt(...(q => [q.x, q.y])(kbe.util.transformPoint(p, kbe.util.invertTransform(this.calcTransformMatrix())))); };
P._editDown = function (p, detail, shift) {
  const at = this._offsetAtScene(p); this.hiddenTextarea?.focus({ preventScroll: true });
  if (detail >= 3) this.selectLine(at); else if (detail === 2) this.selectWord(at); else if (shift) this._setSel(this._sel().anchor, at); else this._setSel(at, at);
};
P._editMove = function (p) { this._setSel(this._anchor, this._offsetAtScene(p)); };
P._editUp = function () {};
// keep the hidden textarea at the caret, so an IME's candidate window opens beside the letters being typed
P._placeTextarea = function () {
  const ta = this.hiddenTextarea, c = this.canvas, el = c?.upperCanvasEl || c?.element; if (!ta || !el || this._lines === undefined) return;
  const r = el.getBoundingClientRect(), v = c.viewportTransform || [1, 0, 0, 1, 0, 0], at = this._caretPoint(this.selectionEnd), m = this.calcTransformMatrix();
  const s = kbe.util.transformPoint(kbe.util.transformPoint({ x: at.x, y: at.y }, m), v), kx = r.width / (c.width || r.width), ky = r.height / (c.height || r.height);
  const h = Math.max(8, this.__lineHeights[at.line] * Math.abs(this.scaleY) * v[3] * ky);
  Object.assign(ta.style, { left: r.left + s.x * kx + 'px', top: r.top + s.y * ky + 'px', height: h + 'px', fontSize: h + 'px', lineHeight: h + 'px' });
};

// ---- blinking caret
P._blinkReset = function () { this._cursorOn = true; if (!this.isEditing) return; clearInterval(this._blink); this._blink = setInterval(() => { this._cursorOn = !this._cursorOn; this.canvas?.requestRenderAll?.(); }, BLINK); };

// ---- entering and leaving
P.enterEditing = function () {
  if (this.isEditing || !this.editable) return this;
  this.isEditing = true; this._undo = { past: [], future: [], kind: null, at: 0 }; this._textBefore = this.text;
  this._kept = { hasControls: this.hasControls, selectable: this.selectable, lockMovementX: this.lockMovementX, lockMovementY: this.lockMovementY };
  this.hasControls = this.selectable = false; this.lockMovementX = this.lockMovementY = true;
  const ta = this.hiddenTextarea = document.createElement('textarea'), n = graphemes(this.text).length;
  ta.setAttribute('wrap', 'off'); ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocomplete', 'off'); ta.setAttribute('spellcheck', 'false'); ta.setAttribute('data-kb-editor', '');
  ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;resize:none;overflow:hidden;pointer-events:none;';
  ta.addEventListener('input', () => this._onInput());
  ta.addEventListener('keydown', e => this._onKey(e));
  ta.addEventListener('copy', e => this._onCopy(e, false)); ta.addEventListener('cut', e => this._onCopy(e, true)); ta.addEventListener('paste', e => this._onPaste(e));
  ta.addEventListener('compositionstart', () => { this._snapshot(); this._composing = true; });
  ta.addEventListener('compositionend', () => { this._composing = false; if (this._undo) this._undo.kind = null; this._syncTextarea(); });
  document.body.appendChild(ta);
  this._setSel(clamp(this.selectionStart, 0, n), clamp(this.selectionEnd, 0, n)); ta.value = this.text; this._syncTextarea(); ta.focus({ preventScroll: true });
  this._blinkReset(); this._placeTextarea();
  this.fire('editing:entered', { target: this }); this.canvas?.fire('text:editing:entered', { target: this }); this.canvas?.requestRenderAll?.();
  return this;
};
P.exitEditing = function () {
  if (!this.isEditing) return this;
  this.isEditing = false; clearInterval(this._blink); this._composing = false;
  this.hiddenTextarea?.remove(); this.hiddenTextarea = null; Object.assign(this, this._kept); this._undo = null;
  this.selectionEnd = this.selectionStart; this._anchor = this._focus = this.selectionStart;
  const changed = this.text !== this._textBefore;
  this.fire('editing:exited', { target: this }); if (changed) this.fire('modified', { target: this });
  if (this.canvas) { this.canvas.fire('text:editing:exited', { target: this }); if (changed) this.canvas.fire('object:modified', { target: this }); this.canvas.requestRenderAll?.(); }
  return this;
};

// ---- caret and selection on the canvas (drawn in the object's own space)
P._renderSelection = function (ctx) {
  ctx.fillStyle = this.selectionColor;
  this._lines.forEach((_, i) => {
    const [a, b] = this._lineBounds(i), from = Math.max(a, this.selectionStart), to = Math.min(b, this.selectionEnd);
    if (to < from || (to === from && !(this.selectionStart <= a && this.selectionEnd > b))) return;
    const x0 = this._xOf(i, from), x1 = to === b && this.selectionEnd > b ? -this.width / 2 + this._lineLeftOffset(i) + this.__lineWidths[i] + this.fontSize * 0.3 : this._xOf(i, to); // a selected line break shows as a little extra
    ctx.fillRect(x0, this._lineTop(i), x1 - x0, this._lineHeight(i));
  });
};
P._renderCursor = function (ctx) {
  if (this.selectionStart !== this.selectionEnd) return;
  const p = this._caretPoint(this.selectionStart), ln = this._lines[p.line], base = this._paraStarts()[ln.line], at = Math.max(0, this.selectionStart - base - 1);
  const st = this.getCompleteStyleDeclaration(ln.line, ln.chars.length ? at : 0), color = this.cursorColor || (typeof st.fill === 'string' ? st.fill : '#000');
  const w = this.cursorWidth / Math.max(Math.abs(this.scaleX), 1e-6);
  ctx.fillStyle = color; ctx.fillRect(p.x - w / 2, p.y, w, this.__lineHeights[p.line]);
};

// ---- mouse: double-click enters, click and drag place the caret and select, double and triple click pick word and line
kbe.attachTextEditing = function (canvas, el) {
  canvas.element = el;
  const scene = e => { const r = el.getBoundingClientRect(); let p = { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; const v = canvas.viewportTransform; if (v) p = kbe.util.transformPoint(p, kbe.util.invertTransform(v)); return p; };
  const local = (o, p) => kbe.util.transformPoint(p, kbe.util.invertTransform(o.calcTransformMatrix()));
  const inside = (o, p) => { const q = local(o, p); return Math.abs(q.x) <= o.width / 2 && Math.abs(q.y) <= o.height / 2; };
  const hit = p => [...canvas._objects].reverse().find(o => o.visible !== false && o instanceof Textbox && inside(o, p));
  const offsetOf = (o, p) => { const q = local(o, p); return o._offsetAt(q.x, q.y); };
  const editing = () => canvas._objects.find(o => o.isEditing);
  let drag = null;
  el.addEventListener('dblclick', e => {
    const p = scene(e), o = hit(p); if (!o || !o.editable || o.isEditing) return;
    o.enterEditing(); o.selectWord(offsetOf(o, p)); canvas.fire('mouse:dblclick', { target: o, e });
  });
  el.addEventListener('mousedown', e => {
    const cur = editing(); if (!cur) return;
    const p = scene(e);
    if (!inside(cur, p)) { cur.exitEditing(); return; }
    e.preventDefault(); cur._editDown(p, e.detail, e.shiftKey); if (e.detail < 2 && !e.shiftKey) drag = cur;
  });
  document.addEventListener('mousemove', e => { if (drag?.isEditing) drag._editMove(scene(e)); });
  document.addEventListener('mouseup', () => { drag = null; });
  return canvas;
};
})();
