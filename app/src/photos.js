// Face-aware cropping: where a photo lands in a panel, the face stays in
// frame. A panel asks for a source rectangle of the photo that covers the
// panel exactly (no letterbox), centred on the face anchor, then the user
// can zoom and nudge it. User uploads get their anchor from a skin-tone
// scan, so a stranger's photo behaves like the shipped samples.

/**
 * Source rectangle of `img` that covers a dstW x dstH panel while keeping
 * the face anchor in frame. zoom > 1 crops tighter; ox/oy nudge the crop
 * in fractions of the crop size (-1..1). Returns {sx, sy, sw, sh}.
 */
export function faceCropRect(img, dstW, dstH, face, zoom = 1, ox = 0, oy = 0) {
  // Works for images and for canvases (a graded hero is a canvas).
  const sw0 = img.naturalWidth || img.width;
  const sh0 = img.naturalHeight || img.height;
  const scale = Math.max(dstW / sw0, dstH / sh0) * zoom;
  let cw = dstW / scale;
  let ch = dstH / scale;
  cw = Math.min(cw, sw0);
  ch = Math.min(ch, sh0);
  // Centre the crop on the face, biased so the face sits a third down the
  // panel instead of dead centre — the poster's eye line.
  let cx = face.x * sw0 + ox * cw * 0.5;
  let cy = face.y * sh0 - ch * 0.18 + oy * ch * 0.5;
  cx = clamp(cx, cw / 2, sw0 - cw / 2);
  cy = clamp(cy, ch / 2, sh0 - ch / 2);
  return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** A pixel is skin-toned when red leads, warm, and clearly ahead of blue. */
export function isSkin(r, g, b) {
  return r > 95 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && r - b > 20;
}

/**
 * Finds the face anchor of an uploaded photo: downsamples it to a small
 * grid, scores the skin-toned cluster, and returns its centroid as
 * fractions. Falls back to the upper-middle of the frame when no skin
 * cluster is found (a landscape, a car, a skyline).
 */
export function detectFaceAnchor(img) {
  const W = 48;
  const H = Math.max(8, Math.round((48 * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width)));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, W, H);
  const data = cx.getImageData(0, 0, W, H).data;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isSkin(data[i], data[i + 1], data[i + 2])) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n < 6) return { x: 0.5, y: 0.35 };
  return { x: sx / n / W, y: sy / n / H };
}

/** Draws img into a panel rect with the face-aware crop above. flip mirrors it. */
export function drawPhotoInto(ctx, img, rect, face, zoom = 1, ox = 0, oy = 0, flip = false) {
  const r = faceCropRect(img, rect.w, rect.h, face, zoom, ox, oy);
  if (!flip) {
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  ctx.save();
  ctx.translate(rect.x + rect.w, rect.y);
  ctx.scale(-1, 1);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, rect.w, rect.h);
  ctx.restore();
}

/**
 * Scores how good a face is for the hero slot, 0..1: the share of
 * skin-toned pixels (a close-up face fills the frame) times how central
 * the face sits. Shipped samples carry their score in samples.js; an
 * upload gets its score from this scan.
 */
export function scoreFace(img, face) {
  const W = 48;
  const H = Math.max(8, Math.round((48 * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width)));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, W, H);
  const data = cx.getImageData(0, 0, W, H).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isSkin(data[i], data[i + 1], data[i + 2])) n++;
  }
  const frac = n / (W * H);
  const centrality = 1 - 0.3 * Math.abs(face.x - 0.5) - 0.3 * Math.abs(face.y - 0.35);
  return Math.max(0.05, Math.min(1, (0.25 + frac * 2.2) * centrality));
}
