// Vehicles: procedural models, arcade physics, damage/deformation, traffic & pursuit AI.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, WORLD, roadX, roadZ, terrainHeight } from './config.js';
import { clamp, damp, moveToward, rand, pick, wrapAngle, chance } from './utils.js';
import * as TX from './textures.js';

export const VEHICLES = {
  sedan:    { name: 'Coastal', L: 4.6, W: 1.86, wheelBase: 2.7, wheelR: 0.34, mass: 1400, accel: 9.5, maxSpeed: 44, brake: 22, grip: 10, maxSteer: 0.55, drag: 0.0021, health: 1000,
    p: { hood: 0.98, trunk: 0.95, belt: 1.02, roof: 1.44, cabBack: -1.25, cabFront: 0.8, roofBack: -0.75, roofFront: 0.2 },
    colors: ['#c9ccd1', '#2d3e50', '#8e1b2c', '#e8e4da', '#3d6b5a', '#5a6b7d', '#1d1d20', '#b88a4a', '#6aa6c9'] },
  coupe:    { name: 'Marlin GT', L: 4.45, W: 1.92, wheelBase: 2.6, wheelR: 0.34, mass: 1250, accel: 13, maxSpeed: 56, brake: 26, grip: 11.5, maxSteer: 0.55, drag: 0.0017, health: 900,
    p: { hood: 0.88, trunk: 0.9, belt: 0.93, roof: 1.27, cabBack: -1.15, cabFront: 0.55, roofBack: -0.7, roofFront: -0.05 },
    colors: ['#ff4f8b', '#2ec4c6', '#f5f5f5', '#ffcc33', '#1b1b1b', '#e63946', '#7b2cbf'] },
  supercar: { name: 'Bullet', L: 4.55, W: 2.02, wheelBase: 2.7, wheelR: 0.35, mass: 1200, accel: 17, maxSpeed: 68, brake: 30, grip: 13, maxSteer: 0.5, drag: 0.0014, health: 850,
    p: { hood: 0.78, trunk: 0.9, belt: 0.84, roof: 1.13, cabBack: -1.05, cabFront: 0.75, roofBack: -0.55, roofFront: 0.05 },
    colors: ['#ff2a2a', '#ffd400', '#f8f8f8', '#00b3b3', '#ff7a00', '#8a2be2'] },
  taxi:     { name: 'Cabbie', L: 4.7, W: 1.88, wheelBase: 2.75, wheelR: 0.34, mass: 1450, accel: 9, maxSpeed: 43, brake: 22, grip: 10, maxSteer: 0.55, drag: 0.0021, health: 1000,
    p: { hood: 0.98, trunk: 0.95, belt: 1.02, roof: 1.46, cabBack: -1.3, cabFront: 0.8, roofBack: -0.8, roofFront: 0.2 }, colors: ['#ffc21a'], taxi: true },
  police:   { name: 'Interceptor', L: 4.75, W: 1.9, wheelBase: 2.8, wheelR: 0.35, mass: 1550, accel: 12.5, maxSpeed: 55, brake: 26, grip: 11, maxSteer: 0.55, drag: 0.0018, health: 1400,
    p: { hood: 0.98, trunk: 0.95, belt: 1.02, roof: 1.45, cabBack: -1.3, cabFront: 0.8, roofBack: -0.8, roofFront: 0.2 }, colors: ['#f2f2f2'], police: true },
  van:      { name: 'Hauler', L: 5.2, W: 2.02, wheelBase: 3.1, wheelR: 0.37, mass: 2200, accel: 7, maxSpeed: 35, brake: 18, grip: 8.5, maxSteer: 0.5, drag: 0.0028, health: 1300,
    p: { hood: 1.1, trunk: 2.05, belt: 1.2, roof: 2.1, cabBack: 0.6, cabFront: 1.4, roofBack: 0.6, roofFront: 0.95, box: true },
    colors: ['#f0f0ea', '#5a7d9a', '#c9a227', '#8a3b2f', '#3d5a3a'] },
  pickup:   { name: 'Dune', L: 5.1, W: 2.0, wheelBase: 3.0, wheelR: 0.4, mass: 1900, accel: 9.5, maxSpeed: 42, brake: 20, grip: 9, maxSteer: 0.52, drag: 0.0024, health: 1250,
    p: { hood: 1.18, trunk: 1.12, belt: 1.2, roof: 1.78, cabBack: -0.55, cabFront: 0.85, roofBack: -0.45, roofFront: 0.35, bed: true },
    colors: ['#a33a2a', '#2c4a6b', '#d8d2c0', '#3e3e3e', '#6b7a3a'] },
};
const TRAFFIC_WEIGHTS = [['sedan', 30], ['taxi', 12], ['coupe', 12], ['van', 10], ['pickup', 11], ['supercar', 4], ['police', 4]];

// ---------------------------------------------------------------- models
const GEO_CACHE = {};
let SHARED = null;
function sharedMats() {
  if (SHARED) return SHARED;
  const beam = TX.makeBeam();
  SHARED = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1118, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.5 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }),
    bust: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
    beam: new THREE.MeshBasicMaterial({ map: beam, color: 0xfff0d0, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  for (const k of ['beam', 'glass']) SHARED[k].userData.noShadow = true;
  return SHARED;
}

function bodyShape(def) {
  const { L, wheelBase, wheelR, p } = def;
  const s = new THREE.Shape();
  const y0 = 0.3, r = wheelR + 0.07, zf = wheelBase / 2, zr = -wheelBase / 2, hl = L / 2;
  s.moveTo(-hl, y0 + 0.12);
  s.lineTo(-hl, p.trunk - 0.12);
  s.quadraticCurveTo(-hl, p.trunk, -hl + 0.18, p.trunk);
  if (p.box) { s.lineTo(-hl + 0.18, p.trunk); s.lineTo(p.cabBack, p.trunk); s.lineTo(p.cabBack, p.belt); }
  else if (p.bed) { s.lineTo(p.cabBack - 0.1, p.trunk); s.lineTo(p.cabBack - 0.1, p.belt); }
  else s.lineTo(p.cabBack, p.belt);
  s.lineTo(p.cabFront, p.belt);
  s.lineTo(hl - 0.3, p.hood);
  s.quadraticCurveTo(hl, p.hood - 0.02, hl, p.hood - 0.25);
  s.lineTo(hl, y0 + 0.12);
  s.quadraticCurveTo(hl, y0, hl - 0.12, y0);
  s.lineTo(zf + r, y0);
  s.absarc(zf, wheelR, r, 0, Math.PI, false);
  s.lineTo(zr + r, y0);
  s.absarc(zr, wheelR, r, 0, Math.PI, false);
  s.lineTo(-hl + 0.12, y0);
  s.quadraticCurveTo(-hl, y0, -hl, y0 + 0.12);
  return s;
}
function cabinShape(def) {
  const p = def.p, s = new THREE.Shape();
  s.moveTo(p.cabBack + 0.02, p.belt - 0.02);
  s.lineTo(p.roofBack, p.roof);
  s.lineTo(p.roofFront, p.roof);
  s.lineTo(p.cabFront - 0.02, p.belt - 0.02);
  s.lineTo(p.cabBack + 0.02, p.belt - 0.02);
  return s;
}
function extrudeX(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}
// Vertex-colour helpers. Colours are given as hex (sRGB) and stored linear, matching material.color.
const _lin = new THREE.Color();
function paintVerts(geo, hex, lightChannel) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  _lin.set(hex);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _lin.r; c[i * 3 + 1] = _lin.g; c[i * 3 + 2] = _lin.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (lightChannel !== undefined) g.setAttribute('lch', new THREE.BufferAttribute(new Float32Array(n).fill(lightChannel), 1));
  return g;
}
// Light channels of the merged "detail" mesh: 0 none, 1 headlight, 2 tail/brake, 3 bar red, 4 bar blue, 5 taxi sign.
const LIGHT = { none: 0, head: 1, tail: 2, red: 3, blue: 4, taxi: 5 };
// Shared emissive intensity uniforms (tail lights are per vehicle).
const DETAIL_U = { uHead: { value: 0.3 }, uRed: { value: 0.3 }, uBlue: { value: 0.3 }, uTaxi: { value: 0.5 } };
const DETAIL_C = {
  cHead: { value: new THREE.Color(0xfff2d6) }, cTail: { value: new THREE.Color(0xff1010) },
  cRed: { value: new THREE.Color(0xff1020) }, cBlue: { value: new THREE.Color(0x1040ff) }, cTaxi: { value: new THREE.Color(0xffc830) },
};
function makeDetailMaterial(uTail) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, DETAIL_U, DETAIL_C, { uTail });
    sh.vertexShader = 'attribute float lch;\nvarying float vLch;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLch = lch;');
    sh.fragmentShader = 'uniform float uHead, uTail, uRed, uBlue, uTaxi;\nuniform vec3 cHead, cTail, cRed, cBlue, cTaxi;\nvarying float vLch;\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (vLch > 0.5) {
    if (vLch < 1.5) totalEmissiveRadiance += cHead * uHead;
    else if (vLch < 2.5) totalEmissiveRadiance += cTail * uTail;
    else if (vLch < 3.5) totalEmissiveRadiance += cRed * uRed;
    else if (vLch < 4.5) totalEmissiveRadiance += cBlue * uBlue;
    else totalEmissiveRadiance += cTaxi * uTaxi;
  }`);
  };
  m.customProgramCacheKey = () => 'solanoVehicleDetail';
  return m;
}
// One unit-radius wheel shared by every vehicle; instances are scaled by each vehicle's wheel radius.
let WHEEL_GEO = null;
function unitWheelGeometry() {
  if (WHEEL_GEO) return WHEEL_GEO;
  const rRef = 0.35;
  const tire = paintVerts(new THREE.CylinderGeometry(1, 1, 0.26, 18, 1).rotateZ(Math.PI / 2), 0x3f3f3f);
  const rim = paintVerts(new THREE.CylinderGeometry(0.62, 0.62, 0.27, 10, 1).rotateZ(Math.PI / 2), 0xdadade);
  const parts = [tire, rim];
  for (let k = 0; k < 5; k++) parts.push(paintVerts(new THREE.BoxGeometry(0.28, 0.05 / rRef, 1.1).rotateX((k / 5) * Math.PI), 0xc3c3c8));
  for (const g of parts) g.deleteAttribute('lch');
  WHEEL_GEO = mergeGeometries(parts);
  return WHEEL_GEO;
}

function getGeometries(type) {
  if (GEO_CACHE[type]) return GEO_CACHE[type];
  const def = VEHICLES[type];
  const p = def.p, hl = def.L / 2, W = def.W;
  // --- painted shell: body + roof (+ police stripe via vertex colour); cloned per vehicle for dents
  const body = paintVerts(extrudeX(bodyShape(def), def.W, 0.07), 0xffffff);
  const roof = paintVerts(new THREE.BoxGeometry(W * 0.87, 0.06, p.roofFront - p.roofBack + 0.08).translate(0, p.roof + 0.03, (p.roofBack + p.roofFront) / 2), 0xffffff);
  const shell = [body, roof];
  if (def.police) shell.push(paintVerts(new THREE.BoxGeometry(W + 0.02, 0.22, def.L * 0.7).translate(0, p.belt - 0.25, 0), 0x14254a));
  const paint = mergeGeometries(shell);
  const cabin = extrudeX(cabinShape(def), def.W * 0.86, 0.05);
  // --- detail: trim, lights, light bar, taxi sign in one mesh (emission selected per vertex channel)
  const det = [];
  const B = (w, h, d, x, y, z, hex, ch = LIGHT.none) => det.push(paintVerts(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, ch));
  const TRIM = 0x151517;
  B(W * 0.98, 0.2, 0.18, 0, 0.42, hl + 0.02, TRIM);
  B(W * 0.98, 0.2, 0.18, 0, 0.42, -hl - 0.02, TRIM);
  B(W * 0.5, 0.16, 0.05, 0, p.hood - 0.33, hl + 0.01, TRIM);
  B(0.08, 0.1, 0.18, W / 2 + 0.05, p.belt + 0.05, p.cabFront - 0.15, TRIM);
  B(0.08, 0.1, 0.18, -W / 2 - 0.05, p.belt + 0.05, p.cabFront - 0.15, TRIM);
  if (p.bed) B(W * 0.9, 0.05, def.L / 2 + p.cabBack - 0.3, 0, p.trunk - 0.35, (-hl + p.cabBack) / 2, TRIM);
  const midC = (p.roofBack + p.roofFront) / 2;
  B(W * 0.87, (p.roof - p.belt) * 0.95, 0.09, 0, (p.roof + p.belt) / 2, midC, TRIM); // B-pillar
  B(0.42, 0.13, 0.08, W / 2 - 0.33, p.hood - 0.18, hl - 0.01, 0xffffff, LIGHT.head);
  B(0.42, 0.13, 0.08, -W / 2 + 0.33, p.hood - 0.18, hl - 0.01, 0xffffff, LIGHT.head);
  B(0.4, 0.12, 0.08, W / 2 - 0.3, p.trunk - 0.2, -hl + 0.01, 0x550000, LIGHT.tail);
  B(0.4, 0.12, 0.08, -W / 2 + 0.3, p.trunk - 0.2, -hl + 0.01, 0x550000, LIGHT.tail);
  if (def.police) {
    B(0.5, 0.12, 0.26, 0.28, p.roof + 0.12, midC, 0x440000, LIGHT.red);
    B(0.5, 0.12, 0.26, -0.28, p.roof + 0.12, midC, 0x000044, LIGHT.blue);
  }
  if (def.taxi) B(0.7, 0.2, 0.3, 0, p.roof + 0.15, midC, 0xffe9a0, LIGHT.taxi);
  const detail = mergeGeometries(det);
  // headlight beams
  const cone = new THREE.CylinderGeometry(0.15, 2.6, 13, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 6.5);
  const beams = mergeGeometries([cone.clone().translate(W / 2 - 0.33, p.hood - 0.18, hl), cone.clone().translate(-W / 2 + 0.33, p.hood - 0.18, hl)]);
  beams.rotateX(0.08);
  // driver bust (torso + head merged); torso colour is written per vehicle
  const torso = paintVerts(new THREE.CylinderGeometry(0.2, 0.17, 0.5, 8).translate(0, p.belt - 0.05, 0), 0xffffff);
  const head = paintVerts(new THREE.SphereGeometry(0.12, 10, 8).translate(0, p.belt + 0.33, 0), 0xc68a62);
  const bust = mergeGeometries([torso, head]);
  const torsoVerts = torso.attributes.position.count;
  GEO_CACHE[type] = { paint, cabin, detail, beams, bust, torsoVerts };
  return GEO_CACHE[type];
}

// ---------------------------------------------------------------- vehicle
const _tmpV = new THREE.Vector3();
const _circ = { x: 0, z: 0 }, _res = { hit: false, nx: 0, nz: 0, depth: 0 };
let VID = 0;
export class Vehicle {
  constructor(game, type, color) {
    this.game = game; this.type = type; this.def = VEHICLES[type]; this.id = ++VID;
    const def = this.def, G = getGeometries(type), M = sharedMats();
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    // Rendering is merged into as few meshes as possible:
    //   paint shell (body + roof + police stripe), glass cabin, detail (trim + all lights), beams (night),
    //   driver bust (only when an NPC drives). Wheels are drawn by one global InstancedMesh (VehicleManager).
    this.paint = new THREE.MeshPhysicalMaterial({ color: color || pick(def.colors), vertexColors: true, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    this.bodyGeo = G.paint.clone();
    this.origPos = Float32Array.from(this.bodyGeo.attributes.position.array);
    this.bodyMesh = new THREE.Mesh(this.bodyGeo, this.paint);
    this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true;
    const cabin = new THREE.Mesh(G.cabin, M.glass);
    this.uTail = { value: 0.3 };
    const detail = new THREE.Mesh(G.detail, makeDetailMaterial(this.uTail)); detail.castShadow = true;
    this.body.add(this.bodyMesh, cabin, detail);
    this.parts = { cabin, detail };
    this.beams = new THREE.Mesh(G.beams, M.beam);
    this.beams.visible = false; this.beams.renderOrder = 3;
    this.body.add(this.beams);
    // driver bust (visible when NPC drives)
    this.bustColor = new THREE.Color(0x3355aa);
    this.bustGeo = G.bust.clone();
    this.bustTorsoVerts = G.torsoVerts;
    this.bust = new THREE.Mesh(this.bustGeo, M.bust);
    this.bust.position.set(0.4, 0, def.p.roofBack + 0.25 + (def.p.box ? 0.0 : 0.1));
    if (def.p.box) this.bust.position.z = def.p.roofFront - 0.3;
    this.bust.visible = false;
    this.body.add(this.bust);
    // wheel data (the meshes are instanced globally by VehicleManager)
    this.wheels = [];
    const wx = def.W / 2 - 0.16, wz = def.wheelBase / 2;
    for (const [x, z, front] of [[wx, wz, true], [-wx, wz, true], [wx, -wz, false], [-wx, -wz, false]]) this.wheels.push({ x, y: def.wheelR, z, front });
    this.seat = { x: 0.4, y: def.p.belt - 1.38, z: this.bust.position.z - 0.05 };
    this.reset();
  }
  get police() { return !!this.def.police; }

  reset(color) {
    if (color) this.paint.color.set(color);
    this.pos = this.pos || new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; this.angVel = 0; this.steer = 0; this.vy = 0; this.y = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.health = this.def.health; this.destroyed = false; this.burnT = 0; this.sinking = 0;
    this.driver = null; this.npcDriver = false; this.ai = null; this.siren = false;
    this.persistent = false; this.missionTag = null; this.wreckT = 0;
    this.pitch = 0; this.roll = 0; this.spin = 0; this.slip = 0; this.lastVf = 0; this.flip = 0;
    this.deformed = 0; this.passengers = 0;
    this.paint.roughness = 0.32; this.paint.clearcoat = 1; this.paint.metalness = 0.55;
    this.bodyMesh.material = this.paint;
    this.uTail.value = 0.3;
    if (this.bodyGeo) { this.bodyGeo.attributes.position.array.set(this.origPos); this.bodyGeo.attributes.position.needsUpdate = true; this.bodyGeo.computeVertexNormals(); }
    this.group.rotation.set(0, 0, 0); this.body.rotation.set(0, 0, 0);
    this.bust.visible = false;
    this.lastHitBy = null; this.hitTimer = 0;
    this._skid = null;
  }
  place(x, z, heading) {
    this.pos.set(x, 0, z); this.heading = heading;
    this.y = terrainHeight(x, z);
    this.syncVisual(0);
  }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading); }
  isDriven() { return !!this.driver || this.npcDriver; }
  toWorld(lx, ly, lz, out = new THREE.Vector3()) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return out.set(this.pos.x + lx * c + lz * s, this.y + ly, this.pos.z - lx * s + lz * c);
  }
  toLocal(wx, wz, out = { x: 0, z: 0 }) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), dx = wx - this.pos.x, dz = wz - this.pos.z;
    out.x = dx * c - dz * s; out.z = dx * s + dz * c;
    return out;
  }
  setNpcDriver(on, shirt) {
    this.npcDriver = on; this.bust.visible = on;
    if (shirt) {
      this.bustColor.set(shirt);
      const col = this.bustGeo.attributes.color;
      for (let i = 0; i < this.bustTorsoVerts; i++) col.setXYZ(i, this.bustColor.r, this.bustColor.g, this.bustColor.b);
      col.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ physics
  update(dt) {
    const speed = this.speed;
    const steps = Math.min(4, Math.max(1, Math.ceil(speed * dt / 0.45)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) { this.step(h); this.collideStatic(); }
    this.updateDamage(dt);
    this.syncVisual(dt);
  }
  step(dt) {
    const d = this.def, inp = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading), rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz, vr = this.vel.x * rx + this.vel.z * rz;
    const alive = !this.destroyed && this.sinking === 0 && this.isDriven();
    const g = terrainHeight(this.pos.x, this.pos.z);
    this.groundY = g;
    const grounded = this.y <= g + 0.08;
    const thr = alive ? inp.throttle : 0, brk = alive ? inp.brake : 0;
    const vf0 = vf;
    if (grounded) {
      if (thr > 0) {
        if (vf < -0.5) vf += d.brake * thr * dt;
        else vf += d.accel * thr * clamp(1 - (vf / d.maxSpeed) ** 2, 0, 1) * dt;
      }
      if (brk > 0) {
        if (vf > 0.5) vf -= d.brake * brk * dt;
        else vf -= d.accel * 0.6 * brk * clamp(1 - (-vf) / (d.maxSpeed * 0.3), 0, 1) * dt;
      }
      if (inp.handbrake || (!alive && !this.destroyed)) vf = moveToward(vf, 0, (inp.handbrake ? 9 : 4) * dt);
      if (this.destroyed) vf = moveToward(vf, 0, 6 * dt);
      if (thr === 0 && brk === 0) vf = moveToward(vf, 0, 1.8 * dt);
      vf -= vf * Math.abs(vf) * d.drag * dt;
      const wet = this.game.env ? this.game.env.wet : 0;
      const grip = (inp.handbrake ? d.grip * 0.16 : d.grip) * (1 - wet * 0.25) * (this.destroyed ? 0.6 : 1);
      vr *= Math.exp(-grip * dt);
      const maxS = d.maxSteer / (1 + Math.abs(vf) * 0.045);
      this.steer = moveToward(this.steer, (alive ? inp.steer : 0) * maxS, 3.5 * dt);
      let target = -vf * Math.tan(this.steer) / d.wheelBase;
      if (inp.handbrake && Math.abs(vf) > 5) target *= 1.7;
      this.angVel = damp(this.angVel, target, inp.handbrake ? 3.5 : 8, dt);
    } else {
      this.angVel *= Math.exp(-0.3 * dt);
    }
    this.accelLong = (vf - vf0) / Math.max(dt, 1e-4);
    this.slip = Math.abs(vr) / (Math.abs(vf) + 3) + (inp.handbrake && Math.abs(vf) > 6 ? 0.5 : 0) + (brk > 0.5 && vf > 12 ? 0.3 : 0);
    this.vel.x = fx * vf + rx * vr; this.vel.z = fz * vf + rz * vr;
    this.heading = wrapAngle(this.heading + this.angVel * dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.lastVf = vf;
    // vertical
    if (this.y > g + 0.02 || this.vy > 0) {
      this.vy -= 22 * dt; this.y += this.vy * dt;
      if (this.y <= g) {
        if (this.vy < -9) this.takeDamage((-this.vy - 9) * 40, { kind: 'crash' });
        this.y = g; this.vy = this.vy < -4 ? -this.vy * 0.2 : 0;
      }
    } else this.y = damp(this.y, g, 20, dt);
    // water
    if (g < WORLD.WATER_Y - 0.4 && this.y < WORLD.WATER_Y + 0.2 && !this.sinking) {
      this.sinking = 0.001;
      this.game.effects.splash(new THREE.Vector3(this.pos.x, WORLD.WATER_Y, this.pos.z), 2);
      this.game.audio.splash(this.pos);
    }
    if (this.sinking) {
      this.vel.multiplyScalar(Math.exp(-1.6 * dt)); this.angVel *= Math.exp(-2 * dt);
    }
  }
  collideStatic() {
    const d = this.def, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const r = d.W / 2, off = d.L / 2 - r;
    const ph = this.game.physics;
    const c = _circ, res0 = _res;
    for (let k = 0; k < 3; k++) {
      const o = k === 0 ? off : k === 1 ? 0 : -off;
      const cx = this.pos.x + fx * o, cz = this.pos.z + fz * o;
      c.x = cx; c.z = cz;
      const res = ph.resolveCircle(c, r, this.y + 0.35, this.y + 1.5, res0);
      if (!res.hit) continue;
      this.pos.x += c.x - cx; this.pos.z += c.z - cz;
      const vn = this.vel.x * res.nx + this.vel.z * res.nz;
      if (vn < 0) {
        this.vel.x -= 1.25 * vn * res.nx; this.vel.z -= 1.25 * vn * res.nz;
        // friction along the wall
        const tx = -res.nz, tz = res.nx, vt = this.vel.x * tx + this.vel.z * tz;
        this.vel.x -= tx * vt * 0.15; this.vel.z -= tz * vt * 0.15;
        this.angVel += (fz * o * res.nx - fx * o * res.nz) * (-vn) * 0.1;
        this.impact(-vn, cx - res.nx * r, cz - res.nz * r, res.nx, res.nz);
      }
    }
  }
  impact(strength, px, pz, nx, nz, other = null) {
    if (strength < 2.5) return;
    const g = this.game;
    this.takeDamage(Math.pow(strength, 1.6) * 2.2, { kind: 'crash', attacker: other && other.driver ? other.driver : null });
    const l = this.toLocal(px, pz);
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    // world normal (pointing away from obstacle, i.e. into car) -> local
    const lnx = nx * c - nz * s, lnz = nx * s + nz * c;
    this.dent(l.x, 0.7, l.z, lnx, lnz, Math.min(strength * 0.02, 0.25));
    if (strength > 4) {
      g.audio.crash(this.pos, strength / 12);
      g.effects.impact(new THREE.Vector3(px, this.y + 0.6, pz), new THREE.Vector3(nx, 0.3, nz), 'spark');
    }
    if (this.driver && this.driver.isPlayer) g.cameraRig.shake(Math.min(strength / 25, 0.6));
    if (this.npcDriver && this.ai && strength > 5) this.ai.panic = 10;
  }
  dent(lx, ly, lz, nx, nz, amount) {
    if (this.deformed > 2.5 || amount < 0.01) return;
    const p = this.bodyGeo.attributes.position, a = p.array, R = 0.9;
    let moved = false;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - lx, dy = a[i + 1] - ly, dz = a[i + 2] - lz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R * R) continue;
      const f = (1 - Math.sqrt(d2) / R) * amount;
      a[i] += nx * f; a[i + 2] += nz * f; a[i + 1] -= f * 0.3;
      moved = true;
    }
    if (moved) { p.needsUpdate = true; this.bodyGeo.computeVertexNormals(); this.deformed += amount; }
  }

  takeDamage(amount, info = {}) {
    if (this.destroyed) return;
    this.health -= amount;
    if (info.attacker) { this.lastHitBy = info.attacker; this.hitTimer = 5; }
    if (info.attacker && info.attacker.isPlayer) this.game.events.emit('vehicleDamagedByPlayer', { vehicle: this, amount, info });
    if (this.npcDriver && this.ai && info.kind === 'bullet') this.ai.panic = 12;
    if (this.health <= 0) { this.health = 0; if (this.burnT <= 0) this.burnT = 0.001; }
  }
  updateDamage(dt) {
    const g = this.game;
    this.hitTimer -= dt;
    if (this.destroyed) {
      this.wreckT += dt;
      if (this.wreckT < 20 && Math.random() < dt * 8) g.effects.smoke(this.toWorld(0, 1.2, 0, _tmpV), 1.3, 0.12);
      if (this.wreckT < 8 && Math.random() < dt * 20) g.effects.fire(this.toWorld(rand(-0.5, 0.5), 0.9, rand(-1, 1), _tmpV), 1.2);
      return;
    }
    if (this.sinking) {
      this.sinking += dt;
      if (this.sinking > 4) { this.destroyed = true; this.wreckT = 30; this.game.events.emit('vehicleDestroyed', { vehicle: this, sunk: true, attacker: null }); }
      return;
    }
    const hood = this.toWorld(0, this.def.p.hood + 0.1, this.def.L * 0.32, _tmpV);
    if (this.health < 450 && Math.random() < dt * (this.health < 250 ? 14 : 6)) g.effects.smoke(hood, 0.8, this.health < 250 ? 0.12 : 0.45);
    if (this.health <= 150 || this.burnT > 0) {
      if (this.burnT <= 0) this.burnT = 0.001;
      this.burnT += dt;
      if (Math.random() < dt * 30) g.effects.fire(hood, 1);
      if (this.burnT > 5) this.explode();
    }
  }
  explode() {
    if (this.destroyed) return;
    const g = this.game;
    this.destroyed = true; this.health = 0; this.wreckT = 0;
    this.paint.color.set(0x1a1917); this.paint.roughness = 1; this.paint.clearcoat = 0; this.paint.metalness = 0.2;
    this.uTail.value = 0;
    this.vy = 6; this.angVel += rand(-2, 2);
    this.bust.visible = false;
    const attacker = this.lastHitBy && this.hitTimer > -10 ? this.lastHitBy : null;
    g.weapons.explode(this.pos.clone().setY(this.y + 0.8), 8, 150, attacker, { source: this, scale: 1.3 });
    g.events.emit('vehicleDestroyed', { vehicle: this, sunk: false, attacker });
  }

  rayHit(o, d, maxT) {
    const def = this.def, c = Math.cos(this.heading), s = Math.sin(this.heading);
    const ox = o.x - this.pos.x, oz = o.z - this.pos.z, oy = o.y - this.y;
    const lox = ox * c - oz * s, loz = ox * s + oz * c;
    let ldx = d.x * c - d.z * s, ldz = d.x * s + d.z * c, ldy = d.y;
    if (Math.abs(ldx) < 1e-9) ldx = 1e-9; if (Math.abs(ldz) < 1e-9) ldz = 1e-9; if (Math.abs(ldy) < 1e-9) ldy = 1e-9;
    const hx = def.W / 2, hz = def.L / 2, y0 = 0.25, y1 = def.p.roof;
    let t1 = (-hx - lox) / ldx, t2 = (hx - lox) / ldx;
    let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), axis = 0;
    t1 = (y0 - oy) / ldy; t2 = (y1 - oy) / ldy;
    let tn = Math.min(t1, t2), tf = Math.max(t1, t2);
    if (tn > tmin) { tmin = tn; axis = 1; } tmax = Math.min(tmax, tf);
    t1 = (-hz - loz) / ldz; t2 = (hz - loz) / ldz;
    tn = Math.min(t1, t2); tf = Math.max(t1, t2);
    if (tn > tmin) { tmin = tn; axis = 2; } tmax = Math.min(tmax, tf);
    if (tmax < tmin || tmin < 0 || tmin > maxT) return null;
    let nx = 0, ny = 0, nz = 0;
    if (axis === 0) nx = -Math.sign(ldx); else if (axis === 1) ny = -Math.sign(ldy); else nz = -Math.sign(ldz);
    const normal = new THREE.Vector3(nx * c + nz * s, ny, -nx * s + nz * c);
    return { t: tmin, normal };
  }

  // ------------------------------------------------------------ visuals
  syncVisual(dt) {
    const def = this.def;
    this.group.position.set(this.pos.x, this.y, this.pos.z);
    this.group.rotation.y = this.heading;
    // terrain pitch/roll + dynamic body motion
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hf = terrainHeight(this.pos.x + fx * def.wheelBase / 2, this.pos.z + fz * def.wheelBase / 2);
    const hb = terrainHeight(this.pos.x - fx * def.wheelBase / 2, this.pos.z - fz * def.wheelBase / 2);
    let tp = Math.atan2(hb - hf, def.wheelBase);
    if (Math.abs(hb - hf) > 1) tp = 0;
    const lat = this.lastVf * this.angVel;
    const tgtPitch = tp + clamp(-(this.accelLong || 0) * 0.004, -0.06, 0.06);
    const tgtRoll = clamp(lat * 0.006, -0.08, 0.08);
    if (dt > 0) { this.pitch = damp(this.pitch, tgtPitch, 8, dt); this.roll = damp(this.roll, tgtRoll, 8, dt); }
    let sinkTilt = this.sinking ? Math.min(this.sinking * 0.1, 0.25) : 0;
    this.body.rotation.set(this.pitch + sinkTilt, 0, this.roll);
    if (this.sinking) this.y = Math.max(WORLD.WATER_Y - 2.2, this.y - dt * 0.5);
    this.spin += this.lastVf * dt / def.wheelR; // wheel matrices are written by VehicleManager.updateWheels()
    const night = this.game.env ? this.game.env.night : 0;
    const on = this.isDriven() && !this.destroyed && !this.sinking;
    this.uTail.value = this.destroyed ? 0 : (this.input.brake > 0.1 && on ? 4 : (on ? 0.3 + night * 1.2 : 0.05));
    this.beams.visible = on && night > 0.35;
  }
}

// ---------------------------------------------------------------- global wheel instancing
const _wm = new THREE.Matrix4(), _wq = new THREE.Quaternion(), _we = new THREE.Euler(0, 0, 0, 'YXZ'), _wp = new THREE.Vector3(), _ws = new THREE.Vector3();
class WheelInstancer {
  constructor(scene, max = 320) {
    this.mesh = new THREE.InstancedMesh(unitWheelGeometry(), sharedMats().wheel, max);
    this.mesh.frustumCulled = false; // instances are spread over the whole city
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.max = max;
    scene.add(this.mesh);
  }
  update(list) {
    let n = 0;
    for (const v of list) {
      if (!v.group.visible || !v.group.parent) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading), r = v.def.wheelR;
      for (const w of v.wheels) {
        if (n >= this.max) break;
        _wp.set(v.pos.x + w.x * c + w.z * s, v.y + w.y, v.pos.z - w.x * s + w.z * c);
        _we.set(v.spin, v.heading + (w.front ? -v.steer : 0), 0, 'YXZ');
        _wq.setFromEuler(_we);
        _ws.set(1, r, r);
        _wm.compose(_wp, _wq, _ws);
        this.mesh.setMatrixAt(n++, _wm);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- skid marks
// Ring buffer of instanced ground decals left by the rear wheels while a vehicle slides.
// Multiply blending darkens the road; instance colours fade marks back to white (invisible) over time.
class SkidMarks {
  constructor(scene, max = 800) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 16, 0);
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.3, '#6a6a6a'); grd.addColorStop(0.7, '#6a6a6a'); grd.addColorStop(1, '#fff');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    mat.userData.noShadow = true;
    const geo = new THREE.PlaneGeometry(0.24, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.max = max; this.next = 0; this.used = 0;
    this.birth = new Float32Array(max).fill(-1e9); this.strength = new Float32Array(max);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, white); }
    scene.add(this.mesh);
    this.time = 0; this.fadeT = 0; this.life = 40;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color(); this._up = new THREE.Vector3(0, 1, 0);
  }
  add(x0, z0, x1, z1, y, strength) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const i = this.next; this.next = (this.next + 1) % this.max; this.used = Math.min(this.used + 1, this.max);
    this._p.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this._q.setFromAxisAngle(this._up, Math.atan2(dx, dz));
    this._s.set(1, 1, len + 0.05);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.birth[i] = this.time; this.strength[i] = strength;
    this._c.setScalar(1 - 0.6 * strength);
    this.mesh.setColorAt(i, this._c);
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt, list) {
    this.time += dt;
    for (const v of list) {
      const rear = v._skid || (v._skid = [{ x: 0, z: 0, on: false }, { x: 0, z: 0, on: false }]);
      const grounded = v.y <= (v.groundY || 0) + 0.1;
      const sliding = grounded && !v.destroyed && !v.sinking && v.speed > 4 && v.slip > 0.35;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      for (let k = 0; k < 2; k++) {
        const w = v.wheels[2 + k], st = rear[k];
        if (!sliding) { st.on = false; continue; }
        const x = v.pos.x + w.x * c + w.z * s, z = v.pos.z - w.x * s + w.z * c;
        if (!st.on) { st.on = true; st.x = x; st.z = z; continue; }
        if (Math.hypot(x - st.x, z - st.z) < 0.45) continue;
        this.add(st.x, st.z, x, z, terrainHeight(x, z) + 0.035, Math.min(1, v.slip));
        st.x = x; st.z = z;
      }
    }
    // fade old marks a few times per second (cheap: only touches colours)
    this.fadeT -= dt;
    if (this.fadeT <= 0 && this.used) {
      this.fadeT = 0.5;
      for (let i = 0; i < this.max; i++) {
        const age = this.time - this.birth[i];
        if (age < 0 || age > this.life + 1) continue;
        this._c.setScalar(1 - 0.6 * this.strength[i] * Math.max(0, 1 - age / this.life));
        this.mesh.setColorAt(i, this._c);
      }
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- road graph
export const NODE_NX = CITY.NX + 1, NODE_NZ = CITY.NZ + 1;
export const nodeId = (i, j) => i * NODE_NZ + j;
export const nodeI = (n) => Math.floor(n / NODE_NZ);
export const nodeJ = (n) => n % NODE_NZ;
const NODE_POS = [];
export const nodePos = (n) => NODE_POS[n] || (NODE_POS[n] = Object.freeze({ x: roadX(nodeI(n)), z: roadZ(nodeJ(n)) }));
export function nodeNeighbors(n) {
  const i = nodeI(n), j = nodeJ(n), out = [];
  if (i > 0) out.push(nodeId(i - 1, j)); if (i < CITY.NX) out.push(nodeId(i + 1, j));
  if (j > 0) out.push(nodeId(i, j - 1)); if (j < CITY.NZ) out.push(nodeId(i, j + 1));
  return out;
}
export function nearestNode(x, z) {
  const i = clamp(Math.round((x - CITY.X0) / CITY.P), 0, CITY.NX), j = clamp(Math.round((z - CITY.Z0) / CITY.P), 0, CITY.NZ);
  return nodeId(i, j);
}
export function findPath(a, b) {
  if (a === b) return [a];
  const prev = new Map([[a, -1]]), q = [a];
  while (q.length) {
    const n = q.shift();
    if (n === b) break;
    for (const m of nodeNeighbors(n)) if (!prev.has(m)) { prev.set(m, n); q.push(m); }
  }
  if (!prev.has(b)) return [a];
  const path = [];
  for (let n = b; n !== -1; n = prev.get(n)) path.push(n);
  return path.reverse();
}
// Nearest lane position (for spawning on roads)
// Lane frames are immutable, so they are cached (the AI asks for two per car per frame).
const LANE_CACHE = new Map();
export function laneFrame(from, to) {
  const key = from * 4096 + to;
  let f = LANE_CACHE.get(key);
  if (f) return f;
  const A = nodePos(from), B = nodePos(to);
  let dx = B.x - A.x, dz = B.z - A.z; const len = Math.hypot(dx, dz); dx /= len; dz /= len;
  const rx = -dz, rz = dx;
  f = Object.freeze({ A: Object.freeze(A), B: Object.freeze(B), dx, dz, rx, rz, len });
  LANE_CACHE.set(key, f);
  return f;
}

// ---------------------------------------------------------------- manager + AI
export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pool = {};
    this.spawnTimer = 0;
    this.sirenT = 0;
    this.trafficTarget = 16;
    this.parkedTarget = 10;
    this.wheels = new WheelInstancer(game.scene);
    this.skids = new SkidMarks(game.scene);
    this._circA = [{ x: 0, z: 0, r: 0, o: 0 }, { x: 0, z: 0, r: 0, o: 0 }, { x: 0, z: 0, r: 0, o: 0 }];
    this._circB = [{ x: 0, z: 0, r: 0, o: 0 }, { x: 0, z: 0, r: 0, o: 0 }, { x: 0, z: 0, r: 0, o: 0 }];
    this._local = { x: 0, z: 0 };
    this._imp = new THREE.Vector3(); this._impN = new THREE.Vector3();
  }
  spawn(type, x, z, heading, opts = {}) {
    let v = (this.pool[type] && this.pool[type].pop()) || null;
    if (v) v.reset(opts.color || pick(v.def.colors));
    else v = new Vehicle(this.game, type, opts.color);
    if (opts.color) v.paint.color.set(opts.color);
    v.place(x, z, heading);
    this.game.scene.add(v.group);
    this.list.push(v);
    return v;
  }
  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    this.game.scene.remove(v.group);
    if (v.driver && !v.driver.isPlayer) v.driver = null;
    (this.pool[v.type] || (this.pool[v.type] = [])).push(v);
  }
  randomType() {
    const tot = TRAFFIC_WEIGHTS.reduce((a, b) => a + b[1], 0);
    let r = Math.random() * tot;
    for (const [t, w] of TRAFFIC_WEIGHTS) { if ((r -= w) <= 0) return t; }
    return 'sedan';
  }
  // Put an AI driven car on a lane
  spawnTraffic(from, to, t, type, mode = 'cruise') {
    const f = laneFrame(from, to);
    const segStart = 9, segLen = f.len - 18;
    const along = segStart + t * segLen;
    const x = f.A.x + f.dx * along + f.rx * CITY.LANE, z = f.A.z + f.dz * along + f.rz * CITY.LANE;
    for (const o of this.list) if (Math.hypot(o.pos.x - x, o.pos.z - z) < 9) return null;
    const p = this.game.player;
    if (p && Math.hypot(p.pos.x - x, p.pos.z - z) < 8) return null;
    const v = this.spawn(type || this.randomType(), x, z, Math.atan2(f.dx, f.dz));
    v.vel.set(f.dx * 8, 0, f.dz * 8);
    v.setNpcDriver(true, pick(['#e84a5f', '#2ec4b6', '#ffbf69', '#f7f7f2', '#3a86ff', '#8338ec', '#264653']));
    if (v.def.police) v.setNpcDriver(true, '#1d2d50');
    v.ai = { mode, from, to, next: this.chooseNext(to, from), path: null, pathIdx: 0, stuckT: 0, reverseT: 0, blockedT: 0, ignoreT: 0, honkT: 0, panic: 0, cruise: rand(10, 13.5) };
    return v;
  }
  chooseNext(node, from) {
    const nb = nodeNeighbors(node).filter((n) => n !== from);
    if (!nb.length) return from;
    // prefer going straight
    const a = nodePos(from), b = nodePos(node);
    const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
    const straight = nb.find((n) => { const c = nodePos(n); return Math.sign(c.x - b.x) === dx && Math.sign(c.z - b.z) === dz; });
    if (straight !== undefined && Math.random() < 0.55) return straight;
    return pick(nb);
  }

  // ------------------------------------------------------------ AI driving
  driveAI(v, dt, depth = 0) {
    const ai = v.ai, inp = v.input;
    if (!ai || !v.npcDriver || v.destroyed) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.handbrake = !v.driver; return; }
    if (ai.mode === 'parked') { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.handbrake = true; return; }
    inp.handbrake = false;
    ai.panic = Math.max(0, ai.panic - dt);
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const vf = v.forwardSpeed();
    let target, desired;
    const player = this.game.player;
    if (ai.mode === 'pursue' || ai.mode === 'ram') {
      const P = player.vehicle ? player.vehicle.pos : player.pos;
      const dist = Math.hypot(P.x - v.pos.x, P.z - v.pos.z);
      ai.replan = (ai.replan || 0) - dt;
      const direct = dist < 45 && this.game.physics.los(v.pos.x, v.y + 1, v.pos.z, P.x, P.y + 1, P.z);
      if (direct) {
        const pv = player.vehicle ? player.vehicle.vel : player.vel;
        target = { x: P.x + pv.x * 0.6, z: P.z + pv.z * 0.6 };
        desired = player.vehicle ? Math.min(v.def.maxSpeed * 0.95, 8 + dist * 1.2 + player.vehicle.speed) : clamp((dist - 9) * 1.2, 0, 18);
        ai.lastDirect = true;
      } else {
        if (ai.replan <= 0 || ai.lastDirect) {
          ai.replan = 1.2; ai.lastDirect = false;
          const goal = nearestNode(P.x, P.z);
          const start = nearestNode(v.pos.x + fx * 10, v.pos.z + fz * 10);
          ai.path = findPath(start, goal); ai.pathIdx = 0;
        }
        // follow path node centres
        while (ai.path && ai.pathIdx < ai.path.length - 1) {
          const n = nodePos(ai.path[ai.pathIdx]);
          if (Math.hypot(n.x - v.pos.x, n.z - v.pos.z) < 12) ai.pathIdx++; else break;
        }
        const n = ai.path ? nodePos(ai.path[Math.min(ai.pathIdx, ai.path.length - 1)]) : P;
        target = n;
        if (ai.path && ai.pathIdx >= ai.path.length - 1 && Math.hypot(n.x - v.pos.x, n.z - v.pos.z) < 14) target = P;
        desired = Math.min(v.def.maxSpeed * 0.8, 30);
        const tl = Math.hypot(target.x - v.pos.x, target.z - v.pos.z);
        const ang = Math.abs(wrapAngle(Math.atan2(target.x - v.pos.x, target.z - v.pos.z) - v.heading));
        if (ang > 0.6 && tl < 25) desired = 10;
      }
      ai.distToPlayer = dist;
    } else if (ai.mode === 'route') {
      // mission route: follow ai.path (nodes) then ai.dest
      while (ai.path && ai.pathIdx < ai.path.length) {
        const n = nodePos(ai.path[ai.pathIdx]);
        if (Math.hypot(n.x - v.pos.x, n.z - v.pos.z) < 11) ai.pathIdx++; else break;
      }
      if (ai.path && ai.pathIdx < ai.path.length) {
        const n = nodePos(ai.path[ai.pathIdx]);
        // offset to the right lane
        const prev = ai.pathIdx > 0 ? nodePos(ai.path[ai.pathIdx - 1]) : { x: v.pos.x, z: v.pos.z };
        let dx = n.x - prev.x, dz = n.z - prev.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        target = { x: n.x - dz * CITY.LANE, z: n.z + dx * CITY.LANE };
      } else target = ai.dest || v.pos;
      desired = ai.routeSpeed || 16;
      const ang = Math.abs(wrapAngle(Math.atan2(target.x - v.pos.x, target.z - v.pos.z) - v.heading));
      const tl = Math.hypot(target.x - v.pos.x, target.z - v.pos.z);
      if (ang > 0.5 && tl < 30) desired = Math.min(desired, 9);
      if (ai.pathIdx >= (ai.path ? ai.path.length : 0) && tl < 6) desired = 0;
    } else {
      // cruise / flee along lanes
      const f = laneFrame(ai.from, ai.to);
      const sx = f.A.x + f.dx * 9 + f.rx * CITY.LANE, sz = f.A.z + f.dz * 9 + f.rz * CITY.LANE;
      const len1 = f.len - 18;
      const s = (v.pos.x - sx) * f.dx + (v.pos.z - sz) * f.dz;
      if (s > len1 - 1 && depth < 3) { const nf = ai.to; ai.to = ai.next; ai.from = nf; ai.next = this.chooseNext(ai.to, ai.from); return this.driveAI(v, dt, depth + 1); }
      const L = 5 + Math.abs(vf) * 0.45;
      const f2 = laneFrame(ai.to, ai.next);
      if (s + L <= len1) target = { x: sx + f.dx * (s + L), z: sz + f.dz * (s + L) };
      else {
        const ex = sx + f.dx * len1, ez = sz + f.dz * len1;
        const s2x = f2.A.x + f2.dx * 9 + f2.rx * CITY.LANE, s2z = f2.A.z + f2.dz * 9 + f2.rz * CITY.LANE;
        const gap = Math.hypot(s2x - ex, s2z - ez) || 1, over = s + L - len1;
        if (over < gap) { const t = over / gap; target = { x: ex + (s2x - ex) * t, z: ez + (s2z - ez) * t }; }
        else target = { x: s2x + f2.dx * (over - gap), z: s2z + f2.dz * (over - gap) };
      }
      const turning = f.dx * f2.dx + f.dz * f2.dz < 0.5;
      desired = ai.panic > 0 || ai.mode === 'flee' ? 24 : ai.cruise;
      if (turning && s > len1 - 22) desired = Math.min(desired, ai.panic > 0 ? 12 : 6.5);
    }
    // obstacle avoidance
    if (ai.ignoreT > 0) ai.ignoreT -= dt;
    else if (ai.mode !== 'ram') {
      const rxv = -fz, rzv = fx;
      const scan = 7 + Math.max(vf, 0) * 1.1;
      let blocked = null, bAhead = 1e9;
      const check = (o, px, pz, halfW) => {
        const rx0 = px - v.pos.x, rz0 = pz - v.pos.z;
        const ahead = rx0 * fx + rz0 * fz, lat = rx0 * rxv + rz0 * rzv;
        if (ahead > 1 && ahead < scan && Math.abs(lat) < halfW && ahead < bAhead) { bAhead = ahead; blocked = o; }
      };
      for (const o of this.list) if (o !== v) check(o, o.pos.x, o.pos.z, 2.3);
      for (const c of this.game.peds.list) if (!c.dead && !c.vehicle) check(c, c.pos.x, c.pos.z, 1.5);
      if (!player.vehicle && !player.dead) check(player, player.pos.x, player.pos.z, 1.6);
      if (blocked && ai.mode !== 'pursue') {
        const ahead = bAhead - v.def.L / 2 - 2;
        desired = Math.min(desired, Math.max(0, ahead * 0.9));
        ai.blockedT += dt;
        if (blocked === player || blocked === player.vehicle) {
          ai.honkT -= dt;
          if (ai.blockedT > 2 && ai.honkT <= 0) { this.game.audio.horn(v.pos); ai.honkT = rand(1.5, 4); }
        }
        if (ai.blockedT > 7 && !(blocked === player)) { ai.ignoreT = 2.5; ai.blockedT = 0; }
      } else ai.blockedT = Math.max(0, ai.blockedT - dt);
    }
    // stuck recovery
    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      inp.throttle = 0; inp.brake = 1; inp.steer = -ai.revSteer;
      return;
    }
    // steering
    const rx0 = target.x - v.pos.x, rz0 = target.z - v.pos.z;
    const lz = rx0 * fx + rz0 * fz, lx = rx0 * -fz + rz0 * fx;
    const ang = Math.atan2(lx, lz);
    inp.steer = clamp(ang * 2.2, -1, 1);
    const err = desired - vf;
    if (err > 0.3) { inp.throttle = clamp(err * 0.35, 0.25, 1); inp.brake = 0; }
    else if (err < -1) { inp.throttle = 0; inp.brake = clamp(-err * 0.25, 0.2, 1); }
    else { inp.throttle = 0.1; inp.brake = 0; }
    if (desired < 0.5 && vf < 1) { inp.throttle = 0; inp.brake = 0; inp.handbrake = true; }
    if (inp.throttle > 0.3 && Math.abs(vf) < 0.8) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt * 2);
    if (ai.stuckT > 1.6) { ai.stuckT = 0; ai.reverseT = 1.3; ai.revSteer = inp.steer || 1; }
  }

  // ------------------------------------------------------------ collisions between cars and with characters
  collidePairs() {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        if (dx * dx + dz * dz > 64) continue;
        this.collideCars(a, b);
      }
    }
  }
  collideCars(a, b) {
    const ca = this.circles(a, this._circA), cb = this.circles(b, this._circB);
    for (const p of ca) for (const q of cb) {
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz), R = p.r + q.r;
      if (d >= R || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, pen = R - d;
      const ma = a.def.mass * (a.destroyed ? 1.5 : 1), mb = b.def.mass * (b.destroyed ? 1.5 : 1), tot = ma + mb;
      a.pos.x -= nx * pen * (mb / tot); a.pos.z -= nz * pen * (mb / tot);
      b.pos.x += nx * pen * (ma / tot); b.pos.z += nz * pen * (ma / tot);
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv < 0) {
        const j = -(1.3) * rv / (1 / ma + 1 / mb);
        a.vel.x -= j / ma * nx; a.vel.z -= j / ma * nz;
        b.vel.x += j / mb * nx; b.vel.z += j / mb * nz;
        const armA = p.o, armB = q.o;
        a.angVel -= (Math.cos(a.heading) * armA * nx - Math.sin(a.heading) * armA * nz) * (-rv) * 0.05;
        b.angVel += (Math.cos(b.heading) * armB * nx - Math.sin(b.heading) * armB * nz) * (-rv) * 0.05;
        const imp = -rv;
        if (imp > 2.5) {
          const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2;
          a.impact(imp * (mb / tot) * 1.4, cx, cz, -nx, -nz, b);
          b.impact(imp * (ma / tot) * 1.4, cx, cz, nx, nz, a);
          this.game.events.emit('carCollision', { a, b, impact: imp });
        }
      }
      return;
    }
  }
  // three collision circles along the car, written into a reusable array
  circles(v, out) {
    const r = v.def.W / 2, off = v.def.L / 2 - r, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (let k = 0; k < 3; k++) {
      const o = k === 0 ? off : k === 1 ? 0 : -off, c = out[k];
      c.x = v.pos.x + fx * o; c.z = v.pos.z + fz * o; c.r = r; c.o = o;
    }
    return out;
  }
  collideCharacters() {
    const g = this.game;
    const chars = g.allCharacters();
    for (const v of this.list) {
      const hw = v.def.W / 2 + 0.35, hl = v.def.L / 2 + 0.35;
      const sp = v.speed;
      for (const c of chars) {
        if (c.vehicle) continue;
        const dx = c.pos.x - v.pos.x, dz = c.pos.z - v.pos.z;
        if (dx * dx + dz * dz > 16) continue;
        if (c.pos.y > v.y + v.def.p.roof + 0.3) continue;
        const l = v.toLocal(c.pos.x, c.pos.z, this._local);
        if (Math.abs(l.x) > hw || Math.abs(l.z) > hl) continue;
        // relative speed along impact
        const rel = Math.hypot(v.vel.x - c.vel.x, v.vel.z - c.vel.z);
        if (sp > 3.5 && rel > 3.5 && !c.dead) {
          const dmg = sp * (sp > 14 ? 9 : 6);
          const dir = new THREE.Vector3(v.vel.x, 0, v.vel.z).normalize();
          c.takeDamage(dmg, { attacker: v.driver || null, dir, point: c.pos.clone(), kind: 'vehicle', vehicle: v });
          c.vel.set(v.vel.x * 0.8 + rand(-1, 1), Math.min(sp * 0.3, 6), v.vel.z * 0.8 + rand(-1, 1));
          if (c.knock) c.knock(sp);
          g.audio.thud(c.pos);
          v.vel.multiplyScalar(0.94);
          v.dent(l.x * 0.6, 0.7, Math.sign(l.z) * v.def.L / 2, 0, -Math.sign(l.z), 0.04);
        }
        // push out sideways/forward along the smallest penetration
        const px = hw - Math.abs(l.x), pz = hl - Math.abs(l.z);
        const c0 = Math.cos(v.heading), s0 = Math.sin(v.heading);
        let lx = 0, lz = 0;
        if (px < pz) lx = Math.sign(l.x) * px; else lz = Math.sign(l.z) * pz;
        c.pos.x += lx * c0 + lz * s0; c.pos.z += -lx * s0 + lz * c0;
      }
    }
  }

  // ------------------------------------------------------------ streaming
  stream(dt) {
    const g = this.game, P = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
    const cam = g.cameraRig.camera;
    // despawn far vehicles
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v.persistent || v === g.player.vehicle || v === g.player.lastVehicle) continue;
      const d = Math.hypot(v.pos.x - P.x, v.pos.z - P.z);
      if (d > 270 || (v.destroyed && v.wreckT > 60 && d > 60) || (v.sinking > 5)) this.remove(v);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 0.25;
    let traffic = 0, parked = 0;
    for (const v of this.list) {
      if (v.ai && (v.ai.mode === 'cruise' || v.ai.mode === 'flee')) traffic++;
      else if (!v.isDriven() && !v.destroyed) parked++;
    }
    const night = g.env.night;
    const tTarget = Math.round(this.trafficTarget * (1 - night * 0.25));
    const frustum = g.cameraRig.frustum();
    const visible = (x, z) => frustum.containsPoint(_tmpV.set(x, 1.5, z));
    if (traffic < tTarget) {
      for (let tries = 0; tries < 6; tries++) {
        const n = nearestNode(P.x + rand(-190, 190), P.z + rand(-190, 190));
        const nb = nodeNeighbors(n); const to = pick(nb);
        const f = laneFrame(n, to), t = Math.random();
        const x = f.A.x + f.dx * (9 + t * (f.len - 18)), z = f.A.z + f.dz * (9 + t * (f.len - 18));
        const d = Math.hypot(x - P.x, z - P.z);
        if (d < 60 || d > 220) continue;
        if (d < 140 && visible(x, z)) continue;
        if (this.spawnTraffic(n, to, t)) break;
      }
    }
    if (parked < this.parkedTarget) {
      const spots = g.world.parkingSpots;
      for (let tries = 0; tries < 8; tries++) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        const d = Math.hypot(s.x - P.x, s.z - P.z);
        if (d < 35 || d > 150) continue;
        if (d < 100 && visible(s.x, s.z)) continue;
        if (this.list.some((o) => Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 7)) continue;
        const type = pick(['sedan', 'sedan', 'coupe', 'pickup', 'van', 'taxi', 'supercar', 'sedan', 'coupe']);
        const v = this.spawn(type, s.x, s.z, s.heading);
        v.ai = null;
        break;
      }
    }
  }

  update(dt) {
    // police light bar flashing
    this.sirenT += dt;
    const M = sharedMats();
    const ph = Math.floor(this.sirenT * 6) % 2;
    let anySiren = false;
    for (const v of this.list) if (v.siren && !v.destroyed) { anySiren = true; break; }
    DETAIL_U.uRed.value = anySiren ? (ph ? 6 : 0.2) : 0.3;
    DETAIL_U.uBlue.value = anySiren ? (ph ? 0.2 : 6) : 0.3;
    const night = this.game.env.night;
    DETAIL_U.uHead.value = 0.3 + night * 4;
    DETAIL_U.uTaxi.value = 0.4 + night * 2;
    M.beam.opacity = 0.1 * night;
    for (const v of this.list) {
      if (v.ai && v.npcDriver) this.driveAI(v, dt);
      else if (!v.driver) { v.input.throttle = 0; v.input.brake = 0; v.input.steer = 0; v.input.handbrake = true; }
      v.update(dt);
    }
    this.collidePairs();
    this.collideCharacters();
    this.stream(dt);
    this.wheels.update(this.list);
    this.skids.update(dt, this.list);
  }

  nearestEnterable(pos, maxD = 3.2) {
    let best = null, bd = maxD;
    for (const v of this.list) {
      if (v.destroyed || v.sinking) continue;
      const l = v.toLocal(pos.x, pos.z, this._local);
      const ex = Math.max(0, Math.abs(l.x) - v.def.W / 2), ez = Math.max(0, Math.abs(l.z) - v.def.L / 2);
      const d = Math.hypot(ex, ez);
      if (d < bd && Math.abs(pos.y - v.y) < 2) { bd = d; best = v; }
    }
    return best;
  }
}
export { chance };
