// Weapon definitions, weapon models, hitscan shooting, grenades, explosions and melee.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, terrainHeight } from './config.js';
import { rand, clamp } from './utils.js';

export const WEAPONS = {
  fist:    { id: 'fist', name: 'Fists', slot: 0, melee: true, damage: 14, rate: 0.45, range: 1.7, sound: 'punch' },
  pistol:  { id: 'pistol', name: 'Viper 9', slot: 1, damage: 30, rate: 0.2, auto: false, mag: 12, spread: 0.012, recoil: 0.035, range: 120, reload: 1.2, sound: 'pistol', twoHanded: false, price: 250, ammoPrice: 60, ammoPack: 36 },
  smg:     { id: 'smg', name: 'Hornet SMG', slot: 2, damage: 17, rate: 0.075, auto: true, mag: 32, spread: 0.024, recoil: 0.016, range: 90, reload: 1.6, sound: 'smg', twoHanded: true, price: 700, ammoPrice: 100, ammoPack: 96 },
  shotgun: { id: 'shotgun', name: 'Breaker 12', slot: 3, damage: 15, pellets: 9, rate: 0.85, auto: false, mag: 6, spread: 0.07, recoil: 0.1, range: 45, reload: 2.2, sound: 'shotgun', twoHanded: true, price: 1000, ammoPrice: 90, ammoPack: 18 },
  rifle:   { id: 'rifle', name: 'Kestrel AR', slot: 4, damage: 34, rate: 0.11, auto: true, mag: 30, spread: 0.01, recoil: 0.024, range: 220, reload: 1.9, sound: 'rifle', twoHanded: true, price: 1800, ammoPrice: 150, ammoPack: 90 },
  grenade: { id: 'grenade', name: 'Firecracker', slot: 5, thrown: true, damage: 180, rate: 1.0, mag: 1, range: 0, price: 450, ammoPrice: 450, ammoPack: 4 },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun', 'rifle', 'grenade'];

let WMAT = null;
const MODEL_CACHE = {};
function vc(geo, col) {
  const g = geo.toNonIndexed(); const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); return g;
}
// Weapon model points along +z, grip at origin. muzzle stored in userData.
export function weaponModel(id) {
  if (!WMAT) WMAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });
  if (!MODEL_CACHE[id]) {
    const blk = [0.08, 0.08, 0.09], gun = [0.2, 0.2, 0.22], wood = [0.45, 0.26, 0.13], acc = [0.75, 0.55, 0.2], grn = [0.25, 0.4, 0.2];
    const parts = []; let muzzle = 0.2;
    const B = (w, h, d, x, y, z, col) => parts.push(vc(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col));
    const C = (r, len, x, y, z, col) => parts.push(vc(new THREE.CylinderGeometry(r, r, len, 8).rotateX(Math.PI / 2).translate(x, y, z), col));
    if (id === 'pistol') { B(0.035, 0.1, 0.05, 0, -0.02, -0.01, blk); B(0.04, 0.045, 0.2, 0, 0.05, 0.06, gun); C(0.01, 0.03, 0, 0.055, 0.17, blk); muzzle = 0.18; }
    else if (id === 'smg') { B(0.035, 0.1, 0.05, 0, -0.02, 0, blk); B(0.05, 0.07, 0.3, 0, 0.05, 0.08, gun); B(0.03, 0.16, 0.04, 0, -0.06, 0.12, blk); C(0.013, 0.1, 0, 0.055, 0.27, blk); B(0.03, 0.03, 0.14, 0, 0.04, -0.1, blk); muzzle = 0.32; }
    else if (id === 'shotgun') { B(0.035, 0.1, 0.05, 0, -0.02, 0, blk); B(0.05, 0.06, 0.25, 0, 0.05, 0.08, gun); C(0.018, 0.5, 0, 0.07, 0.4, blk); C(0.02, 0.2, 0, 0.035, 0.32, wood); B(0.045, 0.09, 0.3, 0, 0.02, -0.18, wood); muzzle = 0.65; }
    else if (id === 'rifle') { B(0.035, 0.1, 0.05, 0, -0.02, 0, blk); B(0.05, 0.08, 0.4, 0, 0.05, 0.1, gun); B(0.03, 0.15, 0.06, 0, -0.07, 0.15, acc); C(0.012, 0.28, 0, 0.06, 0.43, blk); B(0.04, 0.1, 0.25, 0, 0.03, -0.2, blk); B(0.025, 0.04, 0.12, 0, 0.11, 0.1, blk); muzzle = 0.58; }
    else if (id === 'grenade') { parts.push(vc(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1.25, 1).translate(0, 0.02, 0.03), grn)); B(0.02, 0.03, 0.02, 0, 0.09, 0.03, gun); muzzle = 0.05; }
    else return null;
    const g = mergeGeometries(parts);
    MODEL_CACHE[id] = { g, muzzle };
  }
  const m = new THREE.Mesh(MODEL_CACHE[id].g, WMAT);
  m.castShadow = true;
  m.userData.muzzle = MODEL_CACHE[id].muzzle;
  return m;
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.grenades = [];
    this.physOut = {};
    this.grenadeGeo = new THREE.SphereGeometry(0.07, 8, 6);
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3b5b2a, roughness: 0.6 });
  }

  // Nearest hit along a ray against world, ground/water, characters and vehicles.
  raycast(o, d, maxDist, ignoreChar = null, ignoreVeh = null) {
    const g = this.game;
    let best = maxDist, res = null;
    const ph = g.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxDist, this.physOut, 'fence');
    if (ph) { best = ph.t; res = { type: 'world', t: ph.t, normal: new THREE.Vector3(ph.nx, ph.ny, ph.nz), box: ph.box }; }
    if (d.y < -1e-4) {
      let t = (0.1 - o.y) / d.y;
      if (t > 0 && t < best) {
        const hx = o.x + d.x * t, hz = o.z + d.z * t;
        const th = terrainHeight(hx, hz);
        if (th < WORLD.WATER_Y) {
          t = (WORLD.WATER_Y - o.y) / d.y;
          if (t > 0 && t < best) { best = t; res = { type: 'water', t, normal: new THREE.Vector3(0, 1, 0) }; }
        } else {
          t = (th - o.y) / d.y;
          if (t > 0 && t < best) { best = t; res = { type: 'ground', t, normal: new THREE.Vector3(0, 1, 0) }; }
        }
      }
    }
    // characters
    const chars = g.allCharacters();
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c === ignoreChar || c.vehicle || !c.mesh.visible) continue;
      if (c.dead && c.deadTime > 0.8) continue;
      const r = c.radius + 0.05;
      const ox = o.x - c.pos.x, oz = o.z - c.pos.z;
      const a = d.x * d.x + d.z * d.z; if (a < 1e-8) continue;
      const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * cc; if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / (2 * a);
      if (t < 0) t = (-b + sq) / (2 * a);
      if (t < 0 || t > best) continue;
      const y = o.y + d.y * t - c.pos.y;
      const h = c.hitHeight ? c.hitHeight() : c.height;
      if (y < 0 || y > h) continue;
      best = t; res = { type: 'char', t, target: c, headshot: y > h - 0.28, normal: new THREE.Vector3(-d.x, 0, -d.z).normalize() };
    }
    // vehicles (oriented boxes)
    const vehs = g.vehicles.list;
    for (let i = 0; i < vehs.length; i++) {
      const v = vehs[i];
      if (v === ignoreVeh || !v.group.visible) continue;
      const hit = v.rayHit(o, d, best);
      if (hit && hit.t < best) { best = hit.t; res = { type: 'vehicle', t: hit.t, target: v, normal: hit.normal }; }
    }
    const heli = g.police && g.police.heli;
    if (heli && !heli.dead && heli !== ignoreChar) {
      const hh = heli.rayHit(o, d, best);
      if (hh) { best = hh.t; res = { type: 'vehicle', t: hh.t, target: heli, normal: hh.normal }; }
    }
    if (res) res.point = new THREE.Vector3().copy(o).addScaledVector(d, res.t);
    return res;
  }

  // Fire a hitscan weapon. shooter: character (player or npc). Returns true if anything was hit.
  fire(shooter, def, origin, dir, opts = {}) {
    const g = this.game;
    const pellets = def.pellets || 1;
    let hitSomething = false;
    const spreadMul = opts.spreadMul || 1;
    for (let p = 0; p < pellets; p++) {
      _d.copy(dir);
      const s = def.spread * spreadMul;
      if (s > 0) {
        _d.x += rand(-s, s); _d.y += rand(-s, s) * 0.8; _d.z += rand(-s, s);
        _d.normalize();
      }
      const hit = this.raycast(origin, _d, def.range, shooter, shooter.vehicle || null);
      const end = hit ? hit.point : _v.copy(origin).addScaledVector(_d, def.range).clone();
      if (p < 3 || Math.random() < 0.3) g.effects.tracer(origin, end, shooter.isPlayer ? [1, 0.85, 0.5] : [1, 0.6, 0.4]);
      if (!hit) continue;
      hitSomething = true;
      const dmgBase = def.damage * (opts.damageMul || 1);
      if (hit.type === 'char') {
        const t = hit.target;
        const mult = hit.headshot ? (shooter.isPlayer ? 3 : 1.4) : 1;
        t.takeDamage(dmgBase * mult, { attacker: shooter, dir: _d.clone(), point: hit.point, kind: 'bullet', headshot: hit.headshot });
        g.effects.impact(hit.point, hit.normal, 'blood');
        if (shooter.isPlayer) g.hud.hitMarker(t.dead);
      } else if (hit.type === 'vehicle') {
        hit.target.takeDamage(dmgBase * 0.9, { attacker: shooter, point: hit.point, kind: 'bullet' });
        g.effects.impact(hit.point, hit.normal, 'metal');
        if (shooter.isPlayer) g.hud.hitMarker(false, true);
      } else if (hit.type === 'water') {
        g.effects.impact(hit.point, hit.normal, 'water');
      } else {
        g.effects.impact(hit.point, hit.normal, hit.type === 'world' ? 'wall' : 'dust');
        if (hit.type === 'ground') g.effects.holes.add(hit.point, hit.normal, 1);
      }
    }
    g.effects.muzzleFlash(origin, dir, def.id === 'shotgun' ? 1.6 : 1);
    g.audio.gunshot(def.sound, origin);
    g.events.emit('gunfire', { shooter, origin });
    return hitSomething;
  }

  melee(attacker, def) {
    const g = this.game;
    const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    let best = null, bd = def.range;
    for (const c of g.allCharacters()) {
      if (c === attacker || c.dead || c.vehicle) continue;
      const dx = c.pos.x - attacker.pos.x, dz = c.pos.z - attacker.pos.z, d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(c.pos.y - attacker.pos.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.4) continue;
      best = c; bd = d;
    }
    g.audio.gunshot('punch', attacker.pos);
    if (best) {
      const dir = new THREE.Vector3(best.pos.x - attacker.pos.x, 0, best.pos.z - attacker.pos.z).normalize();
      best.takeDamage(def.damage * rand(0.8, 1.2), { attacker, dir, point: best.pos.clone().setY(best.pos.y + 1.4), kind: 'melee' });
      best.vel && best.vel.addScaledVector(dir, 3);
      g.audio.thud(best.pos);
      if (attacker.isPlayer) g.hud.hitMarker(best.dead);
      return true;
    }
    return false;
  }

  throwGrenade(owner, origin, dir, power = 16, lift = 4) {
    const m = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    m.castShadow = true;
    m.position.copy(origin);
    this.game.scene.add(m);
    const vel = dir.clone().multiplyScalar(power); vel.y += lift;
    this.grenades.push({ m, pos: origin.clone(), vel, fuse: 2.6, owner });
  }

  explode(pos, radius, damage, owner, opts = {}) {
    const g = this.game;
    g.effects.explosion(pos, opts.scale || 1);
    g.audio.explosion(pos, opts.scale || 1);
    g.cameraRig.shake(clamp(1.2 - pos.distanceTo(g.cameraRig.camera.position) / 60, 0, 1));
    for (const c of g.allCharacters()) {
      if (c.dead) continue;
      const d = c.pos.distanceTo(pos);
      if (d > radius) continue;
      if (c.vehicle) continue;
      const f = Math.pow(1 - d / radius, 0.7);
      const dir = new THREE.Vector3().subVectors(c.pos, pos).setY(0.5).normalize();
      c.takeDamage(damage * f, { attacker: owner, dir, point: c.pos.clone(), kind: 'explosion' });
      if (c.vel) c.vel.addScaledVector(dir, 10 * f);
    }
    for (const v of g.vehicles.list) {
      if (v === opts.source) continue;
      const d = v.pos.distanceTo(pos);
      if (d > radius * 1.3) continue;
      const f = 1 - d / (radius * 1.3);
      v.takeDamage(damage * 7 * Math.sqrt(f), { attacker: owner, point: pos, kind: 'explosion' });
      const dir = new THREE.Vector3().subVectors(v.pos, pos).setY(0).normalize();
      v.vel.x += dir.x * 9 * f; v.vel.z += dir.z * 9 * f; v.vy += 6 * f;
      v.angVel += (Math.random() - 0.5) * 3 * f;
    }
    g.events.emit('explosion', { pos, owner });
  }

  update(dt) {
    const g = this.game;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const q = this.grenades[i];
      q.vel.y -= 20 * dt;
      q.pos.addScaledVector(q.vel, dt);
      const gh = g.physics.groundHeight(q.pos.x, q.pos.z, q.pos.y, 0.1, 0.05);
      if (q.pos.y < gh + 0.07) {
        if (gh < WORLD.WATER_Y) { q.fuse = Math.min(q.fuse, 0.01); }
        q.pos.y = gh + 0.07; q.vel.y = Math.abs(q.vel.y) * 0.3; q.vel.x *= 0.45; q.vel.z *= 0.45;
      }
      const res = g.physics.resolveCircle(q.pos, 0.08, q.pos.y - 0.05, q.pos.y + 0.05);
      if (res.hit) { const vn = q.vel.x * res.nx + q.vel.z * res.nz; if (vn < 0) { q.vel.x -= 1.6 * vn * res.nx; q.vel.z -= 1.6 * vn * res.nz; } }
      q.m.position.copy(q.pos); q.m.rotation.x += dt * 10;
      q.fuse -= dt;
      if (q.fuse <= 0) {
        g.scene.remove(q.m);
        this.grenades.splice(i, 1);
        this.explode(q.pos.clone(), 7.5, WEAPONS.grenade.damage, q.owner);
      }
    }
  }
}
export { _n };
