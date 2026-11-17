//! Remove's fill: what a brush stroke painted over is rebuilt from the rest of the picture. KB Studio's
//! own code.
//!
//! The method is patch-based filling. A first guess is made on a tiny copy of the picture: the hole
//! closes from its rim inward, one small patch at a time, each copied from the best-matching patch of
//! real picture (the scheme of A. Criminisi, P. Pérez and K. Toyama, "Region Filling and Object Removal
//! by Exemplar-Based Image Inpainting", IEEE TIP 13(9), 2004, with its fill order by confidence alone).
//! Then, size by size up to the working size, every patch round the hole finds its closest patch of
//! real picture and the hole becomes what those patches agree on (see [`complete`]).
//!
//! The hole is worked out at the picture's full size, so lines and grain are the photo's own; only a
//! very big hole is worked out on a smaller copy and filled block by block from the matched places.
//! Last, the fill is made a little lighter or darker where needed so it meets its surroundings without
//! an outline (see [`even_the_joins`]).
//!
//! Buffers are interleaved `w × h × n` floats with a `w × h` hole mask. Deterministic.

use std::sync::atomic::{AtomicU32, Ordering};

use rayon::prelude::*;

/// Patch radius on the working copy: 9 × 9 patches.
const RADIUS: i32 = 4;
/// shortcut: past this the working copy is shrunk and the fill copied in blocks, softer on lines; raise if huge holes matter.
const MAX_HOLE: usize = 300_000;
const MAX_SIDE: usize = 2000;
/// Patch radius while refining: 7 × 7 patches.
const HALF: i32 = 3;
/// The biggest step between two pieces of the fill that is evened out (linear light, 0–1).
const NUDGE: f32 = 0.08;
/// Most places a patch is looked for; more are thinned out evenly.
const MAX_SOURCES: usize = 40_000;
/// How much closer a place counts when it carries on from a neighbour's (1 is no closer).
const KEEP: f32 = 0.9;

/// `mask` plus everything it encloses: a ring drawn round a thing removes the thing.
#[allow(dead_code)] // used once Remove moves over to this fill
pub fn close_loops(w: usize, h: usize, mask: &[bool]) -> Vec<bool> {
    if mask.len() != w * h || w == 0 || h == 0 {
        return mask.to_vec();
    }
    // Whatever the picture's border can reach without crossing the mask is outside; the rest is in.
    let mut outside = vec![false; w * h];
    let mut stack: Vec<usize> = Vec::new();
    let visit = |i: usize, stack: &mut Vec<usize>, outside: &mut Vec<bool>| {
        if !mask[i] && !outside[i] {
            outside[i] = true;
            stack.push(i);
        }
    };
    for x in 0..w {
        visit(x, &mut stack, &mut outside);
        visit((h - 1) * w + x, &mut stack, &mut outside);
    }
    for y in 0..h {
        visit(y * w, &mut stack, &mut outside);
        visit(y * w + w - 1, &mut stack, &mut outside);
    }
    while let Some(i) = stack.pop() {
        let (x, y) = (i % w, i / w);
        if x > 0 {
            visit(i - 1, &mut stack, &mut outside);
        }
        if x + 1 < w {
            visit(i + 1, &mut stack, &mut outside);
        }
        if y > 0 {
            visit(i - w, &mut stack, &mut outside);
        }
        if y + 1 < h {
            visit(i + w, &mut stack, &mut outside);
        }
    }
    outside.iter().map(|o| !o).collect()
}

/// `mask` grown by `r` pixels every way (a square), so a thing's soft edge goes with it.
pub fn dilate(w: usize, h: usize, mask: &[bool], r: usize) -> Vec<bool> {
    if mask.len() != w * h || r == 0 {
        return mask.to_vec();
    }
    let mut across = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            across[y * w + x] = (x.saturating_sub(r)..(x + r + 1).min(w)).any(|k| mask[y * w + k]);
        }
    }
    let mut out = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            out[y * w + x] = (y.saturating_sub(r)..(y + r + 1).min(h)).any(|k| across[k * w + x]);
        }
    }
    out
}

/// The picture with its hole filled. Pixels outside the hole come back exactly as they were. A picture
/// that is all hole, or has none, comes back unchanged.
pub fn fill(w: usize, h: usize, n: usize, img: &[f32], hole: &[bool]) -> Vec<f32> {
    let mut out = img.to_vec();
    let holes = hole.iter().filter(|&&m| m).count();
    if w == 0 || h == 0 || n == 0 || img.len() != w * h * n || hole.len() != w * h || holes == 0 || holes == w * h {
        return out;
    }
    // Shrink by a whole factor, so a working pixel is a square block of the picture.
    let mut f = 1;
    while holes / (f * f) > MAX_HOLE || w.max(h) / f > MAX_SIDE {
        f += 1;
    }
    let (sw, sh) = (w.div_ceil(f), h.div_ceil(f));
    let mut small = vec![0f32; sw * sh * n];
    let mut unknown = vec![false; sw * sh];
    for sy in 0..sh {
        for sx in 0..sw {
            let (mut count, s) = (0f32, sy * sw + sx);
            for y in sy * f..((sy + 1) * f).min(h) {
                for x in sx * f..((sx + 1) * f).min(w) {
                    unknown[s] |= hole[y * w + x]; // a block with any hole in it is all to be filled
                    for c in 0..n {
                        small[s * n + c] += img[(y * w + x) * n + c];
                    }
                    count += 1.0;
                }
            }
            small[s * n..s * n + n].iter_mut().for_each(|v| *v /= count);
        }
    }
    // Small pictures have no room for a 9 × 9 patch of real picture: a smaller patch then.
    // Small pictures have no room for the refining; the first guess alone, with whatever patch fits, then.
    let Some(source) = complete(sw, sh, n, &small, &unknown).or_else(|| (1..=RADIUS).rev().find_map(|r| order(sw, sh, n, &mut small.clone(), &unknown, r))) else {
        return out;
    };
    // Every hole pixel takes the real pixel from where its working pixel was copied.
    let mut from: Vec<u32> = (0..(w * h) as u32).collect();
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if hole[i] {
                let s = source[(y / f) * sw + x / f] as usize;
                from[i] = (((s / sw) * f + y % f).min(h - 1) * w + ((s % sw) * f + x % f).min(w - 1)) as u32;
                out.copy_within(from[i] as usize * n..from[i] as usize * n + n, i * n);
            }
        }
    }
    even_the_joins(w, h, n, img, &mut out, hole, &from);
    out
}

/// One size of the sum being solved in [`even_the_joins`]: the pixels to solve for, the change found
/// so far and what each pixel's change must differ from its neighbours' by, in all.
struct Grid {
    w: usize,
    h: usize,
    free: Vec<usize>,
    is_free: Vec<bool>,
    change: Vec<f32>,
    owed: Vec<f32>,
}

impl Grid {
    fn around(&self, i: usize) -> impl Iterator<Item = usize> {
        let (w, h) = (self.w, self.h);
        [(!i.is_multiple_of(w)).then(|| i - 1), (i % w + 1 < w).then(|| i + 1), (i >= w).then(|| i - w), (i + w < w * h).then(|| i + w)].into_iter().flatten()
    }

    /// Each pixel in turn takes the change that settles it with its neighbours as they stand.
    fn settle(&mut self, n: usize, times: usize) {
        for turn in 0..times {
            for k in 0..self.free.len() {
                let i = if turn % 2 == 0 { self.free[k] } else { self.free[self.free.len() - 1 - k] };
                let mut sum = [0f32; 4];
                let mut count = 0f32;
                for q in self.around(i) {
                    (0..n).for_each(|c| sum[c] += self.change[q * n + c]);
                    count += 1.0;
                }
                (0..n).for_each(|c| self.change[i * n + c] = (self.owed[i * n + c] + sum[c]) / count);
            }
        }
    }

    /// Settles this size: roughly, then the long-range part on a half-size copy, then the fine part.
    fn solve(&mut self, n: usize) {
        if self.w.max(self.h) <= 8 || self.free.len() <= 4 {
            return self.settle(n, 30);
        }
        self.settle(n, 2);
        let (cw, ch) = (self.w.div_ceil(2), self.h.div_ceil(2));
        let mut half = Grid { w: cw, h: ch, free: Vec::new(), is_free: vec![false; cw * ch], change: vec![0f32; cw * ch * n], owed: vec![0f32; cw * ch * n] };
        for &i in &self.free {
            let s = (i / self.w / 2) * cw + i % self.w / 2;
            let (mut sum, mut count) = ([0f32; 4], 0f32);
            for q in self.around(i) {
                (0..n).for_each(|c| sum[c] += self.change[q * n + c]);
                count += 1.0;
            }
            // What is still unsettled here goes down to the half-size copy to be dealt with there.
            // Halved: two pixel sides cross each side of a half-size pixel, so its neighbours pull twice as hard.
            (0..n).for_each(|c| half.owed[s * n + c] += 0.5 * (self.owed[i * n + c] - (count * self.change[i * n + c] - sum[c])));
            half.is_free[s] = true;
        }
        half.free = (0..cw * ch).filter(|&s| half.is_free[s]).collect();
        half.solve(n);
        for &i in &self.free {
            let s = (i / self.w / 2) * cw + i % self.w / 2;
            (0..n).for_each(|c| self.change[i * n + c] += half.change[s * n + c]);
        }
        self.settle(n, 2);
    }
}

/// Makes the fill lighter or darker, piece by piece, so that it meets the picture round the hole and
/// its own pieces meet each other without an outline. The fill is made of pieces of real picture; where
/// two pieces join, or a piece meets the rim, the two sides should be the same brightness, and inside a
/// piece nothing should change. That is solved for the whole hole at once (the gradient-domain joining
/// of P. Pérez, M. Gangnet and A. Blake, "Poisson Image Editing", SIGGRAPH 2003), on smaller and smaller
/// copies so a big hole costs little more than a small one. `from` says which real pixel each pixel shows.
fn even_the_joins(w: usize, h: usize, n: usize, src: &[f32], out: &mut [f32], hole: &[bool], from: &[u32]) {
    if n > 4 {
        return;
    }
    let free: Vec<usize> = (0..w * h).filter(|&i| hole[i]).collect();
    let mut grid = Grid { w, h, free, is_free: hole.to_vec(), change: vec![0f32; w * h * n], owed: vec![0f32; w * h * n] };
    for k in 0..grid.free.len() {
        let i = grid.free[k];
        for q in grid.around(i) {
            if from[q] as i64 - from[i] as i64 == q as i64 - i as i64 {
                continue; // the same piece: leave it as it is
            }
            // How the two should differ: as each one's own piece of picture goes on across the join, so the
            // grain carries over it. (Beside the rim only the fill's piece can say: the real pixel's
            // neighbour on this side was the thing removed.)
            let (to, a, b) = (q as i64 - i as i64, from[i] as i64, from[q] as i64);
            let mut want = [0f32; 4];
            let mut said = 0f32;
            // A piece's pixel on the very edge of the picture has nothing beyond it to go by.
            let beside = |p: i64, r: i64| p >= 0 && r >= 0 && p.max(r) < (w * h) as i64 && (p % w as i64 - r % w as i64).abs() <= 1;
            for (k, (near, far)) in [(a, a + to), (b - to, b)].into_iter().enumerate() {
                if (k == 0 || hole[q]) && beside(near, far) {
                    let (near, far) = (near as usize, far as usize);
                    (0..n).for_each(|c| want[c] += src[near * n + c] - src[far * n + c]);
                    said += 1.0;
                }
            }
            let said = said.max(1.0);
            // A small step is light and shade, which is what this is for; a big one is a line that
            // doesn't line up or something left beside the hole, and evening that out would stain the fill.
            let step: [f32; 4] = std::array::from_fn(|c| if c < n { out[i * n + c] - out[q * n + c] - want[c] / said } else { 0.0 });
            if step.iter().all(|v| v.abs() <= NUDGE) {
                (0..n).for_each(|c| grid.owed[i * n + c] -= step[c]);
            }
        }
    }
    for _ in 0..3 {
        grid.solve(n);
    }
    for &i in &grid.free {
        (0..n).for_each(|c| out[i * n + c] = (out[i * n + c] + grid.change[i * n + c]).max(0.0));
    }
}

/// One size of the picture while it is being worked out.
struct Level {
    w: usize,
    h: usize,
    img: Vec<f32>,
    hole: Vec<bool>,
}

/// Half the size: a pixel is the average of the real pixels under it, and hole if any of them is.
fn shrink(l: &Level, n: usize) -> Level {
    let (w, h) = (l.w.div_ceil(2), l.h.div_ceil(2));
    let (mut img, mut hole) = (vec![0f32; w * h * n], vec![false; w * h]);
    for y in 0..h {
        for x in 0..w {
            let (mut count, s) = (0f32, y * w + x);
            for yy in y * 2..(y * 2 + 2).min(l.h) {
                for xx in x * 2..(x * 2 + 2).min(l.w) {
                    let i = yy * l.w + xx;
                    if l.hole[i] {
                        hole[s] = true;
                    } else {
                        (0..n).for_each(|c| img[s * n + c] += l.img[i * n + c]);
                        count += 1.0;
                    }
                }
            }
            if count > 0.0 {
                img[s * n..s * n + n].iter_mut().for_each(|v| *v /= count);
            }
        }
    }
    Level { w, h, img, hole }
}

/// Small repeatable random numbers (xorshift), so the same stroke always gives the same fill.
struct Dice(u64);
impl Dice {
    fn roll(&mut self, below: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as usize % below.max(1)
    }
}

/// A repeatable random number below `below` from a seed alone, so rows searched side by side agree.
fn chance(seed: u64, below: usize) -> usize {
    let mut v = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    v = (v ^ (v >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    v = (v ^ (v >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((v ^ (v >> 31)) >> 11) as usize % below.max(1)
}

/// How unlike two 7 × 7 patches are (both centres at least `HALF` from every edge); gives up past `limit`.
fn unlike(img: &[f32], w: usize, n: usize, a: usize, b: usize, limit: f32) -> f32 {
    let mut cost = 0f32;
    for dy in -HALF..=HALF {
        let (ra, rb) = ((a as i32 + dy * w as i32 - HALF) as usize * n, (b as i32 + dy * w as i32 - HALF) as usize * n);
        let len = (2 * HALF as usize + 1) * n;
        cost += img[ra..ra + len].iter().zip(&img[rb..rb + len]).map(|(p, q)| (p - q) * (p - q)).sum::<f32>();
        if cost > limit {
            return f32::MAX;
        }
    }
    cost
}

/// Every hole pixel becomes the blend of what the patches covering it say it should be, the better
/// matched patches counting for more.
fn vote(l: &mut Level, n: usize, targets: &[usize], nn: &[u32], d: &[f32]) {
    let mut sorted: Vec<f32> = targets.iter().map(|&t| d[t]).collect();
    sorted.sort_by(f32::total_cmp);
    let sigma = sorted.get(sorted.len() * 3 / 4).copied().unwrap_or(0.0).max(1e-6);
    let (mut sum, mut weight) = (vec![0f32; l.w * l.h * n], vec![0f32; l.w * l.h]);
    for &t in targets {
        let wt = (-d[t] / (2.0 * sigma)).exp().max(1e-12);
        for dy in -HALF..=HALF {
            for dx in -HALF..=HALF {
                let off = dy * l.w as i32 + dx;
                let (p, s) = ((t as i32 + off) as usize, (nn[t] as i32 + off) as usize);
                if l.hole[p] {
                    (0..n).for_each(|c| sum[p * n + c] += wt * l.img[s * n + c]);
                    weight[p] += wt;
                }
            }
        }
    }
    for p in (0..l.w * l.h).filter(|&p| weight[p] > 0.0) {
        (0..n).for_each(|c| l.img[p * n + c] = sum[p * n + c] / weight[p]);
    }
}

/// The whole fill on the working copy: a first guess on a tiny copy (see [`order`]), then
/// size by size up to the working copy, each time finding for every patch round the hole its closest
/// patch of real picture (the PatchMatch search of C. Barnes, E. Shechtman, A. Finkelstein and
/// D. Goldman, SIGGRAPH 2009) and blending what those patches agree on (Y. Wexler, E. Shechtman and
/// M. Irani, "Space-Time Completion of Video", TPAMI 2007). Says which real pixel every pixel shows.
fn complete(w: usize, h: usize, colours: usize, img: &[f32], hole: &[bool]) -> Option<Vec<u32>> {
    // Two more values a pixel, compared along with its colour: how busy the picture is around it,
    // across and down. Colour alone can't tell grass from a smooth wall of the same green, and a
    // smooth guess then keeps drawing smooth patches until the fill is a blur.
    let (n, busy) = (colours + 2, 1.0);
    let lum = |i: usize| img[i * colours..i * colours + colours.min(3)].iter().sum::<f32>();
    let mut step = vec![0f32; w * h * 2];
    for i in (0..w * h).filter(|&i| !hole[i]) {
        if i % w + 1 < w && !hole[i + 1] {
            step[i * 2] = (lum(i + 1) - lum(i)).abs();
        }
        if i + w < w * h && !hole[i + w] {
            step[i * 2 + 1] = (lum(i + w) - lum(i)).abs();
        }
    }
    let mut wide = vec![0f32; w * h * n];
    wide.par_chunks_mut(n).enumerate().for_each(|(i, px)| {
        px[..colours].copy_from_slice(&img[i * colours..i * colours + colours]);
        let (x, y) = (i % w, i / w);
        let (mut sum, mut count) = ([0f32; 2], 0f32);
        for yy in y.saturating_sub(2)..(y + 3).min(h) {
            for xx in x.saturating_sub(2)..(x + 3).min(w) {
                if !hole[yy * w + xx] {
                    sum[0] += step[(yy * w + xx) * 2];
                    sum[1] += step[(yy * w + xx) * 2 + 1];
                    count += 1.0;
                }
            }
        }
        if count > 0.0 {
            (px[colours], px[colours + 1]) = (busy * sum[0] / count, busy * sum[1] / count);
        }
    });
    let mut levels = vec![Level { w, h, img: wide, hole: hole.to_vec() }];
    while levels.last().is_some_and(|l| l.hole.iter().filter(|m| **m).count() > 150 && l.w.min(l.h) >= 32) {
        let next = shrink(levels.last()?, n);
        levels.push(next);
    }
    let top = levels.last_mut()?;
    let mut nn = (1..=3).rev().find_map(|r| order(top.w, top.h, n, &mut top.img, &top.hole, r))?;
    let mut dice = Dice(0x9E37_79B9_7F4A_7C15);
    let mut came_from = (0, 0);
    let last = levels.len() - 1;
    for li in (0..levels.len()).rev() {
        let l = &mut levels[li];
        let (wi, hi) = (l.w as i32, l.h as i32);
        let lw = l.w;
        let inside = move |i: usize| { let (x, y) = ((i % lw) as i32, (i / lw) as i32); x >= HALF && y >= HALF && x < wi - HALF && y < hi - HALF };
        let touches: Vec<bool> = dilate(l.w, l.h, &l.hole, HALF as usize);
        let valid: Vec<bool> = (0..l.w * l.h).map(|i| inside(i) && !touches[i]).collect();
        let list: Vec<u32> = (0..(l.w * l.h) as u32).filter(|&i| valid[i as usize]).collect();
        let targets: Vec<usize> = (0..l.w * l.h).filter(|&i| inside(i) && touches[i]).collect();
        if list.is_empty() {
            return None;
        }
        if li != last {
            // Start from the size below: the same places, twice as far apart.
            let (pw, coarse) = (came_from.0, std::mem::take(&mut nn));
            nn = (0..(l.w * l.h) as u32).collect();
            for &t in &targets {
                let (x, y) = (t % l.w, t / l.w);
                let c = coarse[(y / 2) * pw + x / 2] as usize;
                nn[t] = (((c / pw) * 2 + y % 2).min(l.h - 1) * l.w + ((c % pw) * 2 + x % 2).min(l.w - 1)) as u32;
            }
        }
        for &t in &targets {
            if !valid[nn[t] as usize] {
                nn[t] = list[dice.roll(list.len())];
            }
        }
        let mut d = vec![0f32; l.w * l.h];
        if li != last {
            vote(l, n, &targets, &nn, &d); // the hole is still empty at this size
        }
        if li != last && carry_on(l, n, &targets, &mut nn, &valid) {
            vote(l, n, &targets, &nn, &d);
        }
        let is_target: Vec<bool> = (0..l.w * l.h).map(|i| inside(i) && touches[i]).collect();
        let rounds = if li == last { 24 } else if li == 0 { 3 } else if li == 1 { 5 } else { 10 };
        // Rows are searched side by side: a row sees its own finds as it goes and the rows above and
        // below as they stood before the pass.
        // A place that carries on from where a neighbour's patch came from counts as a little closer:
        // the fill is then made of fewer, bigger pieces of real picture, with fewer joins between them.
        let is_t = &is_target;
        let runs = move |nn: &[u32], t: usize, cand: u32| [(1i64, 1i64), (-1, -1), (lw as i64, lw as i64), (-(lw as i64), -(lw as i64))].iter().any(|&(o, _)| { let q = t as i64 + o; q >= 0 && (q as usize) < nn.len() && is_t[q as usize] && nn[q as usize] as i64 == cand as i64 + o });
        let rows: Vec<&[usize]> = targets.chunk_by(|a, b| a / lw == b / lw).collect();
        for round in 0..rounds {
            let shown = &l.img;
            let fresh: Vec<f32> = targets.par_iter().map(|&t| unlike(shown, l.w, n, t, nn[t] as usize, f32::MAX) * if runs(&nn, t, nn[t]) { KEEP } else { 1.0 }).collect();
            targets.iter().zip(fresh).for_each(|(&t, v)| d[t] = v);
            for pass in 0..2 {
                let step: i64 = if (round + pass) % 2 == 0 { 1 } else { -1 };
                let (before, was) = (&nn, &d);
                let found: Vec<Vec<(u32, f32)>> = rows
                    .par_iter()
                    .map(|row| {
                        let mut out = Vec::with_capacity(row.len());
                        let mut beside: Option<(usize, u32)> = None;
                        for k in 0..row.len() {
                            let t = if step == 1 { row[k] } else { row[row.len() - 1 - k] };
                            let (mut best, mut cost) = (before[t], was[t]);
                            let try_it = |cand: i64, best: &mut u32, cost: &mut f32| {
                                if cand >= 0 && (cand as usize) < valid.len() && valid[cand as usize] && cand as u32 != *best {
                                    let k = if runs(before, t, cand as u32) { KEEP } else { 1.0 };
                                    let c = unlike(shown, lw, n, t, cand as usize, *cost / k) * k;
                                    if c < *cost {
                                        (*cost, *best) = (c, cand as u32);
                                    }
                                }
                            };
                            // What a neighbour found, moved over by one: matches come in runs.
                            if let Some((_, s)) = beside.filter(|&(q, _)| q as i64 == t as i64 - step) {
                                try_it(s as i64 + step, &mut best, &mut cost);
                            }
                            for jump in [-step, lw as i64, -(lw as i64)] {
                                let q = t as i64 - jump;
                                if q >= 0 && (q as usize) < is_target.len() && is_target[q as usize] {
                                    try_it(before[q as usize] as i64 + jump, &mut best, &mut cost);
                                }
                            }
                            // And a few tries round the best so far, near and far.
                            let (mut reach, mut turn) = (lw.max(l.h) as i32, 0u64);
                            while reach >= 1 {
                                let seed = ((t as u64) << 20) ^ ((round as u64 * 2 + pass as u64) << 8) ^ turn ^ ((li as u64) << 56);
                                let (bx, by) = ((best as usize % lw) as i32, (best as usize / lw) as i32);
                                let x = (bx + chance(seed, 2 * reach as usize + 1) as i32 - reach).clamp(HALF, wi - HALF - 1);
                                let y = (by + chance(!seed, 2 * reach as usize + 1) as i32 - reach).clamp(HALF, hi - HALF - 1);
                                try_it((y * wi + x) as i64, &mut best, &mut cost);
                                reach /= 2;
                                turn += 1;
                            }
                            out.push((best, cost));
                            beside = Some((t, best));
                        }
                        out
                    })
                    .collect();
                for (row, out) in rows.iter().zip(found) {
                    for (k, (best, cost)) in out.into_iter().enumerate() {
                        let t = if step == 1 { row[k] } else { row[row.len() - 1 - k] };
                        (nn[t], d[t]) = (best, cost);
                    }
                }
            }
            if li > 0 || round + 1 < rounds {
                vote(l, n, &targets, &nn, &d);
            }
        }
        if li == 0 {
            // Each hole pixel shows the real pixel its best-matched patch puts there: sharp, not a blend.
            let mut src: Vec<u32> = (0..(l.w * l.h) as u32).collect();
            let mut least = vec![f32::MAX; l.w * l.h];
            for &t in &targets {
                for dy in -HALF..=HALF {
                    for dx in -HALF..=HALF {
                        let off = dy * wi + dx;
                        let p = (t as i32 + off) as usize;
                        if l.hole[p] && d[t] < least[p] {
                            (least[p], src[p]) = (d[t], (nn[t] as i32 + off) as u32);
                        }
                    }
                }
            }
            return Some(src);
        }
        came_from = (l.w, l.h);
    }
    None
}

/// Boards, a fence, a kerb: where the picture beside the hole runs in lines, what was behind the removed
/// thing is those lines carried on. The patches that reach over the rim have each found where their
/// real part goes on, some way off in some direction. Here the one such step is found along which the
/// picture beside the hole stays most the same, and when it is far more the same along that step than
/// across it (lines, then, not grain), the whole fill is laid along it: every patch from one step
/// away, or two, or three, until it lands on real picture. Where that is wrong (another thing beside
/// the hole) the search that follows puts it right. True when it was done.
fn carry_on(l: &Level, n: usize, targets: &[usize], nn: &mut [u32], valid: &[bool]) -> bool {
    // How many times more the picture must change across the step than along it.
    const LINES: f32 = 12.0;
    let (w, h) = (l.w as i32, l.h as i32);
    let at = |t: usize, (dx, dy): (i32, i32)| {
        let (x, y) = ((t % l.w) as i32 + dx, (t / l.w) as i32 + dy);
        (x >= 0 && y >= 0 && x < w && y < h).then(|| (y * w + x) as usize)
    };
    // The real pixels beside the hole.
    let beside: Vec<usize> = targets.iter().copied().filter(|&t| !l.hole[t]).collect();
    let change = |step: (i32, i32)| -> Option<f32> {
        let (mut sum, mut count) = (0f32, 0usize);
        for &t in &beside {
            if let Some(s) = at(t, step).filter(|&s| !l.hole[s]) {
                sum += l.img[t * n..t * n + n].iter().zip(&l.img[s * n..s * n + n]).map(|(p, q)| (p - q) * (p - q)).sum::<f32>();
                count += 1;
            }
        }
        (count * 4 >= beside.len()).then(|| sum / count as f32)
    };
    let mut seen: std::collections::BTreeMap<(i32, i32), usize> = std::collections::BTreeMap::new();
    for &t in targets.iter().filter(|&&t| (-HALF..=HALF).any(|dy| (-HALF..=HALF).any(|dx| l.hole[(t as i32 + dy * w + dx) as usize]))) {
        let step = ((nn[t] as usize % l.w) as i32 - (t % l.w) as i32, (nn[t] as usize / l.w) as i32 - (t / l.w) as i32);
        if step != (0, 0) {
            *seen.entry(step).or_default() += 1;
        }
    }
    let mut steps: Vec<(usize, (i32, i32))> = seen.into_iter().map(|(s, k)| (k, s)).collect();
    steps.sort_by(|a, b| b.cmp(a));
    let rated: Vec<((i32, i32), f32)> = steps.par_iter().take(48).filter_map(|&(_, s)| {
            // Across: a short step square to it, a patch or so long.
            let long = ((s.0 * s.0 + s.1 * s.1) as f32).sqrt() / 8.0;
            let across = ((-s.1 as f32 / long).round() as i32, (s.0 as f32 / long).round() as i32);
            Some((s, change(across)? / change(s)?.max(1e-9)))
        }).collect();
    let Some(&(step, lines)) = rated.iter().max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0))) else { return false };
    if lines < LINES {
        return false;
    }
    for &t in targets {
        let (mut x, mut y) = ((t % l.w) as i32, (t / l.w) as i32);
        for _ in 0..64 {
            (x, y) = (x + step.0, y + step.1);
            if x < HALF || y < HALF || x >= w - HALF || y >= h - HALF {
                break;
            }
            if valid[(y * w + x) as usize] {
                nn[t] = (y * w + x) as u32;
                break;
            }
        }
    }
    true
}

/// Fills the working copy patch by patch and says, for every pixel, which real pixel it shows (itself
/// when it was never in the hole). None when no patch of real picture of radius `r` exists.
fn order(w: usize, h: usize, n: usize, val: &mut [f32], unknown: &[bool], r: i32) -> Option<Vec<u32>> {
    let (wi, hi) = (w as i32, h as i32);
    let side = (2 * r + 1) as usize;
    let mut known: Vec<bool> = unknown.iter().map(|u| !u).collect();
    let mut conf: Vec<f32> = known.iter().map(|&k| k as u8 as f32).collect();
    let mut src: Vec<u32> = (0..(w * h) as u32).collect();
    // Places to copy from: patches that lie wholly in the picture and wholly outside the hole.
    let mut sources: Vec<(i32, i32)> = Vec::new();
    for y in r..hi - r {
        for x in r..wi - r {
            if (-r..=r).all(|dy| (-r..=r).all(|dx| known[((y + dy) * wi + x + dx) as usize])) {
                sources.push((x, y));
            }
        }
    }
    if sources.is_empty() {
        return None;
    }
    if sources.len() > MAX_SOURCES {
        let step = sources.len().div_ceil(MAX_SOURCES);
        sources = sources.into_iter().enumerate().filter(|(i, _)| i % step == 0).map(|(_, s)| s).collect();
    }
    let diagonal = ((w * w + h * h) as f32).sqrt();
    let at = |x: i32, y: i32| (x >= 0 && y >= 0 && x < wi && y < hi).then(|| (y * wi + x) as usize);
    let mut todo: Vec<usize> = (0..w * h).filter(|&i| !known[i]).collect();
    while !todo.is_empty() {
        // The rim pixel to fill round next: the one surest of its surroundings, so the hole closes evenly
        // from its rim inward. (Putting strong lines first, as the paper does, scored worse on real photos.)
        let mut best: Option<(f32, usize, f32)> = None;
        for &i in &todo {
            let (x, y) = ((i % w) as i32, (i / w) as i32);
            let is = |dx: i32, dy: i32| at(x + dx, y + dy).is_some_and(|j| known[j]);
            if !(is(1, 0) || is(-1, 0) || is(0, 1) || is(0, -1)) {
                continue;
            }
            let sure = (-r..=r).flat_map(|dy| (-r..=r).map(move |dx| (dx, dy))).filter_map(|(dx, dy)| at(x + dx, y + dy)).map(|j| conf[j]).sum::<f32>() / (side * side) as f32;
            let priority = sure;
            if best.is_none_or(|(p, _, _)| priority > p) {
                best = Some((priority, i, sure));
            }
        }
        let Some((_, p, sure)) = best else { break };
        let (px, py) = ((p % w) as i32, (p / w) as i32);
        // What is already there round it, to match against.
        let seen: Vec<(i32, i32, usize)> = (-r..=r).flat_map(|dy| (-r..=r).map(move |dx| (dx, dy))).filter_map(|(dx, dy)| at(px + dx, py + dy).filter(|&j| known[j]).map(|j| (dx, dy, j))).collect();
        let bound = AtomicU32::new(f32::MAX.to_bits());
        let shown: &[f32] = val;
        let (_, (sx, sy)) = sources
            .par_iter()
            .map(|&(sx, sy)| {
                // A little in favour of nearby picture: the same wall, not a like-coloured one far off.
                let far = 1.0 + 0.25 * (((sx - px).pow(2) + (sy - py).pow(2)) as f32).sqrt() / diagonal;
                let limit = f32::from_bits(bound.load(Ordering::Relaxed));
                let mut cost = 0f32;
                for (k, &(dx, dy, j)) in seen.iter().enumerate() {
                    let s = ((sy + dy) * wi + sx + dx) as usize;
                    cost += (0..n).map(|c| (shown[j * n + c] - shown[s * n + c]).powi(2)).sum::<f32>() * far;
                    if k % 9 == 8 && cost > limit {
                        return (f32::MAX, (sx, sy));
                    }
                }
                bound.fetch_min(cost.to_bits(), Ordering::Relaxed); // costs are never negative, so bits order as floats
                (cost, (sx, sy))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)))?;
        for dy in -r..=r {
            for dx in -r..=r {
                let Some(j) = at(px + dx, py + dy).filter(|&j| !known[j]) else { continue };
                let s = ((sy + dy) * wi + sx + dx) as usize;
                val.copy_within(s * n..s * n + n, j * n);
                (src[j], known[j], conf[j]) = (s as u32, true, sure);
            }
        }
        todo.retain(|&i| !known[i]);
    }
    Some(src)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Boards: horizontal stripes with a little grain, a square hole punched in the middle.
    fn boards(w: usize, h: usize) -> (Vec<f32>, Vec<bool>) {
        let img = (0..w * h).flat_map(|i| { let v = if (i / w) % 12 < 2 { 0.2 } else { 0.7 } + ((i * 7919) % 13) as f32 / 400.0; [v, v * 0.9, v * 0.6] }).collect();
        let hole = (0..w * h).map(|i| (70..130).contains(&(i % w)) && (50..100).contains(&(i / w))).collect();
        (img, hole)
    }

    /// Scores this fill against the borrowed one on real photos: clean patches are hidden and filled, and
    /// what comes back is compared with what was really there. `off` is the mean difference (lower is
    /// better), `sharp` the fill's fine detail over the real detail (1 is right, less is blurred).
    /// PICS=a.jpg:b.jpg cargo test --release score_fill -- --ignored --nocapture
    #[test]
    #[ignore]
    fn score_fill() {
        let mut dice = Dice(42);
        let (mut rows, mut totals) = (0, [0f32; 4]);
        for path in std::env::var("PICS").expect("set PICS").split(':') {
            let pic = image::open(path).unwrap().to_rgb8();
            let (pw, ph) = (pic.width() as usize, pic.height() as usize);
            for _ in 0..12 {
                // A 600 × 600 piece with a hole of 60 to 180 pixels in the middle, as Remove crops it.
                let (w, h) = (600.min(pw), 600.min(ph));
                let (x0, y0) = (dice.roll(pw - w + 1), dice.roll(ph - h + 1));
                let truth: Vec<f32> = (0..w * h).flat_map(|i| pic.get_pixel((x0 + i % w) as u32, (y0 + i / w) as u32).0.map(|v| v as f32 / 255.0)).collect();
                let (hw, hh) = (60 + dice.roll(120), 60 + dice.roll(120));
                let hole: Vec<bool> = (0..w * h).map(|i| (i % w).abs_diff(w / 2) < hw / 2 && (i / w).abs_diff(h / 2) < hh / 2).collect();
                let mut holed = truth.clone();
                hole.iter().enumerate().filter(|(_, m)| **m).for_each(|(i, _)| holed[i * 3..i * 3 + 3].copy_from_slice(&[1.0, 0.0, 1.0]));
                let score = |out: &[f32]| {
                    let (mut off, mut fine, mut real, mut count) = (0f32, 0f32, 0f32, 0f32);
                    for i in (0..w * h).filter(|&i| hole[i] && hole[i + 1] && hole[i + w]) {
                        let g = |v: &[f32]| (v[i * 3 + 1] - v[(i + 1) * 3 + 1]).abs() + (v[i * 3 + 1] - v[(i + w) * 3 + 1]).abs();
                        off += (0..3).map(|c| (out[i * 3 + c] - truth[i * 3 + c]).abs()).sum::<f32>() / 3.0;
                        (fine, real, count) = (fine + g(out), real + g(&truth), count + 1.0);
                    }
                    (off / count, fine / real.max(1e-6))
                };
                let a = if std::env::var_os("SKIP_OLD").is_some() { (0.0, 0.0) } else { score(&crate::photocraft_remove::remove_with(w, h, 3, &holed, &hole, 1, &crate::photocraft_remove::Interrupt::NONE).unwrap()) };
                let b = score(&fill(w, h, 3, &holed, &hole));
                [a.0, a.1, b.0, b.1].iter().enumerate().for_each(|(k, v)| totals[k] += v);
                rows += 1;
            }
        }
        let t = totals.map(|v| v / rows as f32);
        eprintln!("{rows} holes  borrowed: off {:.4} sharp {:.2}   own: off {:.4} sharp {:.2}", t[0], t[1], t[2], t[3]);
    }

    #[test]
    fn lines_are_carried_across_the_hole() {
        let (w, h) = (200, 150);
        let (img, hole) = boards(w, h);
        let mut holed = img.clone();
        hole.iter().enumerate().filter(|(_, m)| **m).for_each(|(i, _)| holed[i * 3..i * 3 + 3].copy_from_slice(&[1.0, 0.0, 0.0]));
        let out = fill(w, h, 3, &holed, &hole);
        let wrong = (0..w * h).filter(|&i| hole[i] && (out[i * 3] - img[i * 3]).abs() > 0.25).count();
        let holes = hole.iter().filter(|m| **m).count();
        assert!(wrong * 20 < holes, "{wrong} of {holes} hole pixels are not the board that belongs there");
        assert!((0..w * h).all(|i| hole[i] || out[i * 3..i * 3 + 3] == holed[i * 3..i * 3 + 3]), "changed outside the hole");
        assert_eq!(out, fill(w, h, 3, &holed, &hole), "not the same twice");
    }

    #[test]
    fn sloping_lines_carry_on_at_their_own_height() {
        // Boards that climb a little to the right, with something else (a pale post) just right of the
        // hole: the boards must come out of the hole where they went in, not a few pixels up or down.
        let (w, h) = (500, 400);
        let board = |x: usize, y: usize| if (y + 400 - x / 25) % 40 < 4 { 0.25 } else { 0.7 };
        let img: Vec<f32> = (0..w * h).flat_map(|i| { let v = if (330..360).contains(&(i % w)) { 0.95 } else { board(i % w, i / w) + ((i * 7919) % 13) as f32 / 400.0 }; [v, v * 0.9, v * 0.6] }).collect();
        let hole: Vec<bool> = (0..w * h).map(|i| (230..330).contains(&(i % w)) && (100..300).contains(&(i / w))).collect();
        let mut holed = img.clone();
        hole.iter().enumerate().filter(|(_, m)| **m).for_each(|(i, _)| holed[i * 3..i * 3 + 3].copy_from_slice(&[0.1, 0.1, 0.3]));
        let out = fill(w, h, 3, &holed, &hole);
        let wrong = (0..w * h).filter(|&i| hole[i] && (out[i * 3] - board(i % w, i / w)).abs() > 0.25).count();
        assert!(wrong < 50, "{wrong} of 20000 hole pixels are not the board that belongs there"); // 144 without carry_on
    }

    #[test]
    fn a_big_hole_is_filled_with_real_pixels() {
        // Big enough to be worked out on a shrunken copy: the fill must still be the picture's own sharp stripes.
        let (w, h) = (900, 600);
        let img: Vec<f32> = (0..w * h).flat_map(|i| { let v = if (i / w) % 30 < 4 { 0.2 } else { 0.7 }; [v, v, v] }).collect();
        let hole: Vec<bool> = (0..w * h).map(|i| (300..600).contains(&(i % w)) && (200..400).contains(&(i / w))).collect();
        let out = fill(w, h, 3, &img, &hole);
        let wrong = (0..w * h).filter(|&i| hole[i] && (out[i * 3] - img[i * 3]).abs() > 0.2).count();
        assert!(wrong * 10 < 300 * 200, "{wrong} pixels off the stripes"); // 8% today, at the joins: to be brought down
    }

    #[test]
    fn a_hole_at_the_edge_of_the_picture_is_filled_to_the_edge() {
        // Each side and a corner: nothing of what was painted over (pure magenta here) may be left.
        let (w, h) = (160, 120);
        let (img, _) = boards(w, h);
        for (x0, y0, x1, y1) in [(0, 40, 30, 80), (130, 40, 160, 80), (60, 0, 100, 25), (60, 95, 100, 120), (0, 0, 30, 30), (125, 90, 160, 120)] {
            let hole: Vec<bool> = (0..w * h).map(|i| (x0..x1).contains(&(i % w)) && (y0..y1).contains(&(i / w))).collect();
            let mut holed = img.clone();
            hole.iter().enumerate().filter(|(_, m)| **m).for_each(|(i, _)| holed[i * 3..i * 3 + 3].copy_from_slice(&[1.0, 0.0, 1.0]));
            let out = fill(w, h, 3, &holed, &hole);
            let left = (0..w * h).filter(|&i| hole[i] && (out[i * 3 + 1] < 0.1 || out[i * 3 + 2] > out[i * 3] * 0.9)).count();
            assert_eq!(left, 0, "{left} pixels of the removed thing left in the hole at {x0},{y0}");
        }
    }

    #[test]
    fn odd_inputs_come_back_unchanged() {
        let img = vec![0.5f32; 30 * 20 * 3];
        assert_eq!(fill(30, 20, 3, &img, &vec![true; 600]), img);
        assert_eq!(fill(30, 20, 3, &img, &vec![false; 600]), img);
        assert_eq!(fill(30, 20, 3, &img, &[true; 5]), img);
        let mut one = vec![false; 600];
        one[310] = true;
        assert_eq!(fill(30, 20, 3, &img, &one), img, "a flat picture stays flat");
    }

    #[test]
    fn a_ring_closes_and_a_mask_grows() {
        let (w, h) = (9, 9);
        let ring: Vec<bool> = (0..81).map(|i| { let (x, y) = (i % w, i / w); (2..=6).contains(&x) && (2..=6).contains(&y) && (x == 2 || x == 6 || y == 2 || y == 6) }).collect();
        let closed = close_loops(w, h, &ring);
        assert!(closed[4 * w + 4] && !closed[0] && closed.iter().filter(|m| **m).count() == 25);
        let mut dot = vec![false; 81];
        dot[4 * w + 4] = true;
        assert_eq!(dilate(w, h, &dot, 1).iter().filter(|m| **m).count(), 9);
    }
}
