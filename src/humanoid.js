// Procedurally built skinned humanoid (one draw call per character) + procedural animation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, pick } from './utils.js';

const BONES = ['root', 'hips', 'spine', 'chest', 'head', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
const PARTS = ['pelvis', 'belt', 'abdomen', 'chest', 'shoulder', 'neck', 'head', 'hair', 'eyes', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'shoe', 'nose'];
const PI = Object.fromEntries(PARTS.map((p, i) => [p, i]));

let TEMPLATE = null;
function buildTemplate() {
  const pieces = [];
  const add = (geo, bone, part, x, y, z, sx = 1, sy = 1, sz = 1) => {
    geo.scale(sx, sy, sz); geo.translate(x, y, z);
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), pa = new Float32Array(n);
    for (let i = 0; i < n; i++) { si[i * 4] = BI[bone]; sw[i * 4] = 1; pa[i] = PI[part]; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('part', new THREE.Float32BufferAttribute(pa, 1));
    pieces.push(geo);
  };
  add(new THREE.CylinderGeometry(0.165, 0.15, 0.2, 12), 'hips', 'pelvis', 0, 0.94, 0, 1, 1, 0.72);
  add(new THREE.CylinderGeometry(0.172, 0.172, 0.05, 12), 'hips', 'belt', 0, 1.04, 0, 1, 1, 0.74);
  add(new THREE.CylinderGeometry(0.17, 0.162, 0.22, 12), 'spine', 'abdomen', 0, 1.15, 0, 1, 1, 0.66);
  add(new THREE.CylinderGeometry(0.215, 0.172, 0.34, 12), 'chest', 'chest', 0, 1.37, 0, 1, 1, 0.62);
  add(new THREE.SphereGeometry(0.075, 10, 8), 'lShoulder', 'shoulder', 0.19, 1.45, 0);
  add(new THREE.SphereGeometry(0.075, 10, 8), 'rShoulder', 'shoulder', -0.19, 1.45, 0);
  add(new THREE.CylinderGeometry(0.052, 0.06, 0.12, 8), 'head', 'neck', 0, 1.58, 0);
  add(new THREE.SphereGeometry(0.115, 16, 12), 'head', 'head', 0, 1.71, 0.01, 0.9, 1.1, 1.0);
  add(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'head', 'hair', 0, 1.735, -0.008, 0.95, 1.08, 1.06);
  add(new THREE.BoxGeometry(0.028, 0.045, 0.04), 'head', 'nose', 0, 1.695, 0.12);
  add(new THREE.BoxGeometry(0.03, 0.018, 0.01), 'head', 'eyes', 0.04, 1.725, 0.108);
  add(new THREE.BoxGeometry(0.03, 0.018, 0.01), 'head', 'eyes', -0.04, 1.725, 0.108);
  add(new THREE.CapsuleGeometry(0.052, 0.2, 4, 8), 'lShoulder', 'upperArm', 0.19, 1.31, 0);
  add(new THREE.CapsuleGeometry(0.052, 0.2, 4, 8), 'rShoulder', 'upperArm', -0.19, 1.31, 0);
  add(new THREE.CapsuleGeometry(0.043, 0.2, 4, 8), 'lElbow', 'foreArm', 0.19, 1.03, 0);
  add(new THREE.CapsuleGeometry(0.043, 0.2, 4, 8), 'rElbow', 'foreArm', -0.19, 1.03, 0);
  add(new THREE.SphereGeometry(0.05, 8, 6), 'lElbow', 'hand', 0.19, 0.86, 0.005, 0.8, 1.15, 0.65);
  add(new THREE.SphereGeometry(0.05, 8, 6), 'rElbow', 'hand', -0.19, 0.86, 0.005, 0.8, 1.15, 0.65);
  add(new THREE.CapsuleGeometry(0.078, 0.28, 4, 10), 'lHip', 'thigh', 0.1, 0.69, 0);
  add(new THREE.CapsuleGeometry(0.078, 0.28, 4, 10), 'rHip', 'thigh', -0.1, 0.69, 0);
  add(new THREE.CapsuleGeometry(0.058, 0.3, 4, 8), 'lKnee', 'shin', 0.1, 0.27, 0);
  add(new THREE.CapsuleGeometry(0.058, 0.3, 4, 8), 'rKnee', 'shin', -0.1, 0.27, 0);
  add(new THREE.BoxGeometry(0.1, 0.08, 0.26), 'lKnee', 'shoe', 0.1, 0.04, 0.04);
  add(new THREE.BoxGeometry(0.1, 0.08, 0.26), 'rKnee', 'shoe', -0.1, 0.04, 0.04);
  const g = mergeGeometries(pieces);
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  g.boundingSphere.radius = 1.4;
  TEMPLATE = g;
}

export const SKIN_TONES = ['#f1c7a5', '#e0ac85', '#c68a62', '#a86b45', '#7d4a2d', '#5a3420', '#f5d3b8'];
const SHIRTS = ['#e84a5f', '#2ec4b6', '#ffbf69', '#f7f7f2', '#3a86ff', '#8338ec', '#ff006e', '#06d6a0', '#ffd166', '#118ab2', '#ef476f', '#264653', '#e9c46a', '#f4a261', '#ffffff', '#1d3557'];
const PANTS = ['#1d3557', '#2b2d42', '#f1faee', '#a8dadc', '#6c584c', '#3d405b', '#e0e1dd', '#264653', '#8d99ae', '#403d39'];
const HAIR = ['#1b1b1b', '#3b2416', '#6b4423', '#c49a6c', '#e3c16f', '#8a8a8a', '#b5412b', '#2b1a10'];
const SHOES = ['#1b1b1b', '#f5f5f5', '#6b4423', '#c1121f', '#3a3a3a'];

export function randomAppearance() {
  return {
    skin: pick(SKIN_TONES), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), shoes: pick(SHOES),
    sleeves: pick(['short', 'short', 'none', 'long']), shorts: Math.random() < 0.35, bald: Math.random() < 0.08,
    build: 0.92 + Math.random() * 0.16,
  };
}

const tmpC = new THREE.Color();
export function applyAppearance(geo, a) {
  const part = geo.attributes.part, col = geo.attributes.color;
  const c = {};
  c.skin = new THREE.Color(a.skin); c.shirt = new THREE.Color(a.shirt); c.pants = new THREE.Color(a.pants);
  c.hair = new THREE.Color(a.bald ? a.skin : a.hair); c.shoes = new THREE.Color(a.shoes); c.dark = new THREE.Color('#141414');
  c.belt = new THREE.Color(a.belt || '#2a2016');
  const map = {
    pelvis: c.pants, belt: c.belt, abdomen: c.shirt, chest: c.shirt, shoulder: a.sleeves === 'none' ? c.skin : c.shirt,
    neck: c.skin, head: c.skin, hair: c.hair, eyes: a.glasses ? c.dark : c.dark, nose: c.skin,
    upperArm: a.sleeves === 'none' ? c.skin : c.shirt, foreArm: a.sleeves === 'long' ? c.shirt : c.skin, hand: a.gloves ? c.dark : c.skin,
    thigh: c.pants, shin: a.shorts ? c.skin : c.pants, shoe: c.shoes,
  };
  if (a.vest) { map.chest = new THREE.Color(a.vest); map.abdomen = new THREE.Color(a.vest); }
  if (a.glasses) map.eyes = c.dark;
  for (let i = 0; i < part.count; i++) {
    const p = PARTS[part.getX(i)];
    tmpC.copy(map[p] || c.skin);
    col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
  }
  col.needsUpdate = true;
}

let SHARED_MAT = null;
export function createHumanoid(appearance) {
  if (!TEMPLATE) buildTemplate();
  if (!SHARED_MAT) SHARED_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
  const geo = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight', 'part']) geo.setAttribute(k, TEMPLATE.attributes[k]);
  geo.setIndex(TEMPLATE.index);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(TEMPLATE.attributes.position.count * 3), 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  applyAppearance(geo, appearance);

  const b = {};
  const mk = (name, parent, x, y, z) => { const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, z); if (parent) parent.add(bone); b[name] = bone; return bone; };
  const root = mk('root', null, 0, 0, 0);
  const hips = mk('hips', root, 0, 0.95, 0);
  const spine = mk('spine', hips, 0, 0.1, 0);
  const chest = mk('chest', spine, 0, 0.2, 0);
  mk('head', chest, 0, 0.3, 0);
  const lS = mk('lShoulder', chest, 0.19, 0.2, 0); mk('lElbow', lS, 0, -0.29, 0);
  const rS = mk('rShoulder', chest, -0.19, 0.2, 0); mk('rElbow', rS, 0, -0.29, 0);
  const lH = mk('lHip', hips, 0.1, -0.04, 0); mk('lKnee', lH, 0, -0.43, 0);
  const rH = mk('rHip', hips, -0.1, -0.04, 0); mk('rKnee', rH, 0, -0.43, 0);
  const mesh = new THREE.SkinnedMesh(geo, SHARED_MAT);
  mesh.add(root);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => b[n])));
  mesh.castShadow = true; mesh.receiveShadow = true;
  const s = appearance.build || 1;
  mesh.scale.setScalar(s);
  return { mesh, bones: b, geo };
}

// ---------------------------------------------------------------- animation
const KEYS = ['hipsY', 'hipsRX', 'hipsRY', 'spineRX', 'chestRX', 'chestRY', 'headRX', 'lShX', 'lShZ', 'lElX', 'rShX', 'rShZ', 'rElX', 'lHipX', 'lHipZ', 'lKneeX', 'rHipX', 'rHipZ', 'rKneeX', 'rootRX', 'rootY', 'rootRZ'];
export class Animator {
  constructor(bones) {
    this.b = bones; this.phase = Math.random() * 6; this.t = Math.random() * 10;
    this.cur = {}; this.tgt = {};
    for (const k of KEYS) { this.cur[k] = 0; this.tgt[k] = 0; }
    this.cur.hipsY = 0.95;
    this.deadT = 0;
  }
  update(dt, s) {
    this.t += dt;
    const T = this.tgt;
    for (const k of KEYS) T[k] = 0;
    T.hipsY = 0.95;
    const speed = s.speed || 0;
    let rate = 14;
    if (s.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deadT, 3);
      T.rootRX = -Math.PI / 2 * e; T.rootY = 0.14 * e; T.rootRZ = (s.deadSide || 0) * 0.3 * e;
      T.lShX = -0.4; T.lShZ = 1.3; T.rShX = -0.3; T.rShZ = -1.2; T.lElX = -0.5; T.rElX = -0.3;
      T.lHipX = -0.2; T.lHipZ = 0.2; T.rHipX = 0.1; T.rHipZ = -0.25; T.lKneeX = 0.4; T.rKneeX = 0.1; T.headRX = -0.3 * (s.deadSide || 0.5);
      rate = 10;
    } else {
      this.deadT = 0;
      if (s.drive) {
        T.hipsY = 0.95; T.lHipX = T.rHipX = -1.45; T.lKneeX = T.rKneeX = 1.35;
        T.lShX = T.rShX = -0.95; T.lElX = T.rElX = -0.55; T.lShZ = -0.1; T.rShZ = 0.1;
        T.rShX += (s.steer || 0) * 0.25; T.lShX -= (s.steer || 0) * 0.25;
        T.spineRX = -0.1;
      } else if (s.swim) {
        this.phase += dt * 3;
        T.rootRX = 1.25; T.rootY = 0;
        T.lShX = -2.6 + Math.sin(this.phase) * 1.2; T.rShX = -2.6 - Math.sin(this.phase) * 1.2;
        T.lShZ = 0.4; T.rShZ = -0.4;
        T.lHipX = Math.sin(this.phase * 2) * 0.4; T.rHipX = -Math.sin(this.phase * 2) * 0.4;
        T.headRX = -0.9;
      } else if (s.cower) {
        T.hipsY = 0.55; T.lHipX = T.rHipX = -1.5; T.lKneeX = T.rKneeX = 2.3; T.spineRX = 0.5;
        T.lShX = T.rShX = -2.4; T.lElX = T.rElX = -1.9; T.lShZ = 0.2; T.rShZ = -0.2; T.headRX = 0.4;
      } else {
        // locomotion
        const w = clamp(speed / 1.6, 0, 1), r = clamp((speed - 2.2) / 4, 0, 1);
        const stride = lerp(1.35, 2.5, r);
        this.phase += dt * speed / stride * Math.PI * 2 * (s.back ? -1 : 1);
        const ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph);
        const swing = 0.42 * w + 0.4 * r;
        T.lHipX = -sn * swing; T.rHipX = sn * swing;
        T.lKneeX = (0.08 + Math.max(0, Math.sin(ph + 1.4)) * (0.55 + 0.9 * r)) * w;
        T.rKneeX = (0.08 + Math.max(0, Math.sin(ph + Math.PI + 1.4)) * (0.55 + 0.9 * r)) * w;
        T.lShX = sn * swing * 0.8; T.rShX = -sn * swing * 0.8;
        T.lElX = -(0.15 + 1.1 * r); T.rElX = -(0.15 + 1.1 * r);
        T.lShZ = 0.08; T.rShZ = -0.08;
        T.hipsY = 0.95 - Math.abs(cs) * 0.045 * (w + r) - r * 0.04;
        T.spineRX = 0.04 * w + 0.22 * r; T.chestRX = 0.02 * w;
        T.hipsRY = sn * 0.12 * w; T.chestRY = -sn * 0.18 * w;
        // idle breathing
        const br = Math.sin(this.t * 1.8) * 0.02 * (1 - w);
        T.chestRX += br; T.lShZ += br; T.rShZ -= br;
        if (!s.grounded) {
          T.lHipX = -0.7; T.lKneeX = 1.1; T.rHipX = 0.25; T.rKneeX = 0.5;
          T.lShZ = 0.5; T.rShZ = -0.5; T.lShX = -0.4; T.rShX = -0.2;
          rate = 10;
        }
        if (s.handsUp) { T.lShX = T.rShX = -3.0; T.lElX = T.rElX = -0.4; T.lShZ = 0.3; T.rShZ = -0.3; }
      }
      // upper body overrides: aiming / punching
      if (s.aim > 0.01 && !s.drive && !s.swim) {
        const p = s.aimPitch || 0;
        const a = s.aim;
        const rx = -Math.PI / 2 - p;
        if (s.twoHanded) {
          T.rShX = lerp(T.rShX, rx + 0.12, a); T.rShZ = lerp(T.rShZ, 0.2, a); T.rElX = lerp(T.rElX, -0.25, a);
          T.lShX = lerp(T.lShX, rx + 0.2, a); T.lShZ = lerp(T.lShZ, -0.75, a); T.lElX = lerp(T.lElX, -0.75, a);
          T.chestRY = lerp(T.chestRY, 0.25, a); T.headRX = lerp(T.headRX, -p * 0.5, a);
        } else {
          T.rShX = lerp(T.rShX, rx, a); T.rShZ = lerp(T.rShZ, 0.08, a); T.rElX = lerp(T.rElX, 0, a);
          T.headRX = lerp(T.headRX, -p * 0.5, a);
        }
      } else if (s.carry && !s.drive) {
        T.rElX = -0.35;
      }
      if (s.punch > 0) {
        const k = Math.sin(s.punch * Math.PI);
        T.rShX = lerp(T.rShX, -1.5, k); T.rElX = lerp(T.rElX, -0.1, k); T.chestRY = lerp(T.chestRY, 0.4, k);
        T.lShX = -1.0; T.lElX = -1.6;
      }
    }
    const C = this.cur;
    for (const k of KEYS) C[k] = damp(C[k], T[k], rate, dt);
    const b = this.b;
    b.root.position.y = C.rootY; b.root.rotation.set(C.rootRX, 0, C.rootRZ);
    b.hips.position.y = C.hipsY; b.hips.rotation.set(C.hipsRX, C.hipsRY, 0);
    b.spine.rotation.set(C.spineRX, 0, 0);
    b.chest.rotation.set(C.chestRX, C.chestRY, 0);
    b.head.rotation.set(C.headRX, -C.chestRY * 0.5, 0);
    b.lShoulder.rotation.set(C.lShX, 0, C.lShZ); b.lElbow.rotation.set(C.lElX, 0, 0);
    b.rShoulder.rotation.set(C.rShX, 0, C.rShZ); b.rElbow.rotation.set(C.rElX, 0, 0);
    b.lHip.rotation.set(C.lHipX, 0, C.lHipZ); b.lKnee.rotation.set(C.lKneeX, 0, 0);
    b.rHip.rotation.set(C.rHipX, 0, C.rHipZ); b.rKnee.rotation.set(C.rKneeX, 0, 0);
  }
}
