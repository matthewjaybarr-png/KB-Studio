//! Canon CR2 reader, KB Studio's own code (MIT).
//!
//! Written from the public TIFF 6.0 and ITU-T T.81 (lossless JPEG, SOF3) specifications and from
//! the layout observed in real Canon files: IFD0 holds the full-size JPEG preview, IFD3 holds the
//! sensor data as one lossless JPEG whose samples are laid out in vertical slices.

use std::ops::Range;

const SHORT: u16 = 3;
const LONG: u16 = 4;

/// One TIFF directory entry; `data` is where its value bytes live (inline or by offset).
struct Entry {
    tag: u16,
    ty: u16,
    count: usize,
    data: Range<usize>,
}

fn u16_at(d: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(d.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(d: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(at..at + 4)?.try_into().ok()?))
}

impl Entry {
    /// The `i`th SHORT or LONG value.
    fn num(&self, d: &[u8], i: usize) -> Option<u32> {
        if i >= self.count {
            return None;
        }
        match self.ty {
            SHORT => u16_at(d, self.data.start + i * 2).map(u32::from),
            LONG => u32_at(d, self.data.start + i * 4),
            _ => None,
        }
    }
}

/// The directory at `at`, plus the offset of the next one (0 when last).
fn read_ifd(d: &[u8], at: usize) -> Option<(Vec<Entry>, usize)> {
    let n = u16_at(d, at)? as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let e = at + 2 + i * 12;
        let (tag, ty, count) = (u16_at(d, e)?, u16_at(d, e + 2)?, u32_at(d, e + 4)? as usize);
        let size = count.checked_mul(match ty {
            1 | 2 | 6 | 7 => 1,
            SHORT | 8 => 2,
            LONG | 9 | 11 | 13 => 4,
            _ => 8,
        })?;
        let start = if size <= 4 { e + 8 } else { u32_at(d, e + 8)? as usize };
        let end = start.checked_add(size)?;
        d.get(start..end)?; // reject entries that point outside the file
        out.push(Entry { tag, ty, count, data: start..end });
    }
    Some((out, u32_at(d, at + 2 + n * 12)? as usize))
}

fn find(es: &[Entry], tag: u16) -> Option<&Entry> {
    es.iter().find(|e| e.tag == tag)
}

/// The IFDs of a CR2 in file order (IFD0..), after checking the header.
fn directories(d: &[u8]) -> Result<Vec<Vec<Entry>>, String> {
    if d.get(0..4) != Some(b"II*\0") || d.get(8..10) != Some(b"CR") {
        return Err("not a Canon CR2 file".into());
    }
    let mut at = u32_at(d, 4).ok_or("CR2 truncated")? as usize;
    let mut out = Vec::new();
    while at != 0 && out.len() < 8 {
        let (es, next) = read_ifd(d, at).ok_or("CR2 directory unreadable")?;
        out.push(es);
        at = next;
    }
    Ok(out)
}

/// EXIF orientation (1-8) from IFD0; 1 when absent.
pub fn orientation(d: &[u8]) -> Result<u16, String> {
    let ifds = directories(d)?;
    Ok(ifds
        .first()
        .and_then(|e| find(e, 0x112))
        .and_then(|e| e.num(d, 0))
        .map_or(1, |v| v as u16))
}

/// The full-size JPEG stored in IFD0.
pub fn preview(d: &[u8]) -> Result<&[u8], String> {
    let ifds = directories(d)?;
    let ifd0 = ifds.first().ok_or("CR2 has no embedded preview")?;
    let (Some(off), Some(len)) = (find(ifd0, 0x111), find(ifd0, 0x117)) else {
        return Err("CR2 has no embedded preview".into());
    };
    let (off, len) = (off.num(d, 0).unwrap_or(0) as usize, len.num(d, 0).unwrap_or(0) as usize);
    let jpeg = d.get(off..off.saturating_add(len)).ok_or("CR2 preview unreadable")?;
    if !jpeg.starts_with(&[0xFF, 0xD8]) {
        return Err("CR2 embedded preview is not a JPEG".into());
    }
    Ok(jpeg)
}

/// The sensor samples exactly as stored: `width * height` values, row-major, no black-level
/// subtraction, optical-black borders included.
pub struct Mosaic {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u16>,
}

/// Decode the sensor data of a CR2.
pub fn mosaic(d: &[u8]) -> Result<Mosaic, String> {
    let ifds = directories(d)?;
    let raw = ifds.get(3).ok_or("CR2 has no sensor data")?;
    let (Some(off), Some(len)) = (find(raw, 0x111), find(raw, 0x117)) else {
        return Err("CR2 has no sensor data".into());
    };
    let (off, len) = (off.num(d, 0).unwrap_or(0) as usize, len.num(d, 0).unwrap_or(0) as usize);
    let strip = d.get(off..off.saturating_add(len)).ok_or("CR2 sensor data is cut off")?;
    // Canon's slice table: [number of full slices, full width, last width].
    let slices = find(raw, 0xC640).map_or([0, 0, 0], |e| {
        [0, 1, 2].map(|i| e.num(d, i).unwrap_or(0) as usize)
    });
    decode_lossless(strip, slices)
}

struct Huffman {
    /// 12-bit prefix -> (code length << 8 | symbol); 0 means longer than 12 bits.
    fast: Vec<u16>,
    /// Canonical decoding for codes longer than 12 bits.
    maxcode: [i32; 18],
    valptr: [i32; 17],
    mincode: [i32; 17],
    symbols: Vec<u8>,
}

impl Huffman {
    fn new(counts: &[u8], symbols: &[u8]) -> Result<Self, String> {
        let mut h = Huffman {
            fast: vec![0; 1 << 12],
            maxcode: [-1; 18],
            valptr: [0; 17],
            mincode: [0; 17],
            symbols: symbols.to_vec(),
        };
        let (mut code, mut k) = (0i32, 0usize);
        for len in 1..=16usize {
            let n = counts[len - 1] as usize;
            h.valptr[len] = k as i32;
            h.mincode[len] = code;
            for _ in 0..n {
                if code >= 1 << len || k >= symbols.len() {
                    return Err("bad Huffman table".into());
                }
                if len <= 12 {
                    let base = (code as usize) << (12 - len);
                    for slot in &mut h.fast[base..base + (1 << (12 - len))] {
                        *slot = ((len as u16) << 8) | symbols[k] as u16;
                    }
                }
                code += 1;
                k += 1;
            }
            h.maxcode[len] = if n > 0 { code - 1 } else { -1 };
            code <<= 1;
        }
        Ok(h)
    }
}

/// MSB-first bit reader over JPEG entropy data: undoes FF00 stuffing, feeds zeros at a marker.
struct Bits<'a> {
    d: &'a [u8],
    pos: usize,
    acc: u64,
    n: u32,
}

impl Bits<'_> {
    fn fill(&mut self) {
        while self.n <= 56 {
            let mut b = 0;
            if let Some(&v) = self.d.get(self.pos) {
                if v == 0xFF && self.d.get(self.pos + 1) == Some(&0) {
                    b = 0xFF;
                    self.pos += 2;
                } else if v != 0xFF {
                    b = v;
                    self.pos += 1;
                }
                // else a marker: stay put and feed zeros
            }
            self.acc |= (b as u64) << (56 - self.n);
            self.n += 8;
        }
    }

    fn peek(&mut self, bits: u32) -> u32 {
        if self.n < bits {
            self.fill();
        }
        (self.acc >> (64 - bits)) as u32
    }

    fn skip(&mut self, bits: u32) {
        self.acc <<= bits;
        self.n -= bits;
    }

    fn take(&mut self, bits: u32) -> u32 {
        if bits == 0 {
            return 0;
        }
        let v = self.peek(bits);
        self.skip(bits);
        v
    }

    /// One difference value coded as a Huffman category then that many raw bits (T.81 F.2.2.1).
    fn diff(&mut self, h: &Huffman) -> Result<i32, String> {
        let look = self.peek(12) as usize;
        let ent = h.fast[look];
        let cat = if ent != 0 {
            self.skip((ent >> 8) as u32);
            (ent & 0xFF) as u32
        } else {
            let code = self.peek(16) as i32;
            let mut len = 13;
            loop {
                if len > 16 {
                    return Err("bad Huffman code in sensor data".into());
                }
                let c = code >> (16 - len);
                if h.maxcode[len] >= 0 && c <= h.maxcode[len] && c >= h.mincode[len] {
                    self.skip(len as u32);
                    break h.symbols[(h.valptr[len] + c - h.mincode[len]) as usize] as u32;
                }
                len += 1;
            }
        };
        Ok(match cat {
            0 => 0,
            16 => 32768,
            _ => {
                let bits = self.take(cat) as i32;
                if bits < 1 << (cat - 1) { bits - (1 << cat) + 1 } else { bits }
            }
        })
    }
}

/// Decode one lossless JPEG (SOF3) scan and lay its samples out as Canon's slices.
fn decode_lossless(j: &[u8], slices: [usize; 3]) -> Result<Mosaic, String> {
    if j.get(0..2) != Some(&[0xFF, 0xD8]) {
        return Err("sensor data is not a JPEG".into());
    }
    let mut tables: [Option<Huffman>; 4] = Default::default();
    let (mut precision, mut lines, mut samples, mut comps) = (0u32, 0usize, 0usize, 0usize);
    let mut scan = None; // (component -> table id, predictor, point transform, data start)
    let mut at = 2;
    while scan.is_none() {
        if j.get(at) != Some(&0xFF) {
            return Err("sensor JPEG is malformed".into());
        }
        let marker = *j.get(at + 1).ok_or("sensor JPEG is cut off")?;
        let len = u16::from_be_bytes([*j.get(at + 2).ok_or("sensor JPEG is cut off")?, *j.get(at + 3).ok_or("cut off")?]) as usize;
        let seg = j.get(at + 4..at + 2 + len).ok_or("sensor JPEG is cut off")?;
        match marker {
            0xC3 => {
                if seg.len() < 6 {
                    return Err("bad SOF3".into());
                }
                precision = seg[0] as u32;
                lines = u16::from_be_bytes([seg[1], seg[2]]) as usize;
                samples = u16::from_be_bytes([seg[3], seg[4]]) as usize;
                comps = seg[5] as usize;
            }
            0xC0..=0xCF if marker != 0xC4 && marker != 0xC8 && marker != 0xCC => {
                return Err("sensor data is not lossless JPEG".into());
            }
            0xC4 => {
                let mut s = seg;
                while s.len() > 17 {
                    let (class_id, counts) = (s[0], &s[1..17]);
                    let total: usize = counts.iter().map(|&c| c as usize).sum();
                    let syms = s.get(17..17 + total).ok_or("bad DHT")?;
                    if class_id >> 4 == 0 && (class_id & 15) < 4 {
                        tables[(class_id & 15) as usize] = Some(Huffman::new(counts, syms)?);
                    }
                    s = &s[17 + total..];
                }
            }
            0xDA => {
                let ns = *seg.first().ok_or("bad SOS")? as usize;
                let comp_tables: Vec<usize> = (0..ns)
                    .map(|i| (*seg.get(2 + i * 2).unwrap_or(&0) >> 4) as usize & 3)
                    .collect();
                let predictor = *seg.get(1 + ns * 2).ok_or("bad SOS")?;
                let transform = seg.get(3 + ns * 2).map_or(0, |v| v & 15) as u32;
                scan = Some((comp_tables, predictor, transform, at + 2 + len));
            }
            _ => {}
        }
        at += 2 + len;
    }
    let (comp_tables, predictor, transform, start) = scan.unwrap_or_default();
    if comps == 0 || comp_tables.len() != comps || lines == 0 || samples == 0 {
        return Err("sensor JPEG has no usable frame".into());
    }
    if predictor != 1 || !(2..=16).contains(&precision) {
        return Err(format!("unsupported lossless JPEG (predictor {predictor}, {precision}-bit)"));
    }
    let width = samples * comps;
    let tabs: Vec<&Huffman> = comp_tables
        .iter()
        .map(|&t| tables[t].as_ref().ok_or("missing Huffman table"))
        .collect::<Result<_, _>>()?;

    // Canon slices: samples arrive in vertical strips, each `lines` rows tall.
    let (full, w1, w2) = if slices[0] > 0 { (slices[0], slices[1], slices[2]) } else { (0, width, width) };
    if full * w1 + w2 != width {
        return Err("CR2 slice table does not match the frame".into());
    }
    let mut out = vec![0u16; width * lines];
    let mut bits = Bits { d: j.get(start..).ok_or("sensor JPEG is cut off")?, pos: 0, acc: 0, n: 0 };
    let initial = 1i32 << (precision - transform - 1);
    let mut left = vec![0i32; comps];
    let mut above = vec![0i32; comps]; // first sample of the previous row, per component
    let mut linear = 0usize;
    for row in 0..lines {
        for col in 0..samples {
            for c in 0..comps {
                let diff = bits.diff(tabs[c])?;
                let pred = match (row, col) {
                    (0, 0) => initial,
                    (_, 0) => above[c],
                    _ => left[c],
                };
                let v = (pred + diff) & 0xFFFF;
                left[c] = v;
                if col == 0 {
                    above[c] = v;
                }
                // Where this sample sits on the sensor.
                let (strip, local) = if full > 0 {
                    let s = (linear / (w1 * lines)).min(full);
                    (s, linear - s * w1 * lines)
                } else {
                    (0, linear)
                };
                let sw = if strip >= full { w2 } else { w1 };
                let (y, x) = (local / sw, local % sw + strip * w1);
                out[y * width + x] = (v << transform) as u16;
                linear += 1;
            }
        }
    }
    Ok(Mosaic { width, height: lines, data: out })
}

// ---- Develop: sensor samples to linear sRGB ----------------------------------------------

/// Which colour (0 red, 1 green, 2 blue) the sensor sample at absolute (x, y) measures, by
/// parity: index `(y & 1) * 2 + (x & 1)`. The EOS 2000D's mosaic.
// shortcut: one Canon body (EOS 2000D) is known; add a table keyed by model when another arrives.
const CFA: [usize; 4] = [1, 2, 0, 1];

/// D65 XYZ-to-camera matrix for the EOS 2000D, a camera constant (row-major).
// shortcut: single camera; same table question as CFA above.
const XYZ_TO_CAM: [f32; 9] = [0.83, -0.211, -0.112, -0.4917, 1.2694, 0.2482, -0.0938, 0.2141, 0.5666];

const SRGB_TO_XYZ: [f32; 9] = [
    0.412456, 0.357576, 0.180437, 0.212673, 0.715152, 0.072175, 0.019334, 0.119192, 0.950304,
];

fn mul3(a: &[f32; 9], b: &[f32; 9]) -> [f32; 9] {
    let mut o = [0.0; 9];
    for r in 0..3 {
        for c in 0..3 {
            o[r * 3 + c] = (0..3).map(|k| a[r * 3 + k] * b[k * 3 + c]).sum();
        }
    }
    o
}

fn inverse3(m: &[f32; 9]) -> [f32; 9] {
    let det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
    let i = 1.0 / det;
    [
        (m[4] * m[8] - m[5] * m[7]) * i,
        (m[2] * m[7] - m[1] * m[8]) * i,
        (m[1] * m[5] - m[2] * m[4]) * i,
        (m[5] * m[6] - m[3] * m[8]) * i,
        (m[0] * m[8] - m[2] * m[6]) * i,
        (m[2] * m[3] - m[0] * m[5]) * i,
        (m[3] * m[7] - m[4] * m[6]) * i,
        (m[1] * m[6] - m[0] * m[7]) * i,
        (m[0] * m[4] - m[1] * m[3]) * i,
    ]
}

/// What Develop needs besides the samples, read from the Canon maker note.
struct Shot {
    /// Red, green, blue multipliers that make a neutral grey equal (green is 1).
    wb: [f32; 3],
    white: f32,
    /// Black level of each sensor phase (index `(y & 1) * 2 + (x & 1)`), from Canon's R, G1, G2, B.
    black: [f32; 4],
    /// Active image: left, top, width, height.
    crop: (usize, usize, usize, usize),
}

fn shot(d: &[u8]) -> Result<Shot, String> {
    let ifds = directories(d)?;
    let exif = ifds.first().and_then(|e| find(e, 0x8769)).and_then(|e| e.num(d, 0));
    let (mn, _) = exif
        .and_then(|o| read_ifd(d, o as usize))
        .and_then(|(es, _)| find(&es, 0x927C).map(|e| e.data.start))
        .and_then(|o| read_ifd(d, o))
        .ok_or("CR2 has no Canon maker note")?;
    let words = |tag: u16| -> Option<Vec<u32>> {
        let e = find(&mn, tag)?;
        (0..e.count).map(|i| e.num(d, i)).collect()
    };
    let color = words(0x4001).ok_or("CR2 has no colour data")?;
    // Only ColorData version 14 (EOS 2000D) has its offsets checked here.
    if color.first() != Some(&14) || color.len() < 562 {
        return Err(format!("unsupported Canon colour data (version {:?})", color.first()));
    }
    let g = color[64] as f32;
    let sensor = words(0xE0).filter(|s| s.len() > 8).ok_or("CR2 has no sensor info")?;
    let (l, t, r, b) = (sensor[5] as usize, sensor[6] as usize, sensor[7] as usize, sensor[8] as usize);
    if g == 0.0 || r < l || b < t {
        return Err("CR2 colour data is invalid".into());
    }
    Ok(Shot {
        wb: [color[63] as f32 / g, 1.0, color[66] as f32 / g],
        white: color[561] as f32,
        black: {
            let b = |i: usize| color[556 + i] as f32; // R, G1, G2, B
            // phases follow CFA: green, blue / red, green
            [b(1), b(3), b(0), b(2)]
        },
        crop: (l, t, r - l + 1, b - t + 1),
    })
}

/// A CR2 as linear light in sRGB primaries with the camera's white balance, values above 1 kept
/// for highlight recovery, box-averaged down by the smallest whole factor that fits `max_edge`.
/// Returns width, height and pixels, stored sensor-way-up (EXIF orientation not applied).
pub fn develop(d: &[u8], max_edge: usize) -> Result<(usize, usize, Vec<[f32; 3]>), String> {
    use rayon::prelude::*;
    let shot = shot(d)?;
    let m = mosaic(d)?;
    let (cl, ct, cw, ch) = shot.crop;
    if cl < 1 || ct < 1 || cl + cw >= m.width || ct + ch >= m.height {
        return Err("CR2 image area is out of range".into()); // the demosaic reads one sample around
    }
    let black = shot.black;
    // Clip each balanced channel at 1 before demosaic and calibration, as Develop has always
    // done; values above 1 only come back from the colour matrix mixing clipped channels.
    let plane: Vec<f32> = m
        .data
        .par_iter()
        .enumerate()
        .map(|(i, &v)| {
            let (x, y) = (i % m.width, i / m.width);
            let p = (y & 1) * 2 + (x & 1);
            ((v as f32 - black[p]) / (shot.white - black[p]) * shot.wb[CFA[p]]).clamp(0.0, 1.0)
        })
        .collect();

    let mut cam_from_srgb = mul3(&XYZ_TO_CAM, &SRGB_TO_XYZ);
    for row in cam_from_srgb.chunks_mut(3) {
        let s: f32 = row.iter().sum();
        row.iter_mut().for_each(|v| *v /= s);
    }
    let to_srgb = inverse3(&cam_from_srgb);

    // Average of the samples of colour `c` in the 3x3 window around (x, y) (bilinear demosaic).
    let rgb_at = |x: usize, y: usize| -> [f32; 3] {
        let mut sum = [0f32; 3];
        let mut n = [0f32; 3];
        for yy in y - 1..=y + 1 {
            for xx in x - 1..=x + 1 {
                let c = CFA[(yy & 1) * 2 + (xx & 1)];
                sum[c] += plane[yy * m.width + xx];
                n[c] += 1.0;
            }
        }
        [0, 1, 2].map(|c| sum[c] / n[c])
    };

    let f = cw.max(ch).div_ceil(max_edge).max(1);
    let (sw, sh) = (cw / f, ch / f);
    let mut out = vec![[0f32; 3]; sw * sh];
    out.par_chunks_mut(sw.max(1)).enumerate().for_each(|(oy, row)| {
        for (ox, o) in row.iter_mut().enumerate() {
            let mut acc = [0f32; 3];
            for dy in 0..f {
                for dx in 0..f {
                    let p = rgb_at(cl + ox * f + dx, ct + oy * f + dy);
                    for c in 0..3 {
                        acc[c] += p[c];
                    }
                }
            }
            let avg = acc.map(|v| v / (f * f) as f32);
            *o = [0, 1, 2].map(|r| (0..3).map(|c| to_srgb[r * 3 + c] * avg[c]).sum());
        }
    });
    Ok((sw, sh, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny lossless JPEG (2 components, 3 samples, 3 lines) of `linear` in stream order,
    /// using one 5-bit Huffman table whose code for category k is k.
    fn encode(linear: &[u16]) -> Vec<u8> {
        let mut j = vec![0xFF, 0xD8, 0xFF, 0xC3, 0, 14, 16, 0, 3, 0, 3, 2, 1, 0x11, 0, 2, 0x11, 0];
        let mut counts = [0u8; 16];
        counts[4] = 17;
        j.extend_from_slice(&[0xFF, 0xC4, 0, 2 + 1 + 16 + 17, 0]);
        j.extend_from_slice(&counts);
        j.extend(0..17u8);
        j.extend_from_slice(&[0xFF, 0xDA, 0, 10, 2, 1, 0, 2, 0, 1, 0, 0]);
        let (mut acc, mut n) = (0u64, 0u32);
        let mut out = Vec::new();
        let mut put = |bits: u32, len: u32, out: &mut Vec<u8>| {
            acc = acc << len | bits as u64;
            n += len;
            while n >= 8 {
                let b = (acc >> (n - 8)) as u8;
                out.push(b);
                if b == 0xFF {
                    out.push(0);
                }
                n -= 8;
            }
        };
        let (mut left, mut first) = ([0i32; 2], [0i32; 2]);
        for row in 0..3 {
            for col in 0..3 {
                for c in 0..2 {
                    let v = linear[(row * 3 + col) * 2 + c] as i32;
                    let pred = match (row, col) {
                        (0, 0) => 1 << 15,
                        (_, 0) => first[c],
                        _ => left[c],
                    };
                    let diff = ((v - pred + 0x8000) & 0xFFFF) - 0x8000; // diffs wrap mod 2^16
                    let diff = if diff == -32768 { 32768 } else { diff };
                    let cat = if diff == 0 { 0 } else if diff == 32768 { 16 } else { 32 - diff.unsigned_abs().leading_zeros() };
                    put(cat, 5, &mut out);
                    if cat > 0 && cat < 16 {
                        let bits = if diff < 0 { diff - 1 } else { diff } as u32 & ((1 << cat) - 1);
                        put(bits, cat, &mut out);
                    }
                    left[c] = v;
                    if col == 0 {
                        first[c] = v;
                    }
                }
            }
        }
        put(0x7FF, 11, &mut out); // pad with ones
        j.extend(out);
        j.extend_from_slice(&[0xFF, 0xD9]);
        j
    }

    #[test]
    fn lossless_jpeg_round_trips_with_slices() {
        // Sensor image 6 wide x 3 tall, in two vertical slices (2 and 4 wide), like Canon's.
        let sensor: Vec<u16> = (0..18u16).map(|i| [0, 1, 40000, 65535, 3, 255, 256, 7, 65280][i as usize % 9] ^ (i * 977)).collect();
        let mut linear = Vec::new();
        for (x0, x1) in [(0, 2), (2, 6)] {
            for y in 0..3 {
                linear.extend_from_slice(&sensor[y * 6 + x0..y * 6 + x1]);
            }
        }
        let m = decode_lossless(&encode(&linear), [1, 2, 4]).unwrap();
        assert_eq!((m.width, m.height), (6, 3));
        assert_eq!(m.data, sensor);
        // Unsliced files are read straight.
        let plain = decode_lossless(&encode(&sensor), [0, 0, 0]).unwrap();
        assert_eq!(plain.data, sensor);
    }

    #[test]
    fn refuses_what_it_cannot_decode() {
        assert!(mosaic(b"II*\0\x08\0\0\0XX").is_err());
        assert!(decode_lossless(b"\xFF\xD8\xFF\xC0\0\x02", [0; 3]).is_err());
        assert!(shot(b"II*\0\x10\0\0\0CR\x02\0\0\0\0\0\0\0").is_err());
    }
}
