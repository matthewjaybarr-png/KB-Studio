// A picture as an engine object: kbe.FabricImage wraps an <img> or <canvas>, draws the cropped part of it, saves as `Image` data and loads
// from it (kbe.FabricImage.fromURL / fromObject). Original code. Fabric's image filters are not applied; filters in a saved picture are
// kept and handed back unchanged, so nothing is lost on a round trip.
(function () {
'use strict';
const kbe = globalThis.kbe, { FabricObject } = kbe, { enlivenProps, registry } = kbe.internal;

function loadImage(url, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image(); if (!url) { resolve(img); return; } if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img); img.onerror = () => reject(new Error('could not load the picture ' + String(url).slice(0, 80))); img.src = url;
  });
}

class FabricImage extends FabricObject {
  static ownDefaults = { strokeWidth: 0, srcFromAttribute: false, minimumScaleTrigger: 0.5, cropX: 0, cropY: 0, imageSmoothing: true };
  static get type() { return 'Image'; }
  constructor(element, options = {}) {
    super({ filters: [], ...options });
    this._shadowFirst = true; // drawn with its own shadow by the renderer
    this.setElement(element, options);
  }
  getElement() { return this._element; }
  setElement(element, { width, height } = {}) {
    this._element = element; this._originalElement = element;
    const size = this.getOriginalSize(); this.width = width || size.width; this.height = height || size.height;
    return this;
  }
  getOriginalSize() { const el = this._element; return el ? { width: el.naturalWidth || el.width || 0, height: el.naturalHeight || el.height || 0 } : { width: 0, height: 0 }; }
  getSrc() { const el = this._element; return el ? (this.srcFromAttribute ? el.getAttribute('src') : el.src) : ''; }
  getCrossOrigin() { return this._originalElement && (this._originalElement.crossOrigin || null); }
  async setSrc(src, options = {}) { this.setElement(await loadImage(src, options.crossOrigin), options); return this; }
  _render(ctx) {
    const el = this._element; if (!el) return;
    const { width: nw, height: nh } = this.getOriginalSize(), w = this.width, h = this.height, cx = Math.max(this.cropX, 0), cy = Math.max(this.cropY, 0);
    ctx.imageSmoothingEnabled = this.imageSmoothing !== false;
    ctx.drawImage(el, cx, cy, Math.min(nw - cx, w), Math.min(nh - cy, h), -w / 2, -h / 2, w, h);
  }
  _own() { return { cropX: this.cropX, cropY: this.cropY }; }
  toObject(keys = []) {
    return Object.assign(super.toObject(keys), { src: this.getSrc(), crossOrigin: this.getCrossOrigin(), filters: (this.filters || []).map(f => f.toObject ? f.toObject() : f) });
  }
  static async fromURL(url, { crossOrigin = null } = {}, imageOptions) { return new this(await loadImage(url, crossOrigin), imageOptions); }
  static async fromObject({ type, version, src, crossOrigin = null, filters = [], resizeFilter, ...object }, options) {
    const [img, rest] = await Promise.all([loadImage(src, crossOrigin), enlivenProps(object, options)]);
    return new this(img, { ...rest, filters });
  }
}
// a repeating picture as a fill or stroke: new kbe.Pattern({ source, repeat, offsetX, offsetY, patternTransform })
class Pattern {
  constructor({ source, repeat = 'repeat', offsetX = 0, offsetY = 0, crossOrigin = '', patternTransform = null } = {}) {
    Object.assign(this, { source, repeat, offsetX, offsetY, crossOrigin, patternTransform: patternTransform ? [...patternTransform] : null });
  }
  sourceToString() { const s = this.source; return s && s.src ? (s.getAttribute?.('src') ?? s.src) : s && s.toDataURL ? s.toDataURL() : ''; }
  toObject() { return { type: 'pattern', source: this.sourceToString(), repeat: this.repeat, crossOrigin: this.crossOrigin, offsetX: this.offsetX, offsetY: this.offsetY, patternTransform: this.patternTransform ? [...this.patternTransform] : null }; }
  static async fromObject({ type, source, ...rest }) { return new Pattern({ ...rest, source: await loadImage(source, rest.crossOrigin) }); }
}
kbe.Pattern = Pattern; kbe.util.loadImage = (url, { crossOrigin } = {}) => loadImage(url, crossOrigin); kbe.util.createCanvasElement = () => document.createElement('canvas');
kbe.FabricImage = FabricImage; kbe.Image = FabricImage; registry.set('image', FabricImage); registry.set('fabricimage', FabricImage);
})();
