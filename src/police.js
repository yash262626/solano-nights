// Wanted level, crime witnessing, police dispatch (cars, officers, helicopter) and evasion.
import * as THREE from 'three';
import { nearestNode, nodeNeighbors, laneFrame } from './vehicles.js';
import { WEAPONS } from './weapons.js';
import { rand, pick, chance, clamp, damp, dampAngle } from './utils.js';
import { CITY } from './config.js';
import { AI_TUNING as AT } from './tuning.js';

const rr = (range) => rand(range[0], range[1]);
const _pp = new THREE.Vector3(), _sp = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

const CRIMES = {
  shots:      { heat: 10, needWitness: true, call: 0.08 },
  hurt_civ:   { heat: 8, needWitness: true, call: 0.2 },
  kill_civ:   { heat: 22, needWitness: true, call: 0.45 },
  hurt_cop:   { heat: 30, min: 2 },
  kill_cop:   { heat: 45, min: 2 },
  carjack:    { heat: 10, needWitness: true, call: 0.1 },
  ram_cop:    { heat: 12, min: 1 },
  explosion:  { heat: 18, needWitness: true, call: 0.35 },
  steal_cop:  { heat: 25, min: 1 },
  hit_ped:    { heat: 10, needWitness: true, call: 0.3 },
};
const THRESH = [0, 1, 30, 70, 130, 210];

export class Police {
  constructor(game) {
    this.game = game;
    this.heat = 0; this.level = 0;
    this.unseenT = 0; this.seen = false;
    this.spawnT = 0; this.deployCd = 0;
    this.heli = null;
    this.pendingCall = 0;
    this.patrolT = 5;
    this._pursuers = [];
    // Permanent helicopter searchlight. It always exists (intensity 0 when unused) so spawning the
    // helicopter never changes the scene's light count, which would recompile every lit shader.
    this.searchlight = new THREE.SpotLight(0xe8f0ff, 0, 140, 0.16, 0.5, 1.2);
    this.searchlightTarget = new THREE.Object3D();
    this.searchlight.target = this.searchlightTarget;
    this.searchlight.position.set(0, -500, 0);
    game.scene.add(this.searchlight, this.searchlightTarget);
  }
  get evadeTime() { return AT.wanted.evadeBase + this.level * AT.wanted.evadePerStar; }
  levelFromHeat(h) { let l = 0; for (let i = 1; i < THRESH.length; i++) if (h >= THRESH[i]) l = i; return l; }
  setLevel(n) {
    n = clamp(n, 0, 5);
    if (n === 0) { this.clear(); return; }
    this.heat = Math.max(this.heat, THRESH[n]);
    const old = this.level; this.level = Math.max(this.level, n);
    this.unseenT = 0;
    if (this.level > old) this.game.hud.flashWanted();
  }
  clear() {
    const had = this.level > 0;
    this.heat = 0; this.level = 0; this.unseenT = 0; this.pendingCall = 0;
    for (const v of this.game.vehicles.list) if (v.police && v.ai && (v.ai.mode === 'pursue' || v.ai.mode === 'parked')) {
      v.siren = false;
      if (v.npcDriver) { const n = nearestNode(v.pos.x, v.pos.z); v.ai.mode = 'cruise'; v.ai.from = n; v.ai.to = pick(nodeNeighbors(n)); v.ai.next = this.game.vehicles.chooseNext(v.ai.to, v.ai.from); }
    }
    for (const n of this.game.peds.list) if (n.role === 'police') { n.hostile = false; n.ai.state = 'guard'; }
    if (had) this.game.hud.notify('You lost the cops.', 3);
  }
  policeWitness(pos, range = AT.wanted.witnessRange) {
    const g = this.game;
    for (const n of g.peds.list) {
      if (n.role !== 'police' || n.dead) continue;
      if (n.pos.distanceTo(pos) < range && g.physics.los(n.pos.x, n.pos.y + 1.6, n.pos.z, pos.x, pos.y + 1.2, pos.z)) return true;
    }
    for (const v of g.vehicles.list) {
      if (!v.police || !v.npcDriver || v.destroyed) continue;
      if (v.pos.distanceTo(pos) < range && g.physics.los(v.pos.x, v.y + 1.4, v.pos.z, pos.x, pos.y + 1.2, pos.z)) return true;
    }
    return false;
  }
  report(type, pos) {
    const c = CRIMES[type]; if (!c) return;
    if (this.game.player.dead) return;
    const witnessed = !c.needWitness || this.level > 0 || this.policeWitness(pos);
    if (witnessed) this.addHeat(c.heat, c.min || 1);
    else if (c.call && chance(c.call) && this.pendingCall <= 0) {
      this.pendingCall = rr(AT.wanted.callDelay); this.callHeat = c.heat;
    }
  }
  addHeat(h, min = 1) {
    this.heat += h;
    const l = Math.max(this.levelFromHeat(this.heat), min);
    if (l > this.level) { this.level = l; this.heat = Math.max(this.heat, THRESH[l]); this.game.hud.flashWanted(); }
    this.unseenT = 0;
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (this.pendingCall > 0) {
      this.pendingCall -= dt;
      if (this.pendingCall <= 0 && !p.dead) { this.addHeat(this.callHeat || 5, 1); g.hud.notify('A witness called the cops!', 3); }
    }
    this.managePatrols(dt);
    if (this.level === 0) { this.updateHeli(dt); return; }
    const P = p.vehicle ? p.vehicle.pos : p.pos;
    const W = AT.wanted;
    // are the police seeing the player?
    this.seeT = (this.seeT || 0) - dt;
    if (this.seeT <= 0) {
      this.seeT = W.seeInterval;
      const pp = _pp.set(P.x, (p.vehicle ? p.vehicle.y : p.pos.y), P.z);
      this.seen = this.policeWitness(pp, W.seeRange) || (this.heli && !this.heli.dead && this.heli.pos.distanceTo(pp) < W.heliSeeRange);
    }
    if (this.seen) this.unseenT = 0; else this.unseenT += dt;
    if (this.unseenT > this.evadeTime) { this.clear(); return; }

    // dispatch pursuit cars
    const wantCars = W.pursuitCars[this.level];
    const pursuers = this._pursuers; pursuers.length = 0;
    for (const v of g.vehicles.list) if (v.police && v.npcDriver && v.ai && v.ai.mode === 'pursue' && !v.destroyed) pursuers.push(v);
    this.spawnT -= dt;
    if (pursuers.length < wantCars && this.spawnT <= 0) { this.spawnT = W.spawnInterval; this.spawnPursuit(P); }
    // officers on foot
    let officers = 0;
    for (const n of g.peds.list) if (n.role === 'police' && !n.dead) officers++;
    this.deployCd -= dt;
    for (const v of pursuers) {
      v.siren = true;
      const d = v.ai.distToPlayer || 1e9;
      const stopped = !p.vehicle || p.vehicle.speed < 2;
      if (d < W.deployDist && stopped && v.speed < 3 && officers < W.maxOfficersBase + this.level * W.maxOfficersPerStar && this.deployCd <= 0) {
        this.deployCd = W.deployCooldown;
        v.ai.mode = 'parked';
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? 1 : -1;
          const w = v.toWorld(side * (v.def.W / 2 + 0.7), 0, 0.3, _v1);
          const weapon = this.level >= 4 ? pick(['smg', 'rifle']) : this.level >= 3 ? pick(['pistol', 'smg', 'shotgun']) : 'pistol';
          const o = g.peds.spawn('police', w.x, w.z, { weapon, hostile: this.level >= 2, armor: this.level >= 4 ? 50 : 0 });
          o.ai.state = 'combat';
          officers++;
        }
      }
    }
    for (const o of g.peds.list) if (o.role === 'police' && !o.dead) o.hostile = this.level >= 2;
    // parked police cars resume chase when player drives off
    for (const v of g.vehicles.list) {
      if (v.police && v.npcDriver && v.ai && v.ai.mode === 'parked' && p.vehicle && p.vehicle.speed > 8 && v.pos.distanceTo(p.vehicle.pos) > 25) v.ai.mode = 'pursue';
    }
    // helicopter at 4+ stars
    if (this.level >= W.heliStars && (!this.heli || this.heli.dead && this.heli.deadT > W.heliRespawnAfter)) {
      if (this.heli) this.heli.dispose();
      this.heli = new Helicopter(g, this, P.x + 150, P.z + 150);
    }
    this.updateHeli(dt);
  }
  updateHeli(dt) {
    if (!this.heli) return;
    this.heli.update(dt, this.level >= AT.wanted.heliStars);
    if (this.heli.gone) { this.heli.dispose(); this.heli = null; }
  }
  spawnPursuit(P) {
    const g = this.game, W = AT.wanted;
    const frustum = g.cameraRig.frustum();
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2, r = rr(W.spawnRadius);
      const n = nearestNode(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r);
      const to = pick(nodeNeighbors(n));
      const f = laneFrame(n, to);
      const x = f.A.x + f.dx * 20, z = f.A.z + f.dz * 20;
      if (Math.hypot(x - P.x, z - P.z) < W.minSpawnDist) continue;
      if (frustum.containsPoint(_sp.set(x, 1, z)) && Math.hypot(x - P.x, z - P.z) < W.visibleSpawnDist) continue;
      const v = g.vehicles.spawnTraffic(n, to, 0.2, 'police', 'pursue');
      if (!v) continue;
      v.siren = true; v.ai.replan = 0;
      return v;
    }
    return null;
  }
  // a couple of police cruisers patrol the streets
  managePatrols(dt) {
    this.patrolT -= dt;
    if (this.patrolT > 0) return;
    this.patrolT = AT.wanted.patrolInterval;
    const g = this.game, P = g.player.pos;
    let patrols = 0;
    for (const v of g.vehicles.list) if (v.police && v.npcDriver && v.ai && v.ai.mode === 'cruise') patrols++;
    if (patrols < AT.wanted.patrolCount) {
      for (let tries = 0; tries < 5; tries++) {
        const n = nearestNode(P.x + rand(-200, 200), P.z + rand(-200, 200));
        const v = g.vehicles.spawnTraffic(n, pick(nodeNeighbors(n)), Math.random(), 'police', 'cruise');
        if (v) { const vd = v.pos.distanceTo(P); if (vd < 60) { g.vehicles.remove(v); continue; } break; }
      }
    }
  }
}

// ---------------------------------------------------------------- helicopter
// Geometry and materials are built once and shared by every helicopter instance (no per-spawn leaks).
let HELI_TEMPLATE = null;
function heliTemplate() {
  if (HELI_TEMPLATE) return HELI_TEMPLATE;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.35, metalness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1620, roughness: 0.05, metalness: 0.3, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), bodyMat); body.scale.set(1, 0.9, 1.8); body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.1, 1.5); nose.scale.set(1, 1, 0.8);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 5, 8), bodyMat); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.3, -4.2);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), white); fin.position.set(0, 0.8, -6.5);
  const skidGeo = new THREE.BoxGeometry(0.1, 0.1, 3.4);
  const skidL = new THREE.Mesh(skidGeo, white); skidL.position.set(0.9, -1.4, 0);
  const skidR = new THREE.Mesh(skidGeo, white); skidR.position.set(-0.9, -1.4, 0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.3, 3), white); stripe.position.y = -0.2;
  const bladeGeo = new THREE.BoxGeometry(11, 0.05, 0.35);
  const rotor = new THREE.Mesh(bladeGeo, dark); rotor.name = 'rotor'; rotor.position.y = 1.45;
  const r2 = new THREE.Mesh(bladeGeo, dark); r2.rotation.y = Math.PI / 2; rotor.add(r2);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), dark); tailRotor.name = 'tailRotor'; tailRotor.position.set(0.15, 0.8, -6.5);
  const lightR = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff2020 })); lightR.name = 'blink'; lightR.position.set(0, -1.1, 0);
  g.add(body, nose, tail, fin, skidL, skidR, stripe, rotor, tailRotor, lightR);
  const coneGeo = new THREE.CylinderGeometry(0.2, 8, 50, 16, 1, true); coneGeo.translate(0, -25, 0);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  HELI_TEMPLATE = { group: g, cone };
  return HELI_TEMPLATE;
}

class Helicopter {
  constructor(game, police, x, z) {
    this.game = game; this.police = police;
    this.pos = new THREE.Vector3(x, 45, z);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.health = AT.heli.health; this.dead = false; this.deadT = 0; this.fireCd = 3; this.gone = false;
    this.ang = Math.random() * 6.28;
    const T = heliTemplate();
    const g = T.group.clone(); // clones share geometry + materials
    this.rotor = g.getObjectByName('rotor');
    this.tailRotor = g.getObjectByName('tailRotor');
    this.blink = g.getObjectByName('blink');
    this.cone = T.cone.clone();
    game.scene.add(this.cone);
    this.spot = police.searchlight;
    this.spotTarget = police.searchlightTarget;
    this.spot.intensity = 0;
    this.group = g;
    game.scene.add(g);
    this.hitbox = { r: 2.2 };
    this._desired = new THREE.Vector3();
  }
  rayHit(o, d, maxT) {
    const oc = _v2.subVectors(o, this.pos);
    const b = oc.dot(d), c = oc.lengthSq() - this.hitbox.r ** 2, disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxT) return null;
    return { t, normal: new THREE.Vector3().copy(o).addScaledVector(d, t).sub(this.pos).normalize() };
  }
  takeDamage(a, info = {}) {
    if (this.dead) return;
    this.health -= a;
    if (this.health <= 0) {
      this.dead = true; this.deadT = 0;
      this.game.effects.explosion(this.pos, 1.2); this.game.audio.explosion(this.pos, 1);
      if (info.attacker && info.attacker.isPlayer) this.game.hud.notify('Police helicopter down!', 3);
    }
  }
  update(dt, active) {
    const g = this.game, p = g.player;
    const P = p.vehicle ? p.vehicle.pos : p.pos;
    this.rotor.rotation.y += dt * 30; this.tailRotor.rotation.x += dt * 40;
    this.blink.visible = Math.sin(performance.now() * 0.008) > 0;
    if (this.dead) {
      this.deadT += dt;
      this.vel.y -= 15 * dt; this.pos.addScaledVector(this.vel, dt);
      this.group.rotation.y += dt * 4;
      if (Math.random() < dt * 30) g.effects.smoke(this.pos, 1.5, 0.1);
      const gh = g.physics.groundHeight(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y <= gh + 0.5 && !this.crashed) {
        this.crashed = true;
        g.weapons.explode(this.pos.clone(), 10, 200, null, { scale: 1.6 });
        this.group.visible = false; this.cone.visible = false; this.spot.intensity = 0;
      }
      if (this.crashed) this.gone = this.deadT > 40;
      this.group.position.copy(this.pos);
      return;
    }
    // orbit above the player
    const H = AT.heli;
    if (active) this.ang += dt * H.orbitSpeed;
    const tx = active ? P.x + Math.cos(this.ang) * H.orbitRadius : P.x + 800, tz = active ? P.z + Math.sin(this.ang) * H.orbitRadius : P.z + 800;
    const ty = active ? Math.max(H.minAltitude, P.y + H.altitudeAbovePlayer) : 120;
    const desired = this._desired.set(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z);
    const dl = desired.length();
    desired.multiplyScalar(Math.min(dl, H.maxSpeed) / (dl || 1));
    this.vel.lerp(desired, 1 - Math.exp(-dt * 0.8));
    this.pos.addScaledVector(this.vel, dt);
    this.yaw = dampAngle(this.yaw, Math.atan2(P.x - this.pos.x, P.z - this.pos.z), 2, dt);
    this.group.position.copy(this.pos);
    this.group.rotation.set(clamp(this.vel.length() * 0.01, 0, 0.25), this.yaw, 0);
    if (!active && Math.hypot(this.pos.x - P.x, this.pos.z - P.z) > 600) this.gone = true;
    // searchlight
    const night = g.env.night;
    // the shared searchlight follows the helicopter nose (it is not parented, so it never leaves the scene)
    this.spot.position.set(this.pos.x, this.pos.y - 1.3, this.pos.z);
    this.spot.intensity = active ? 400 * night + 20 : 0;
    this.spotTarget.position.set(P.x, P.y, P.z);
    this.cone.visible = active && night > 0.3;
    this.cone.position.set(this.pos.x, this.pos.y - 1.3, this.pos.z);
    this.cone.lookAt(P.x, P.y, P.z); this.cone.rotateX(-Math.PI / 2);
    const d = this.pos.distanceTo(P);
    this.cone.scale.set(1, d / 50, 1);
    // gunner
    this.fireCd -= dt;
    if (active && this.fireCd <= 0 && d < H.fireRange && !p.dead) {
      this.fireCd = rr(H.shotGap);
      this.burst = (this.burst || 0) + 1;
      if (this.burst > H.burstShots) { this.burst = 0; this.fireCd = rr(H.burstGap); }
      const o = _v1.set(this.pos.x, this.pos.y - 1.5, this.pos.z);
      const aim = p.vehicle ? _v2.set(p.vehicle.pos.x, p.vehicle.y + 1, p.vehicle.pos.z) : p.chestPos(_v2);
      const miss = H.missBase + d * H.missPerMeter;
      aim.x += rand(-miss, miss); aim.z += rand(-miss, miss);
      const dir = aim.sub(o).normalize();
      g.weapons.fire(this, WEAPONS.rifle, o, dir, { spreadMul: 1, damageMul: H.damageMul });
    }
  }
  // Only scene removal is needed: geometry/materials are shared templates and the light is permanent.
  dispose() {
    this.game.scene.remove(this.group); this.game.scene.remove(this.cone);
    this.spot.intensity = 0;
  }
}
export { CITY };
