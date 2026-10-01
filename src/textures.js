// Procedural texture generation (all original, drawn on canvases at startup).
import * as THREE from 'three';
import { mulberry32, hashStr } from './utils.js';

let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = Math.min(a, 8); }

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function toTex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}
const gray = (v) => { const g = Math.round(v * 255); return `rgb(${g},${g},${g})`; };

function addNoise(ctx, w, h, amount, rng) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}
function blotches(ctx, w, h, n, rng, rgb, maxA, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = rMin + rng() * (rMax - rMin);
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(${rgb},${maxA * rng()})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}
// Build a tangent-space normal map from the luminance of a canvas.
function normalFromCanvas(src, strength = 2) {
  const w = src.width, h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (sd[i * 4] + sd[i * 4 + 1] + sd[i * 4 + 2]) / 765;
  const out = mk(w, h), octx = out.getContext('2d'), img = octx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + ((x - 1 + w) % w)], r = H[y * w + ((x + 1) % w)];
    const u = H[((y - 1 + h) % h) * w + x], dn = H[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const k = (y * w + x) * 4;
    d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ------------------------------------------------------------ building facades
export const FACADE_STYLES = {
  glass:     { wall: '#1b2733', cols: 4, rows: 4, tileW: 12, tileH: 14, mx: 0.03, top: 0.06, wh: 0.86, glassA: '#5a8fb0', glassB: '#14304a', frame: '#9fb4c4', frameW: 3, lit: 0.32, wallR: 0.45, glassR: 0.04, metal: 0.55 },
  darkGlass: { wall: '#101216', cols: 4, rows: 4, tileW: 12, tileH: 14, mx: 0.05, top: 0.1, wh: 0.8, glassA: '#2b3440', glassB: '#07090d', frame: '#c9a55a', frameW: 4, lit: 0.28, wallR: 0.35, glassR: 0.05, metal: 0.7 },
  tealGlass: { wall: '#16332f', cols: 4, rows: 4, tileW: 12, tileH: 14, mx: 0.04, top: 0.08, wh: 0.84, glassA: '#4fb3a4', glassB: '#0d3b3a', frame: '#d7e8e4', frameW: 3, lit: 0.3, wallR: 0.45, glassR: 0.05, metal: 0.5 },
  concrete:  { wall: '#8e8a82', cols: 4, rows: 4, tileW: 12, tileH: 14, mx: 0.18, top: 0.22, wh: 0.52, glassA: '#4a5a66', glassB: '#1c252c', frame: '#5d5a55', frameW: 5, lit: 0.4, wallR: 0.9, glassR: 0.1, metal: 0.0, concrete: true },
  brick:     { wall: '#7d3a2c', cols: 3, rows: 4, tileW: 9, tileH: 14, mx: 0.22, top: 0.2, wh: 0.55, glassA: '#3d4a55', glassB: '#151b21', frame: '#e8e2d6', frameW: 6, lit: 0.45, wallR: 0.92, glassR: 0.1, metal: 0.0, brick: true },
  decoPink:  { wall: '#f4b6c7', cols: 3, rows: 4, tileW: 10.5, tileH: 14, mx: 0.16, top: 0.26, wh: 0.46, glassA: '#6fc9d6', glassB: '#1c4a58', frame: '#ffffff', frameW: 5, lit: 0.5, wallR: 0.8, glassR: 0.08, metal: 0.0, deco: '#3ec9c0' },
  decoMint:  { wall: '#b9ead6', cols: 3, rows: 4, tileW: 10.5, tileH: 14, mx: 0.16, top: 0.26, wh: 0.46, glassA: '#79b9e0', glassB: '#1b3b5c', frame: '#ffffff', frameW: 5, lit: 0.5, wallR: 0.8, glassR: 0.08, metal: 0.0, deco: '#ff6f9c' },
  decoLav:   { wall: '#cdb9f0', cols: 3, rows: 4, tileW: 10.5, tileH: 14, mx: 0.16, top: 0.26, wh: 0.46, glassA: '#8fd0e8', glassB: '#243a66', frame: '#ffffff', frameW: 5, lit: 0.5, wallR: 0.8, glassR: 0.08, metal: 0.0, deco: '#ffcc55' },
  decoWhite: { wall: '#f3eee4', cols: 3, rows: 4, tileW: 10.5, tileH: 14, mx: 0.16, top: 0.26, wh: 0.46, glassA: '#5fc4dc', glassB: '#1a4056', frame: '#d9d4c8', frameW: 5, lit: 0.5, wallR: 0.8, glassR: 0.08, metal: 0.0, deco: '#27b5cf' },
  decoPeach: { wall: '#ffcfa6', cols: 3, rows: 4, tileW: 10.5, tileH: 14, mx: 0.16, top: 0.26, wh: 0.46, glassA: '#7fd6d0', glassB: '#1d4d4b', frame: '#ffffff', frameW: 5, lit: 0.5, wallR: 0.8, glassR: 0.08, metal: 0.0, deco: '#e0508a' },
  stucco:    { wall: '#ead3b2', cols: 2, rows: 2, tileW: 8, tileH: 7, mx: 0.28, top: 0.28, wh: 0.45, glassA: '#5a7384', glassB: '#1f2a33', frame: '#fbf7ef', frameW: 5, lit: 0.45, wallR: 0.9, glassR: 0.1, metal: 0.0, shutters: '#3f8c86' },
  stuccoBlue:{ wall: '#bcd8e8', cols: 2, rows: 2, tileW: 8, tileH: 7, mx: 0.28, top: 0.28, wh: 0.45, glassA: '#55707f', glassB: '#1f2a33', frame: '#fbf7ef', frameW: 5, lit: 0.45, wallR: 0.9, glassR: 0.1, metal: 0.0, shutters: '#d96b53' },
  stuccoYel: { wall: '#f2e2a0', cols: 2, rows: 2, tileW: 8, tileH: 7, mx: 0.28, top: 0.28, wh: 0.45, glassA: '#55707f', glassB: '#1f2a33', frame: '#fbf7ef', frameW: 5, lit: 0.45, wallR: 0.9, glassR: 0.1, metal: 0.0, shutters: '#2f6f9f' },
  warehouse: { wall: '#6f767c', cols: 6, rows: 1, tileW: 18, tileH: 10, mx: 0.1, top: 0.08, wh: 0.14, glassA: '#8c9aa3', glassB: '#3a454d', frame: '#444a4f', frameW: 3, lit: 0.3, wallR: 0.6, glassR: 0.2, metal: 0.45, corrugated: true },
  warehouseRed: { wall: '#7d4038', cols: 6, rows: 1, tileW: 18, tileH: 10, mx: 0.1, top: 0.08, wh: 0.14, glassA: '#8c9aa3', glassB: '#3a454d', frame: '#444a4f', frameW: 3, lit: 0.3, wallR: 0.6, glassR: 0.2, metal: 0.4, corrugated: true },
  hospital:  { wall: '#eef1f2', cols: 4, rows: 4, tileW: 12, tileH: 14, mx: 0.1, top: 0.25, wh: 0.5, glassA: '#6fa7c7', glassB: '#1c3f55', frame: '#c5ced2', frameW: 4, lit: 0.6, wallR: 0.7, glassR: 0.06, metal: 0.1 },
  police:    { wall: '#2e3f5c', cols: 4, rows: 4, tileW: 12, tileH: 14, mx: 0.12, top: 0.25, wh: 0.5, glassA: '#8fb3d9', glassB: '#1c2c45', frame: '#d0d6e0', frameW: 4, lit: 0.6, wallR: 0.7, glassR: 0.06, metal: 0.1 },
};

export function makeFacade(name) {
  const s = FACADE_STYLES[name];
  const S = 512;
  const c = mk(S, S), e = mk(S, S), r = mk(S, S);
  const g = c.getContext('2d'), ge = e.getContext('2d'), gr = r.getContext('2d');
  const rng = mulberry32(hashStr(name));
  g.fillStyle = s.wall; g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  gr.fillStyle = gray(s.wallR); gr.fillRect(0, 0, S, S);
  const cw = S / s.cols, rh = S / s.rows;

  if (s.brick) {
    for (let y = 0; y < S; y += 8) {
      const off = (y / 8) % 2 ? 0 : 10;
      for (let x = -20; x < S; x += 20) {
        const v = 0.8 + rng() * 0.35;
        g.fillStyle = `rgb(${125 * v | 0},${58 * v | 0},${44 * v | 0})`;
        g.fillRect(x + off, y, 18, 6);
      }
    }
  }
  if (s.corrugated) {
    for (let x = 0; x < S; x += 8) {
      const grd = g.createLinearGradient(x, 0, x + 8, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = grd; g.fillRect(x, 0, 8, S);
    }
    blotches(g, S, S, 12, rng, '70,40,20', 0.25, 20, 60);
  }
  if (s.concrete) {
    for (let y = 0; y < S; y += rh) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, S, 3); }
    blotches(g, S, S, 20, rng, '40,40,40', 0.15, 10, 50);
  }
  if (s.deco) {
    for (let row = 0; row < s.rows; row++) {
      const y = row * rh;
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, y + rh * 0.1, S, rh * 0.06);
      g.fillStyle = s.deco; g.fillRect(0, y + rh * 0.8, S, rh * 0.05);
    }
    for (let col = 0; col < s.cols; col++) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(col * cw + cw * 0.46, 0, cw * 0.08, S);
    }
  }

  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) {
      const wx = col * cw + cw * s.mx, wy = row * rh + rh * s.top, ww = cw * (1 - 2 * s.mx), wh = rh * s.wh;
      const grd = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
      grd.addColorStop(0, s.glassA); grd.addColorStop(1, s.glassB);
      g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
      // sky reflection streak
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath(); g.moveTo(wx + ww * 0.1, wy + wh); g.lineTo(wx + ww * 0.45, wy); g.lineTo(wx + ww * 0.6, wy); g.lineTo(wx + ww * 0.25, wy + wh); g.fill();
      g.strokeStyle = s.frame; g.lineWidth = s.frameW; g.strokeRect(wx, wy, ww, wh);
      if (ww > 40) { g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke(); }
      if (s.shutters) {
        g.fillStyle = s.shutters;
        g.fillRect(wx - ww * 0.28, wy, ww * 0.24, wh); g.fillRect(wx + ww * 1.04, wy, ww * 0.24, wh);
      }
      gr.fillStyle = gray(s.glassR); gr.fillRect(wx, wy, ww, wh);
      // night lights
      if (rng() < s.lit * 0.8) {
        const t = rng();
        let col2;
        if (t < 0.7) col2 = `hsl(${32 + rng() * 14},${70 + rng() * 20}%,${38 + rng() * 18}%)`;
        else if (t < 0.93) col2 = `hsl(${195 + rng() * 25},${35 + rng() * 25}%,${45 + rng() * 15}%)`;
        else col2 = `hsl(${rng() < 0.5 ? 300 + rng() * 30 : 170 + rng() * 20},80%,45%)`;
        const lg = ge.createLinearGradient(wx, wy, wx, wy + wh);
        lg.addColorStop(0, col2); lg.addColorStop(1, 'rgba(0,0,0,0.6)');
        ge.fillStyle = lg; ge.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        if (rng() < 0.4) { // blinds
          ge.fillStyle = 'rgba(0,0,0,0.45)';
          for (let yy = wy + 4; yy < wy + wh; yy += 5) ge.fillRect(wx, yy, ww, 2);
        }
        if (rng() < 0.3) { // silhouette / furniture
          ge.fillStyle = 'rgba(0,0,0,0.7)';
          ge.fillRect(wx + ww * rng() * 0.6, wy + wh * 0.5, ww * 0.2, wh * 0.5);
        }
      }
    }
  }
  addNoise(g, S, S, 14, rng);
  const map = toTex(c), emissiveMap = toTex(e), roughnessMap = toTex(r, { srgb: false });
  return { map, emissiveMap, roughnessMap, style: s };
}

// ------------------------------------------------------------ ground surfaces
export function makeRoad() {
  const W = 256, H = 256; // 14m x 14m
  const c = mk(W, H), g = c.getContext('2d'), rng = mulberry32(11);
  g.fillStyle = '#3c3d42'; g.fillRect(0, 0, W, H);
  blotches(g, W, H, 30, rng, '15,15,18', 0.4, 8, 40);
  blotches(g, W, H, 10, rng, '80,80,85', 0.15, 10, 30);
  addNoise(g, W, H, 28, rng);
  const m = W / 14;
  // gutters
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, m * 0.5, H); g.fillRect(W - m * 0.5, 0, m * 0.5, H);
  // parking lane lines (solid white)
  g.fillStyle = 'rgba(235,235,230,0.85)';
  g.fillRect(m * 3 - 2, 0, 3, H); g.fillRect(m * 11 - 1, 0, 3, H);
  // double yellow
  g.fillStyle = 'rgba(240,190,40,0.95)';
  g.fillRect(m * 7 - 6, 0, 4, H); g.fillRect(m * 7 + 2, 0, 4, H);
  // cracks
  g.strokeStyle = 'rgba(10,10,10,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    let x = rng() * W, y = rng() * H; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 20; y += rng() * 14; g.lineTo(x, y); }
    g.stroke();
  }
  addNoise(g, W, H, 10, rng);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 1.5), { srgb: false }) };
}
export function makeIntersection() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(12);
  g.fillStyle = '#3c3d42'; g.fillRect(0, 0, W, W);
  blotches(g, W, W, 30, rng, '15,15,18', 0.4, 8, 40);
  addNoise(g, W, W, 28, rng);
  const m = W / 14;
  g.fillStyle = 'rgba(235,235,230,0.85)';
  for (let k = 0; k < 7; k++) {
    const p = m * 1.3 + k * m * 1.7;
    g.fillRect(p, 0, m * 0.8, m * 2.2); g.fillRect(p, W - m * 2.2, m * 0.8, m * 2.2);
    g.fillRect(0, p, m * 2.2, m * 0.8); g.fillRect(W - m * 2.2, p, m * 2.2, m * 0.8);
  }
  addNoise(g, W, W, 10, rng);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 1.2), { srgb: false }) };
}
export function makeSidewalk() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(13); // 4m x 4m
  g.fillStyle = '#a9a39a'; g.fillRect(0, 0, W, W);
  blotches(g, W, W, 25, rng, '60,55,50', 0.18, 8, 30);
  addNoise(g, W, W, 22, rng);
  g.fillStyle = 'rgba(40,38,35,0.55)';
  for (let k = 0; k < 4; k++) { g.fillRect(k * 64, 0, 2, W); g.fillRect(0, k * 64, W, 2); }
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 2.5), { srgb: false }) };
}
export function makeConcrete(seed = 14, base = '#8f8b84') {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, W, W);
  blotches(g, W, W, 40, rng, '50,48,45', 0.2, 10, 50);
  blotches(g, W, W, 15, rng, '200,200,195', 0.1, 10, 40);
  addNoise(g, W, W, 26, rng);
  g.fillStyle = 'rgba(30,30,30,0.4)'; g.fillRect(0, 0, W, 2); g.fillRect(0, 0, 2, W);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 1.5), { srgb: false }) };
}
export function makeGrass() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(15);
  g.fillStyle = '#3d6b2c'; g.fillRect(0, 0, W, W);
  blotches(g, W, W, 40, rng, '90,120,40', 0.35, 10, 40);
  blotches(g, W, W, 30, rng, '30,60,25', 0.35, 10, 40);
  for (let i = 0; i < 5000; i++) {
    const x = rng() * W, y = rng() * W, l = 2 + rng() * 4;
    g.strokeStyle = `hsla(${80 + rng() * 30},${40 + rng() * 30}%,${22 + rng() * 25}%,0.8)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 2, y - l); g.stroke();
  }
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 2), { srgb: false }) };
}
export function makeSand() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(16);
  g.fillStyle = '#d9c192'; g.fillRect(0, 0, W, W);
  blotches(g, W, W, 40, rng, '190,160,110', 0.3, 10, 40);
  blotches(g, W, W, 20, rng, '240,225,190', 0.3, 10, 30);
  for (let y = 0; y < W; y += 6) {
    g.strokeStyle = 'rgba(150,120,80,0.12)'; g.beginPath();
    for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin((x / W) * Math.PI * 4 + y) * 2);
    g.stroke();
  }
  addNoise(g, W, W, 30, rng);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 2), { srgb: false }) };
}
export function makeParking() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(17); // 10m x 10m
  g.fillStyle = '#34353a'; g.fillRect(0, 0, W, W);
  blotches(g, W, W, 30, rng, '15,15,18', 0.4, 8, 40);
  addNoise(g, W, W, 26, rng);
  g.fillStyle = 'rgba(235,235,225,0.8)';
  for (let k = 0; k < 4; k++) g.fillRect(k * 64, 0, 3, W * 0.5);
  g.fillRect(0, W * 0.5, W, 3);
  for (let k = 0; k < 4; k++) g.fillRect(k * 64, W * 0.5 + 3, 3, W * 0.5);
  return { map: toTex(c) };
}
export function makeRoofGravel() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(18);
  g.fillStyle = '#4a4a4c'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 6000; i++) { g.fillStyle = gray(0.15 + rng() * 0.3); g.fillRect(rng() * W, rng() * W, 2, 2); }
  blotches(g, W, W, 20, rng, '20,20,20', 0.3, 10, 50);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 2), { srgb: false }) };
}
export function makeRoofTiles() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(19);
  g.fillStyle = '#b3573a'; g.fillRect(0, 0, W, W);
  for (let y = 0; y < W; y += 16) {
    for (let x = (y / 16) % 2 ? -8 : 0; x < W; x += 16) {
      const v = 0.8 + rng() * 0.3;
      const grd = g.createLinearGradient(0, y, 0, y + 16);
      grd.addColorStop(0, `rgb(${200 * v | 0},${100 * v | 0},${65 * v | 0})`);
      grd.addColorStop(1, `rgb(${120 * v | 0},${55 * v | 0},${35 * v | 0})`);
      g.fillStyle = grd; g.beginPath(); g.ellipse(x + 8, y + 8, 8, 9, 0, 0, Math.PI * 2); g.fill();
    }
  }
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 3), { srgb: false }) };
}
export function makeWood() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(20); // 4m x 4m
  for (let k = 0; k < 8; k++) {
    const v = 0.75 + rng() * 0.3;
    g.fillStyle = `rgb(${130 * v | 0},${92 * v | 0},${62 * v | 0})`; g.fillRect(0, k * 32, W, 32);
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(60,40,25,${0.1 + rng() * 0.2})`;
      g.beginPath(); const y = k * 32 + rng() * 32; g.moveTo(0, y);
      g.bezierCurveTo(W * 0.3, y + (rng() - 0.5) * 6, W * 0.6, y + (rng() - 0.5) * 6, W, y); g.stroke();
    }
    g.fillStyle = 'rgba(20,12,6,0.8)'; g.fillRect(0, k * 32, W, 2);
    g.fillStyle = 'rgba(30,30,30,0.9)';
    g.fillRect(20, k * 32 + 8, 3, 3); g.fillRect(20, k * 32 + 22, 3, 3);
    g.fillRect(148, k * 32 + 8, 3, 3); g.fillRect(148, k * 32 + 22, 3, 3);
  }
  addNoise(g, W, W, 16, rng);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 2), { srgb: false }) };
}
export function makeCorrugated() {
  const W = 128, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(21);
  g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, W, W);
  for (let x = 0; x < W; x += 8) {
    const grd = g.createLinearGradient(x, 0, x + 8, 0);
    grd.addColorStop(0, '#8a8a8a'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(1, '#8a8a8a');
    g.fillStyle = grd; g.fillRect(x, 0, 8, W);
  }
  blotches(g, W, W, 8, rng, '90,60,40', 0.35, 5, 25);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, W, 3); g.fillRect(0, W - 3, W, 3);
  return { map: toTex(c) };
}
export function makeShopfront() {
  const W = 512, H = 256; // 8m x 4m
  const c = mk(W, H), e = mk(W, H), g = c.getContext('2d'), ge = e.getContext('2d'), rng = mulberry32(22);
  g.fillStyle = '#2a2622'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  // big windows + door
  const panes = [[16, 40, 180, 190], [316, 40, 180, 190]];
  for (const [x, y, w, h] of panes) {
    const grd = g.createLinearGradient(x, y, x, y + h); grd.addColorStop(0, '#5c7d8a'); grd.addColorStop(1, '#1d2a30');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    const eg = ge.createLinearGradient(x, y, x, y + h); eg.addColorStop(0, '#ffcf8a'); eg.addColorStop(1, '#a8603a');
    ge.fillStyle = eg; ge.fillRect(x + 3, y + 3, w - 6, h - 6);
    ge.fillStyle = 'rgba(0,0,0,0.55)'; // shelves
    for (let k = 0; k < 4; k++) ge.fillRect(x + 10, y + 40 + k * 38, w - 20, 5);
    g.strokeStyle = '#b8b0a2'; g.lineWidth = 5; g.strokeRect(x, y, w, h);
  }
  g.fillStyle = '#3b4a52'; g.fillRect(212, 50, 88, 206);
  ge.fillStyle = '#7a4a28'; ge.fillRect(218, 56, 76, 200);
  g.strokeStyle = '#b8b0a2'; g.lineWidth = 5; g.strokeRect(212, 50, 88, 206);
  g.fillStyle = '#a58a5a'; g.fillRect(280, 150, 6, 20);
  addNoise(g, W, H, 12, rng);
  return { map: toTex(c), emissiveMap: toTex(e) };
}
export function makeAwning() {
  const W = 128, c = mk(W, W), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, W);
  g.fillStyle = '#cfcfcf';
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 16, W);
  return { map: toTex(c) };
}
export function makeBark() {
  const W = 64, H = 256, c = mk(W, H), g = c.getContext('2d'), rng = mulberry32(23);
  g.fillStyle = '#7a6448'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 10) {
    g.fillStyle = `rgba(40,30,20,${0.4 + rng() * 0.3})`; g.fillRect(0, y, W, 3);
    g.fillStyle = 'rgba(170,150,120,0.25)'; g.fillRect(0, y + 4, W, 2);
  }
  addNoise(g, W, H, 25, rng);
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 3), { srgb: false }) };
}
export function makePalmLeaf() {
  const W = 128, H = 512, c = mk(W, H), g = c.getContext('2d'), rng = mulberry32(24);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#4b5d24'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 0); g.stroke();
  for (let y = 10; y < H - 10; y += 7) {
    const t = y / H, len = Math.sin(t * Math.PI) * W * 0.48 + 6;
    for (const s of [-1, 1]) {
      g.strokeStyle = `hsl(${85 + rng() * 25},${45 + rng() * 20}%,${22 + rng() * 16}%)`;
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * len * 0.6, y - 6, W / 2 + s * len, y - 16 - rng() * 8); g.stroke();
    }
  }
  const t = toTex(c, { repeat: false });
  return { map: t };
}
export function makeLeafCluster() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(25);
  g.fillStyle = '#35592a'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `hsl(${85 + rng() * 40},${35 + rng() * 25}%,${16 + rng() * 26}%)`;
    g.beginPath(); g.ellipse(rng() * W, rng() * W, 4 + rng() * 5, 2 + rng() * 3, rng() * 3, 0, Math.PI * 2); g.fill();
  }
  return { map: toTex(c), normalMap: toTex(normalFromCanvas(c, 3), { srgb: false }) };
}

// Water normal map made from a sum of tileable sine waves.
export function makeWaterNormal() {
  const W = 256, c = mk(W, W), g = c.getContext('2d'), img = g.createImageData(W, W), d = img.data;
  const rng = mulberry32(26);
  const waves = [];
  for (let i = 0; i < 48; i++) {
    const f = 1 + Math.floor(rng() * rng() * 22), ang = rng() * Math.PI * 2;
    waves.push({ kx: Math.round(Math.cos(ang) * f), ky: Math.round(Math.sin(ang) * f), a: (0.4 + rng()) / Math.sqrt(f), p: rng() * 6.28 });
  }
  const hgt = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let h = 0;
    for (const w of waves) h += w.a * Math.sin(((w.kx * x + w.ky * y) / W) * Math.PI * 2 + w.p) / (1 + Math.hypot(w.kx, w.ky) * 0.15);
    hgt[y * W + x] = h;
  }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = hgt[y * W + ((x + 1) % W)] - hgt[y * W + ((x - 1 + W) % W)];
    const dy = hgt[((y + 1) % W) * W + x] - hgt[((y - 1 + W) % W) * W + x];
    let nx = -dx * 0.6, ny = -dy * 0.6, nz = 1; const l = Math.hypot(nx, ny, nz);
    const k = (y * W + x) * 4;
    d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (nz / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, { srgb: false });
}

// ------------------------------------------------------------ particles / fx sprites
export function makeSoftDot() {
  const W = 64, c = mk(W, W), g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, W);
  return toTex(c, { repeat: false, srgb: false });
}
export function makeSmokePuff() {
  const W = 128, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(27);
  for (let i = 0; i < 26; i++) {
    const a = rng() * 6.28, r = rng() * 30, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rad = 18 + rng() * 22;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
  }
  return toTex(c, { repeat: false, srgb: false });
}
export function makeFlashStar() {
  const W = 128, c = mk(W, W), g = c.getContext('2d');
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 40);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.3, 'rgba(255,200,90,0.8)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,230,160,0.9)';
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-5, 0); g.lineTo(0, 62); g.lineTo(5, 0); g.fill();
  }
  return toTex(c, { repeat: false });
}
export function makeLightPool() {
  const W = 128, c = mk(W, W), g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, W);
  return toTex(c, { repeat: false });
}
export function makeBeam() {
  const W = 8, H = 128, c = mk(W, H), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  return toTex(c, { repeat: false });
}
export function makeDecal(kind) {
  const W = 64, c = mk(W, W), g = c.getContext('2d'), rng = mulberry32(kind.length * 99);
  if (kind === 'hole') {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.25, 'rgba(20,18,16,0.9)'); grd.addColorStop(0.5, 'rgba(60,55,50,0.4)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
  } else if (kind === 'blood') {
    g.fillStyle = 'rgba(110,5,5,0.9)';
    for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(32 + (rng() - 0.5) * 36, 32 + (rng() - 0.5) * 36, 3 + rng() * 10, 0, 7); g.fill(); }
  } else if (kind === 'scorch') {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.95)'); grd.addColorStop(0.6, 'rgba(10,8,6,0.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
  }
  return toTex(c, { repeat: false });
}

// ------------------------------------------------------------ neon sign atlas
export const SHOP_NAMES = ['TACOS', 'DINER', 'PAWN', 'LIQUOR', 'ARCADE', 'VIDEO', 'MOTEL', 'SURF SHOP', 'RECORDS', 'PIZZA',
  'BAR', 'CAFE', 'LAUNDRY', 'PHARMACY', 'TATTOO', 'NAILS', 'DONUTS', 'CLUB', 'DISCO', 'SUSHI', 'BURGERS', 'BOOKS', 'RADIO',
  'PALMS', 'CASINO', 'GYM', 'BEAUTY', 'CUBAN CAFE', 'SEAFOOD', 'JUICE BAR', 'ICE CREAM', 'PHOTO', 'DELI', 'BODEGA', 'NOODLES',
  'LOUNGE', 'BILLIARDS', 'BOUTIQUE', 'CIGARS', 'ELECTRONICS', 'FLORIST', 'BAKERY', 'KARAOKE', 'GARAGE', 'HARDWARE', 'OPTICS',
  'CHECKS CASHED', 'COCKTAILS', 'SALON', 'JEWELRY', 'SNEAKERS', 'BAIT & TACKLE', 'SODA', 'WAFFLES', 'HOT DOGS', 'MUSIC', 'TOYS',
  'THRIFT', 'DENTIST', 'GRILL', 'BISTRO', 'SMOOTHIES', 'ESPRESSO', 'MARKET'];
const NEON_COLORS = ['#ff3fa4', '#35f2ff', '#ffe14d', '#a36bff', '#4dff8a', '#ff7a3c', '#ff4d6d', '#6bc7ff'];
export function makeSignAtlas() {
  const W = 1024, H = 1024, cols = 4, rows = 16, cw = W / cols, ch = H / rows;
  const c = mk(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rects = [];
  for (let k = 0; k < cols * rows; k++) {
    const col = k % cols, row = Math.floor(k / cols), x = col * cw, y = row * ch;
    const name = SHOP_NAMES[k % SHOP_NAMES.length];
    const color = NEON_COLORS[k % NEON_COLORS.length];
    g.fillStyle = k % 3 === 0 ? '#101018' : '#07070b'; g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    g.strokeStyle = color; g.lineWidth = 2; g.globalAlpha = 0.6; g.strokeRect(x + 5, y + 5, cw - 10, ch - 10); g.globalAlpha = 1;
    let fs = 38; g.font = `bold ${fs}px "Trebuchet MS", Arial, sans-serif`;
    while (g.measureText(name).width > cw - 24 && fs > 12) { fs -= 2; g.font = `bold ${fs}px "Trebuchet MS", Arial, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = color; g.fillText(name, x + cw / 2, y + ch / 2 + 2);
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(name, x + cw / 2, y + ch / 2 + 2);
    rects.push({ u0: x / W, u1: (x + cw) / W, v0: 1 - (y + ch) / H, v1: 1 - y / H });
  }
  const t = toTex(c, { repeat: false });
  return { map: t, rects };
}
export const HOTEL_NAMES = ['MIRAGE', 'CORAL', 'AZURE', 'PARADISO', 'NOCTURNE', 'PELICAN', 'STARLIGHT', 'SEABREEZE'];
export function makeVerticalSignAtlas() {
  const n = HOTEL_NAMES.length, cw = 128, H = 640, W = cw * n;
  const c = mk(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rects = [];
  HOTEL_NAMES.forEach((name, k) => {
    const x = k * cw, color = NEON_COLORS[(k * 3) % NEON_COLORS.length];
    g.fillStyle = '#0b0b14'; g.fillRect(x + 4, 4, cw - 8, H - 8);
    g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 12; g.strokeRect(x + 12, 12, cw - 24, H - 24);
    const letters = name.split(''); const step = (H - 60) / letters.length;
    g.font = `bold ${Math.min(70, step * 0.9)}px "Trebuchet MS", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    letters.forEach((ch, i) => {
      g.shadowBlur = 16; g.fillStyle = color; g.fillText(ch, x + cw / 2, 30 + step * (i + 0.5));
      g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(ch, x + cw / 2, 30 + step * (i + 0.5));
    });
    g.shadowBlur = 0;
    rects.push({ u0: x / W, u1: (x + cw) / W, v0: 0, v1: 1 });
  });
  return { map: toTex(c, { repeat: false }), rects };
}
export function makeTextSign(text, color = '#ff3fa4', w = 512, h = 128, bg = '#07070b', sub = null) {
  const c = mk(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 16; g.strokeRect(8, 8, w - 16, h - 16);
  let fs = Math.floor(h * (sub ? 0.45 : 0.6)); g.font = `bold ${fs}px "Trebuchet MS", Arial, sans-serif`;
  while (g.measureText(text).width > w - 40 && fs > 10) { fs -= 2; g.font = `bold ${fs}px "Trebuchet MS", Arial, sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const ty = sub ? h * 0.4 : h / 2;
  g.fillStyle = color; g.fillText(text, w / 2, ty);
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(text, w / 2, ty);
  if (sub) { g.font = `bold ${Math.floor(h * 0.2)}px Arial`; g.fillStyle = color; g.fillText(sub, w / 2, h * 0.76); }
  return toTex(c, { repeat: false });
}
