# KB Studio MIT rebuild (branch `dev`)

Goal: ship KB Studio under MIT with the same features and design, plus features missing
compared with Canva, PhotoCraft and LightCraft. The current app stays until `dev` is proven.

## Licensing facts (checked 2026-11-14)
- PhotoCraft and LightCraft (github.com/storytold) are `MIT OR Apache-2.0`. KB Studio can take
  its PhotoCraft-derived code under the MIT option, with notices kept. No rewrite is needed for MIT.
- The only real MIT blocker is **rawler** (LGPL-2.1, statically linked).
- Fabric.js, jsPDF, qrcode-generator, OkLab: MIT. Fonts (OFL, Roboto Slab Apache-2.0) and Twemoji
  (CC-BY 4.0) are bundled assets with attribution, not code.

## Clean-room rules
- Canva: feature inventory from public UI and help docs only. Never decompile it. Copy no code,
  templates, fonts, icons or wording.
- PhotoCraft and LightCraft: feature behavior may be studied from source and builds (REA allowed);
  new KB Studio code is written fresh, not pasted.
- Design (look, layout, colours) is not changed.

## Milestones (each tested in the Zorin OS VM before the next)
1. Own CR2 reader replacing rawler (TIFF/IFD, lossless-JPEG decode, demosaic, white balance, colour matrix). Needs real CR2 samples.
2. Own PDF writer (DONE: ui/pdf.js).
3. Own QR encoder (DONE: ui/qr.js).
4. Own canvas editor engine replacing Fabric.js (objects, selection, transforms, text, groups,
   serialize/load of existing saved designs, cropping, alignment guides). Largest step; saved
   designs must keep loading (`test-data/create-fabric6.json`).
5. Feature gap list (Canva / PhotoCraft / LightCraft) and Edit photo tab additions. Create's
   Edit photo stays as is.
6. Full ui-check, cargo test, clippy, then the Zorin VM pass before any replacement decision.

## Milestone 4 plan: own canvas engine (measured 2026-11-15)
Current surface: ~10k lines of UI JS call Fabric 6 through about 100 API points. Classes used: Circle 17, Path 15,
Line 15, Rect 14, FabricImage 13 (fromURL), Point 11, Group 10, Shadow 9, Textbox 7, Ellipse 5, Triangle 4, Polygon 3,
Gradient 3, StaticCanvas 4, plus PencilBrush, Control, ActiveSelection, Polyline, FabricText, util.* (transformPoint,
enlivenObjects, invertTransform, groupSVGElements, degreesToRadians), loadSVGFromString. Canvas calls: requestRenderAll,
getObjects, on(...), getZoom, getActiveObject(s), discardActiveObject, getScenePoint, setActiveObject, remove, toObject,
loadFromJSON, insertAt, moveObjectTo, freeDrawingBrush, viewportTransform, zoomToPoint. Events: mouse:down/move/up/out/
over/wheel/dblclick, object:moving/scaling/rotating/modified/added/removed, text:changed/editing:entered/exited,
path:created, before/after:render. Image filters/clipPath in cutout, fills, canva, create, photobar.
fabric-extensions.min.js also pulls in `westures` (gestures); drop it together with Fabric.

Approach: an own engine in `ui/engine/` with a Fabric-shaped subset, so call sites change by search-and-replace only.
Order, each step A/B tested against the current build:
1. Object model + toObject/loadFromJSON (must load `test-data/create-fabric6.json` and every saved design shape).
2. Renderer (rect, circle, ellipse, triangle, line, polygon, polyline, path, group, shadow, gradient, image, clip).
3. Text (Textbox layout, wrapping, fonts, styles) and the in-place text editor (IME, selection, undo).
4. Interaction (hit test, selection, handles, multi-select/ActiveSelection, snapping guides, viewport zoom/pan).
5. Free drawing, SVG import (loadSVGFromString), image filters.
6. Move call sites, delete `ui/vendor/fabric*.js`, `LICENSES/fabric-MIT.txt`, notice rows.
A/B: render every template and saved design in both engines to PNG and pixel-compare; `node ui-check.cjs` green;
Zorin VM pass for each step. Risk: highest of the plan (text editing and selection UX). Note: Fabric is MIT, so this
step is not needed for the MIT goal; it is for "all original code".

### Fabric step 1 DONE 2026-11-15 (uncommitted): object model
`ui/engine/model.js` (global `kbe`, ~410 lines, original code, not loaded by the app yet) has Point, Shadow, Gradient, Rect,
Circle, Ellipse, Triangle, Line, Polygon, Polyline, Path (parser, simplified to absolute M/L/C/Q/Z like Fabric), Group
(fit-content layout), StaticCanvas (add/getObjects/toObject/loadFromJSON), `util.enlivenObjects`, classRegistry, matrix
helpers, clipPath, `ownDefaults` (the app patches originX/Y). `node engine-check.cjs` (headless Chromium, `SEED=n`, `--verbose`)
runs the vendored Fabric 7.4.0 and `kbe` side by side: 673 random and app-style constructions, the same 673 saved by Fabric then
loaded by both, 12 clipPaths, 3 pages (colour/gradient background) and `test-data/create-fabric6.json`; every `toObject` matches
(construction within 1.1e-4, loads exactly). 14 seeds pass. `ui-check.cjs` untouched (no call site changed).
Not yet supported / known gaps:
- Image, Textbox, IText, Text load as `SavedObject` (saved data returned unchanged, version stamp bumped); no layout, drawing, filters (steps 2, 3, 5).
- No rendering, hit testing, selection, events, viewport, free drawing, SVG import, ActiveSelection, Pattern fills, canvas backgroundImage/overlay/clipPath (steps 2-5).
- Quadratic path bounds copy Fabric's box (it treats a Q as a cubic with both controls on the control point, so the box bulges); exact bounds later.
- A newly built Group with skewed children or rotated strokeUniform children measures up to ~0.3 px off Fabric (app uses neither); Group made then scaled/turned matches.
- `strokeUniform` + rotation in `getCoords` and `getBoundingRect` ignore the post-scale stroke exactly; Group layout from live children assumes no nested group.
- Fabric 7.4.0 is the build in `ui/vendor` (the fixture was saved by 6.9.1); `version` stamp is 7.4.0 in both.

### Fabric step 2 DONE 2026-11-15 (uncommitted): renderer
`ui/engine/render.js` draws kbe objects on a 2D canvas: `await kbe.prepare(objects); kbe.render(ctx, objects)` and
`StaticCanvas.renderTo(ctx)` (page colour or gradient first). Covers rect (rounded), circle, ellipse, triangle, line, polygon,
polyline, path, group, gradients (linear, radial, percentage and pixel units, oval percentage radial), shadow, dashes, caps,
joins, strokeUniform, paintFirst, fill rule, opacity, blend mode, backgroundColor, clipPath (relative, absolutePositioned,
inverted) and saved images (crop; pictures loaded by `prepare`). Not loaded by the app yet.
`node engine-render-check.cjs` (`--verbose`, `--dump DIR` writes side-by-side PNGs, `SEED=n`) draws 673 random and app-style
objects, 12 clip cases, the fixture page (text removed) and 2 page backgrounds in Fabric 7.4.0 and in the new renderer on
500x500 canvases and compares pixels per class (a case passes under 2% strongly different pixels). All classes pass on 10
seeds (typical worst 0.1%, the worst random cases 0.5-1.7% from Fabric's cached-bitmap anti-aliasing). `ui-check.cjs` PASS.
`engine-specs.cjs` now holds the shared random specs (also used by `engine-check.cjs`, still 673/673 on 8 seeds).
Behaviours matched on purpose: Fabric draws a top-level object whole at full strength and then lays it on with its opacity and
shadow (so a stroke over a fill does not show an overlap at low opacity); a stroke gets no shadow unless `affectStroke`; a gradient
stop's `opacity` is ignored when drawing (Fabric 7.4 ignores it too, though canva.js saves it); percentage radial gradients are
oval (width by height).
Not yet supported / known gaps:
- Text is drawn by step 3's Textbox (below); IText, Text and FabricText are still saved data only; image filters, `FabricImage` as a real class (images are `SavedObject`s with raw `src`), pattern fills, `gradientTransform`, stroke gradients that are percentage-radial (use the round approximation), canvas backgroundImage/overlay.
- Layers are full-canvas size per top-level object: fine for the A/B, too slow for the editor; the live renderer needs bounded layers and caching (step 4).
- Retina and zoom: `zoom` scales shadows only; viewport transform comes with step 4.
- Skewed objects with strokeUniform in a group, and skew generally, are only lightly tested (the app does not use skew).

### Fabric step 3 DONE 2026-11-15 (uncommitted): text and the text editor
`ui/engine/text.js`: own `Textbox` (registered as `textbox`, same saved JSON as Fabric: styles as runs). Layout (wrapping, width grows to
the longest word, fonts, sizes, line height, alignment incl. the three justify kinds, charSpacing, per-character styles, deltaY,
splitByGrapheme), drawing (backgrounds, underline, overline, linethrough, fill and stroke order, `paintFirst`, gradient fills) and
`toObject`/`fromObject`. `ui/engine/editor.js` adds to it: `enterEditing`, `exitEditing`, `selectAll`, `selectWord`, `selectLine`,
`insertChars`, `removeChars`, `getSelectedText`, `getSelectionStyles`, `setSelectionStyles`, `undo`, `redo`, a blinking caret and
the selection drawn on the canvas, the events `changed`, `selection:changed`, `editing:entered`, `editing:exited`, `modified` on
the object and `text:changed`, `text:editing:entered`, `text:editing:exited`, `text:selection:changed`, `object:modified` on the
canvas (same order as Fabric), `on`/`off`/`fire` on objects and canvases, and `kbe.attachTextEditing(canvas, element)` for
double-click to edit, click, drag, double and triple click, and click outside to leave. How it works: a hidden `<textarea>`
mirrors the text; every native edit (typing, IME, paste, drag-drop, Backspace) arrives as an `input` event that is diffed into
one model edit; movement keys, Ctrl+A/Z/Y and Esc are handled by the editor. New letters take the style of the letter before;
copy/paste inside the app keeps styles (`kbe.styleClipboard`).
Checks:
- `node engine-text-check.cjs` (`--verbose`, `--dump DIR`, `SEED=n`, `SPECFILE=json` for chosen cases): 140 random texts per seed
  through Fabric 7.4.0 and the own engine: same lines/size/saved JSON, Fabric-saved text loads the same, and the same pixels
  (a case passes under 3% strongly different pixels; typical worst 1-2.6%, on rotated or scaled, strongly styled big text).
  Seeds 4242, 2, 4, 5: 140/140 on all three; seeds 1 and 3: one layout case differs (see gaps).
- `node engine-editor-check.cjs`: 54 behaviour checks in headless Chromium over DevTools with real input: key presses, IME
  (`Input.imeSetComposition` + `insertText`), mouse clicks and drags, copy/cut/paste events (paste is a ClipboardEvent on the
  textarea), undo/redo, emoji, events and their order, caret and selection pixels.
- `engine-check.cjs` (673/673 + the Fabric 6.9.1 fixture) and `engine-render-check.cjs` still pass; `ui-check.cjs` PASS.
Fabric quirks learned: line height is fontSize x 1.13 and the last line is not multiplied by `lineHeight`; the baseline is 22.2% up
from the line bottom; every paragraph wraps to the width the longest word needs; decorations are drawn at offset x size from the
baseline and raised by 0, half and the whole thickness (underline, linethrough, overline); a line's last letter has no trailing
charSpacing (width and decorations); plain `justify` also spreads the last line of a paragraph, `justify-center/right` do not.
Not yet supported / known gaps:
- Right-to-left text and `direction`, text on a path, superscript/subscript, per-character `charSpacing`.
- IText, Text and FabricText are still saved data only (the app uses Textbox).
- Saved style runs count graphemes; Fabric counts UTF-16 units, so runs over emoji differ (rare).
- About 0.2% of random layouts differ (a run in another font inside text with double spaces); about 2% of random pixel cases are 1-3% off.
- The hidden textarea sits at the page corner, so an IME candidate window does not follow the caret (needs canvas coordinates, step 4); no composition underline.
- Caret height and selection look are close to Fabric but not pixel-checked (they are not part of the A/B); no touch handling, no mouse drag-and-drop of selected text, no Page Up/Down.
- Editing needs a `StaticCanvas` with an element attached (`attachTextEditing`); viewport zoom and the real canvas (selection handles, objects dragging) come in step 4.
- Call sites in the app still use Fabric; nothing here is loaded by the app.

## Fabric step 4 DONE (with a justified list of differences)

`ui/engine/canvas.js` (Canvas, Control, ActiveSelection, PencilBrush) and `engine-canvas-check.cjs`
drive real CDP mouse and wheel events through Fabric and the own engine at device scale 1 and 2 and
compare object state (corners, flips, angle, scale), selection, cursor, event log and the pixels of
the lower and top canvas. Pixels and object state match for every step except the one below.
Matching Fabric: move, corner/side scale, Alt-centred scale, rotate and snapping, flip past the
opposite edge, shift/ctrl multi-select, ActiveSelection move/scale/rotate, drag-box, zoom/pan,
`setDimensions`, text-edit clicks (mouse:up comes before text:editing:entered), z-order, drawing
path, cursors (including the one left after a drag ends outside every object, and the resize cursor
on a turned object). `engine-editor-check.cjs` now also checks that the IME box follows the caret.

Differences that stay, and why:
- Hover over/out at a handle on an object's rim or just after a finished transform: Fabric fires
  `out:X, over:X` on the same object, or an extra `out` for the previously hovered one. The app only
  keeps a hovered outline from `mouse:over` and clears it on `mouse:out` (create.js 211-212), and an
  out+over pair leaves the same end state. Not copied.
- After a turned ActiveSelection loses one object, a remaining child's own angle differs (20 vs
  40.09 in the check); the drawn result is the same. Own rebuilds the selection around the page
  coordinates; the app reads no child angle while a selection is live. Not copied.
Not supported: skew handles, subTargetCheck, touch, objectCaching, an
ActiveSelection that keeps its angle when objects are added to it.

## Fabric step 5 DONE (uncommitted)

New files `ui/engine/svg.js` (SVG import) and `ui/engine/image.js` (FabricImage, Pattern, loadImage), checked by `engine-svg-check.cjs`
(Fabric and own side by side: saved data and pixels, 81 cases plus 2 known differences).
- `kbe.loadSVGFromString` returns `{ objects, options, elements, allElements }` like Fabric; `kbe.util.groupSVGElements`; reads rect, circle,
  ellipse, line, polyline, polygon, path, g (nested, with inherited fill/stroke/width/dash/cap/join/miter/fill-rule/opacities, the style
  attribute, transforms, the viewBox). Every decoration SVG of `ui/decor.js` is compared, plus nested transforms, styles, polys, paths, opacity.
- `kbe.FabricImage` is a real class (`type` 'image', saved as `Image`): constructor(element, options), fromURL, fromObject, setSrc, getElement,
  getSrc, getCrossOrigin, crop, shadow, clipPath, flips, groups. Saved filters are kept and handed back, not applied.
- `kbe.Pattern` (fill and stroke, repeat modes, offsets, patternTransform, saved data); `gradientTransform` for fills and strokes (pixel and
  percentage units); util: degreesToRadians, radiansToDegrees, loadImage, createCanvasElement, qrDecompose, parseTransform.
- Also changed: an instance's `type` is now lower case ('rect', 'image', 'textbox', 'activeselection') like Fabric, since the app compares
  `o.type === 'image'`; saved data and class names keep their capitals. `scale(v)` added to objects.
Kept differences: a percentage-unit gradient on a stroke (Fabric strokes with a line hundreds of times too wide; the app never does this).
Not supported: SVG gradients, patterns, clip paths, masks, text, use and images inside an SVG file; Fabric image filters (Brightness etc.)
and resizeFilter; preserveAspectRatio other than the default; units other than plain numbers in SVG lengths.

## Fabric step 6 verification (call sites moved to kbe; vendored Fabric still in the tree until the gate was green)

Call sites: every `fabric.X` / `fabricExtensions.X` in `ui/*.js` and `ui-check.cjs` became `kbe.X`; `index.html` and ui-check's page load
`ui/engine/{model,render,text,editor,canvas,image,svg,extras}.js`. Calls that needed more than a rename (notes also in the side-session folder):
AligningGuidelines and enterCropMode (new `ui/engine/extras.js`, written from how the app uses them), FabricText (charts.js: no wrapping, saved
type 'Text'), Textbox `_fontSizeMult`/`_fontSizeFraction` (canva.js baselineShift), StaticCanvas export (toDataURL/toCanvasElement/dispose/getWidth
/getHeight/setDimensions), Group removeAll/size/contains/item, Control positionHandler/shouldActivate, transform.original with cropX/cropY, object
`before:render`. Engine fixes found by running the app: `getCenterPoint` is the page position for a member of a group/selection (new
`getRelativeCenterPoint` for internals), `Canvas.toObject` saves selection members at their page position (autosave would have saved
selection-relative left/top), StaticCanvas export size is truncated like Fabric (600x428 not 429), `loadImage(undefined)` resolves an empty image like
Fabric (a saved picture without a source loaded in ui-check), and a per-object layer that is only as large as the object can show (was full canvas).

| Check | Result |
|---|---|
| `node ui-check.cjs` | PASS (run 12; runs 5/6 failed once each at the photos "reopening reuses cached thumbnails" step on a loaded machine, passed on re-run) |
| `engine-check` | clip 12/12, canvas 3/3, fixture 1/1 |
| `engine-render-check` | PASS: clipPath 12/12, fixture page 1/1 (0.01% strong), page background 2/2 |
| `engine-text-check` | PASS: layout 140/140, load 140/140, pixels 140/140 |
| `engine-editor-check` | PASS: 56/56 |
| `engine-svg-check` | PASS: 81/83 and 2 known differences (percentage gradient on a stroke, above) |
| `engine-canvas-check` | 69/90 steps match; the 21 that differ are the two documented classes (hover over/out pair at a handle or after a transform; one child angle after a turned selection loses an object), unchanged from step 4 |
| `engine-extras-check` (new, real mouse events, dpr 1 and 2) | PASS: 54/54 (guideline snapping on move and resize, all 12 crop controls, pan, re-arm on double click). Crop mode is compared with the guides off: Fabric's guides snap the frame while a picture is panned (stale corners, a bug), the own ones leave it |
| `engine-perf-check` (new; 90 objects, frame flushed with a read-back) | dpr 1: Fabric 23.07 ms, own 15.70 ms (0.68x); dpr 2: Fabric 38.10 ms, own 40.84 ms (1.07x); limit 1.5x. Without the read-back both look 100x apart because drawing is deferred; the number above is the real one |
| `engine-app-check` (new: whole app old=main/Fabric vs new, same scripts) | PASS 122/122, selftest ok (identical 0.0000% strong; one object moved 3 px 1.34% strong and a JSON diff): 28 starters, 64 items+fixture (shapes, combos, frames, grids, charts, text, `create-fabric6.json`), 27 sheet generators (every SHEET_KINDS entry plus word search, crossword, math, fixed seed, 4 pages), ops (add, group, ungroup, copy/paste, duplicate, undo x2, redo, align, reorder, delete: JSON at every step identical), exports (makePdf structure, JPEG), roundtrip (load, toObject, load again: stable, same as Fabric) |
| Worst pixel case | starter:Word wall 2.595% strong pixels (threshold 3%), item combos 0.41%, ops 0.24%, tenframe 1.46%. Dumped and looked at: hair-thin edges only; saved JSON of every case is identical (numbers within 0.001, random table id ignored). Cause: Fabric snaps its cached object bitmaps to whole pixels, own draws exactly. Harmless |
| `cargo test --release` | 182 passed, 0 failed, 10 ignored |
| `cargo clippy --all-targets` | clean |
| Omarchy dev build (host target dir, copied to `~/.local/share/kbs-dev`) | built in 66 s; launched with `kbs-dev` on a hidden monitor, Start and Create screens render (0.52.2) |
| Zorin OS pass (Ubuntu 22.04 build in podman, CD in the VM, isolated XDG dirs) | binary built (webkit2gtk 4.1); launched; Create: shapes added, moved, scaled; group and undo; heading typed and edited; picture imported from a CD file; crop dialog (handles, edge drag, apply); SVG decoration; chart, 3x4 table, QR code; undo x2 and redo x2; Download PDF (1 page, opened in the guest viewer, matches) and PNG (2550x3300); renamed, went Start, reopened the design from Recent, identical. Cleaned up: app killed, guest temp files removed, CD ejected, ISOs and source copies deleted, VM shut down |

Differences kept (each harmless or an improvement): FabricText has no wrapping; skew handles, subTargetCheck, touch and objectCaching are not
supported; Fabric `on()` does not return a disposer here; Group.add/remove/insertAt are not implemented (the app does not call them); PDF is written
by the app's own `pdf.js` (since step 3), MediaBox is written `612 792` not `612. 792.`. Not done: rotating a shape in the VM by hand (covered
by `engine-canvas-check` and `engine-extras-check` with real mouse events).

## Fabric step 6 DONE 2026-11-15 (uncommitted)

The gate above was green before anything was deleted. Then: `git rm` of `ui/vendor/fabric.min.js`, `ui/vendor/fabric-extensions.min.js` (bundles westures)
and `LICENSES/fabric-MIT.txt`; the Fabric row is gone from `THIRD_PARTY_NOTICES.md`; no script tag or ui-check replacement names them (the app now
loads only `ui/engine/*.js`); `ui/vendor/` no longer exists; AGENTS.md updated. The A/B harnesses read Fabric 7.4.0 from git history through
`fabric-ref.cjs` (tag v0.52.2, a temp-folder copy, never in `ui/`; `FABRIC_REF`, `FABRIC`, `FABRIC_EXT` override). `engine-app-check.cjs` still builds the
old app with `git archive main`: when main no longer has Fabric, pass `OLD_UI=<unpacked ui folder of v0.52.2>`.
Re-run on the final tree, all unchanged: ui-check PASS; engine-check 673+12+3+1; render, text 140x3, editor 56/56, svg 81/83 (+2 known), extras 54/54;
canvas 69/90 (documented classes); perf 0.72x/0.70x (dpr 1), 1.07x/1.03x (dpr 2); app A/B 122/122 (worst 2.595%); cargo test 182 passed; clippy 0 warnings.
Omarchy dev copy rebuilt from the final tree (25 s) and launched: Create opens. Not done by me: committing, tagging, a release build, a Zorin pass of
the final tree (the Zorin pass ran before the deletion; the deletion removed files the app no longer loads).

### Release prep 2026-11-15 (uncommitted)
- Code review of `extras.js`/`render.js`: 10 findings, 9 fixed (NaN crop corner, double `enterCropMode`, layer padding, shadow reach cap 2048, pooled layers, Map-keyed guides, once-per-event visible rect, dead `sign`, `watched()` helper). Skipped on purpose: `prepare()` rejects on an undecodable picture, as Fabric does; a visible error beats silently dropping a picture from her export.
- Re-run on the fixed tree, all green: engine-check 673/673, editor 56/56, render, text 140x3, extras 54/54, svg 81/83 (2 known), app-check 122/122 (worst 2.6% strong), ui-check, cargo test 182 pass, clippy clean. engine-canvas-check 69/90 = the same 21 documented hover/child-angle steps.
- Perf dpr 2 (pool added): 1.36x then 1.16x on a re-run (noise); dpr 1 0.73-0.78x. Limit 1.5x.
- Licence: root `LICENSE` (MIT, "KB Studio contributors"), `license = "MIT"` in Cargo.toml, README Licence section. `cargo tree` shows no GPL/LGPL. PhotoCraft code is MIT-or-Apache, taken under MIT, notice kept in THIRD_PARTY_NOTICES.md.
- NOT done: run against her real designs (only fixtures and the isolated dev home); no commit, tag or push.
