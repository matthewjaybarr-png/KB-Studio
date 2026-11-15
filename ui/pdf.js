// KB Studio's own PDF writer (MIT). It writes only what Create's export needs: pages of any size in inches, JPEG pictures
// placed on them (one copy of each picture however often it is used), clickable link boxes, and plain grey lines for crop marks.
// shortcut: JPEG pictures only (gray/RGB/CMYK as stored), no text, no fonts; add them here if a feature ever needs them.
(function () {
  const PT = 72, enc = new TextEncoder();
  const num = n => (Math.round(n * 1000) / 1000).toString();

  // Width, height and colour channels of a JPEG, read from its first start-of-frame marker.
  function jpegInfo(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('not a JPEG');
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: b[i + 5] << 8 | b[i + 6], w: b[i + 7] << 8 | b[i + 8], n: b[i + 9] };
      i += 2 + (b[i + 2] << 8 | b[i + 3]);
    }
    throw new Error('JPEG has no size');
  }
  const bytesOf = src => {
    if (src instanceof Uint8Array) return src;
    const s = String(src);
    return Uint8Array.from(atob(s.slice(s.indexOf(',') + 1)), c => c.charCodeAt(0));
  };
  // A PDF string literal: ASCII only (anything else percent-encoded, as links should be), with \ ( ) escaped.
  const literal = s => '(' + encodeURI(s).replace(/[\\()]/g, '\\$&') + ')';

  class Pdf {
    constructor(size) { this.pages = []; this.images = new Map(); this.gray = 0; this.width = 0.01; this.addPage(size); }
    addPage(size) { this.page = { w: size[0], h: size[1], ops: [], links: [], pics: new Set() }; this.pages.push(this.page); }
    setDrawColor(g) { this.gray = g / 255; }
    setLineWidth(w) { this.width = w; }
    // x, y, w, h in inches from the page's top-left corner, like the screen.
    addImage(src, x, y, w, h, alias) {
      let img = this.images.get(alias);
      if (!img) { const data = bytesOf(src); img = { ...jpegInfo(data), data, name: 'Im' + (this.images.size + 1) }; this.images.set(alias, img); }
      this.page.pics.add(img);
      this.page.ops.push(`q ${num(w * PT)} 0 0 ${num(h * PT)} ${num(x * PT)} ${num((this.page.h - y - h) * PT)} cm /${img.name} Do Q`);
    }
    line(x1, y1, x2, y2) {
      const H = this.page.h;
      this.page.ops.push(`${num(this.gray)} G ${num(this.width * PT)} w ${num(x1 * PT)} ${num((H - y1) * PT)} m ${num(x2 * PT)} ${num((H - y2) * PT)} l S`);
    }
    link(x, y, w, h, { url }) { this.page.links.push({ x, y, w, h, url }); }

    output() {
      const objs = []; // objs[i] holds the body of object i + 1
      const add = body => objs.push(body) ;
      const idOf = () => objs.length + 1;
      add(null); add(null); // 1 Catalog, 2 Pages, filled in below
      const imgIds = new Map();
      for (const img of this.images.values()) {
        imgIds.set(img, idOf());
        const space = img.n === 1 ? '/DeviceGray' : img.n === 4 ? '/DeviceCMYK' : '/DeviceRGB';
        const decode = img.n === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''; // Adobe-style CMYK JPEGs are stored inverted
        add([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace ${space}${decode} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`), img.data, enc.encode('\nendstream')]);
      }
      const pageIds = [];
      for (const p of this.pages) {
        const content = enc.encode(p.ops.join('\n'));
        const contentId = idOf();
        add([enc.encode(`<< /Length ${content.length} >>\nstream\n`), content, enc.encode('\nendstream')]);
        const annots = p.links.map(l => {
          const id = idOf();
          const r = [l.x, p.h - l.y - l.h, l.x + l.w, p.h - l.y].map(v => num(v * PT)).join(' ');
          add(`<< /Type /Annot /Subtype /Link /Rect [${r}] /Border [0 0 0] /A << /S /URI /URI ${literal(l.url)} >> >>`);
          return id;
        });
        const pic = [...p.pics].map(img => `/${img.name} ${imgIds.get(img)} 0 R`).join(' ');
        pageIds.push(idOf());
        add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w * PT)} ${num(p.h * PT)}] /Resources << /XObject << ${pic} >> >> /Contents ${contentId} 0 R${annots.length ? ` /Annots [${annots.map(a => a + ' 0 R').join(' ')}]` : ''} >>`);
      }
      objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
      objs[1] = `<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;

      const out = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; // the high-bit bytes mark the file as binary
      let at = out[0].length;
      const offsets = [];
      objs.forEach((body, i) => {
        offsets.push(at);
        const parts = [enc.encode(`${i + 1} 0 obj\n`), ...(Array.isArray(body) ? body : [enc.encode(body)]), enc.encode('\nendobj\n')];
        for (const part of parts) { out.push(part); at += part.length; }
      });
      let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n';
      out.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`));
      const all = new Uint8Array(out.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of out) { all.set(p, o); o += p.length; }
      return all;
    }
  }
  window.KBPdf = Pdf;
})();
