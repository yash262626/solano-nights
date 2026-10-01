// NPCs: civilians walking the sidewalks, gang members and police officers with combat AI.
import * as THREE from 'three';
import { Character } from './character.js';
import { randomAppearance, SKIN_TONES } from './humanoid.js';
import { WEAPONS } from './weapons.js';
import { CITY, blockAt, WORLD } from './config.js';
import { clamp, rand, pick, chance, dampAngle, wrapAngle } from './utils.js';
import { AI_TUNING as AT } from './tuning.js';

const rr = (range) => rand(range[0], range[1]);
const _spawnPt = new THREE.Vector3();

const CORNER_X = [0, 1, 1, 0], CORNER_Z = [0, 0, 1, 1]; // NW, NE, SE, SW
// neighbour across the street for each corner: [di, dj, corner] options
const CROSS = [
  [[0, -1, 3], [-1, 0, 1]],
  [[0, -1, 2], [1, 0, 0]],
  [[0, 1, 1], [1, 0, 3]],
  [[0, 1, 0], [-1, 0, 2]],
];

let markerGeo = null, markerMat = null;

export class NPC extends Character {
  constructor(game, role, appearance) {
    super(game, appearance);
    this.role = role;
    this.ai = { state: 'idle', t: 0 };
    this.isPlayer = false;
    this.hostile = false;
    this.marker = null;
    this.clip = 0; this.fireCd = 0; this.reloadT = 0;
    // per-NPC scratch objects so the AI does not allocate every frame
    this._eye = new THREE.Vector3(); this._pc = new THREE.Vector3(); this._aim = new THREE.Vector3(); this._muz = new THREE.Vector3();
    this._out = { x: 0, z: 0, speed: 0, face: null };
  }
  get team() { return this.role === 'police' ? 'police' : this.role === 'gang' ? 'gang' : 'civ'; }

  init(role, x, z, opts = {}) {
    this.role = role;
    this.pos.set(x, this.game.physics.groundHeight(x, z, 50), z);
    this.vel.set(0, 0, 0);
    this.yaw = opts.yaw !== undefined ? opts.yaw : rand(-Math.PI, Math.PI);
    this.dead = false; this.deadTime = 0; this.knockT = 0; this.swimming = false; this.vehicle = null;
    const tune = role === 'police' ? AT.police : role === 'gang' ? AT.gang : AT.civ;
    this.maxHealth = opts.health || tune.health;
    this.health = this.maxHealth; this.armor = opts.armor || 0;
    this.hostile = !!opts.hostile; this.invulnerable = !!opts.invulnerable;
    this.mission = opts.mission || null;
    this.accuracy = opts.accuracy || (role === 'police' ? AT.police.accuracy : AT.gang.accuracy);
    this.detectRange = opts.detectRange || (role === 'police' ? AT.police.detectRange : AT.gang.detectRange);
    this.ai = { state: role === 'civ' ? 'walk' : 'guard', t: 0, home: new THREE.Vector3(x, 0, z), strafe: rand(0, 6), seenT: 0, lastSeen: null, burst: 0, arrestT: 0, alertT: 0 };
    this.anim.deadT = 0;
    this.mesh.visible = true;
    this.setWeapon(opts.weapon || 'fist');
    this.clip = WEAPONS[this.weaponId].mag || 0;
    this.animState.cower = false; this.animState.handsUp = false;
    if (role === 'civ') this.pickRing();
    this.setMarker(!!opts.marker);
    this.idleAnim = opts.idle || false;
    this.cash = role === 'civ' ? Math.floor(rr(AT.civ.cash)) : role === 'gang' ? Math.floor(rr(AT.gang.cash)) : 0;
    return this;
  }
  setMarker(on) {
    if (on && !this.marker) {
      if (!markerGeo) { markerGeo = new THREE.ConeGeometry(0.16, 0.35, 4); markerGeo.rotateX(Math.PI); markerMat = new THREE.MeshBasicMaterial({ color: 0xff3040 }); }
      this.marker = new THREE.Mesh(markerGeo, markerMat);
      this.marker.position.y = 2.25;
      this.bones.root.parent.add(this.marker);
    } else if (!on && this.marker) { this.marker.parent.remove(this.marker); this.marker = null; }
  }

  // ------------------------------------------------------------ civilians
  pickRing() {
    const b = blockAt(this.pos.x, this.pos.z);
    const ai = this.ai;
    if (!b) { ai.ring = null; return; }
    ai.ring = b;
    const r = this.game.world.rings[b.i][b.j];
    // nearest corner
    let best = 0, bd = 1e9;
    for (let k = 0; k < 4; k++) {
      const cx = CORNER_X[k] ? r.x1 : r.x0, cz = CORNER_Z[k] ? r.z1 : r.z0;
      const d = Math.hypot(cx - this.pos.x, cz - this.pos.z);
      if (d < bd) { bd = d; best = k; }
    }
    ai.dir = chance(0.5) ? 1 : -1;
    ai.corner = (best + ai.dir + 4) % 4;
    ai.walkSpeed = rr(AT.civ.walkSpeed);
    ai.state = 'walk';
  }
  cornerPos(i, j, k) {
    const r = this.game.world.rings[i][j];
    return { x: CORNER_X[k] ? r.x1 : r.x0, z: CORNER_Z[k] ? r.z1 : r.z0 };
  }
  scare(from, strength = 1) {
    if (this.dead || this.role !== 'civ' || this.invulnerable) return;
    const d = Math.hypot(from.x - this.pos.x, from.z - this.pos.z);
    const ai = this.ai;
    const C = AT.civ;
    if (!ai.from) ai.from = new THREE.Vector3();
    if (ai.state === 'flee' && ai.t > 0.5) { ai.t = Math.max(ai.t, C.fleeRefresh); ai.from.copy(from); return; }
    if (d < C.cowerRadius && chance(C.cowerChance * strength) && ai.state !== 'flee') { ai.state = 'cower'; ai.t = rr(C.cowerTime); ai.from.copy(from); return; }
    ai.state = 'flee'; ai.t = rr(C.fleeTime); ai.from.copy(from);
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.game, ai = this.ai;
    if (this.dead) {
      this.deadTime += dt;
      this.locomote(dt, 0, 0);
      this.updateAnim(dt);
      return;
    }
    let wantX = 0, wantZ = 0, faceYaw = null, speed = 0;
    ai.t -= dt;
    this.animState.cower = false; this.animState.handsUp = false; this.aim = Math.max(0, this.aim - dt * 3);
    if (this.knockT > 0) {
      this.locomote(dt, 0, 0, 2);
      this.animState.speed = 0; this.animState.aim = 0; this.updateAnim(dt);
      if (this.knockT <= 0 && this.role === 'civ') { ai.state = 'flee'; ai.t = AT.civ.knockFleeTime; ai.from = this.pos.clone().add(this.vel); }
      return;
    }
    const C = AT.civ;
    if (this.role === 'civ') {
      if (ai.state === 'walk' || ai.state === 'cross') {
        if (!ai.ring) this.pickRing();
        if (ai.ring) {
          const tgt = ai.state === 'cross' ? ai.crossTo : this.cornerPos(ai.ring.i, ai.ring.j, ai.corner);
          const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.8) {
            if (ai.state === 'cross') { ai.state = 'walk'; ai.ring = ai.crossRing; ai.corner = (ai.crossCorner + ai.dir + 4) % 4; }
            else {
              const opts = CROSS[ai.corner].filter(([di, dj]) => {
                const ni = ai.ring.i + di, nj = ai.ring.j + dj;
                return ni >= 0 && nj >= 0 && ni < CITY.NX && nj < CITY.NZ;
              });
              if (opts.length && chance(C.crossChance)) {
                const [di, dj, k] = pick(opts);
                ai.crossRing = { i: ai.ring.i + di, j: ai.ring.j + dj }; ai.crossCorner = k;
                ai.crossTo = this.cornerPos(ai.crossRing.i, ai.crossRing.j, k);
                ai.state = 'cross';
              } else ai.corner = (ai.corner + ai.dir + 4) % 4;
            }
          } else {
            speed = ai.state === 'cross' ? ai.walkSpeed * C.crossSpeedMul : ai.walkSpeed;
            wantX = dx / d * speed; wantZ = dz / d * speed;
          }
        }
        // wait while a car blocks the crossing
        if (ai.state === 'cross') for (const v of g.vehicles.list) {
          if (v.speed > 3 && Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) < C.carWaitRadius) {
            const ahead = (this.pos.x - v.pos.x) * Math.sin(v.heading) + (this.pos.z - v.pos.z) * Math.cos(v.heading);
            if (ahead > 0) { wantX *= 0.1; wantZ *= 0.1; }
          }
        }
        this.dodgeCars();
      } else if (ai.state === 'flee') {
        const from = ai.from || this.pos;
        let dx = this.pos.x - from.x, dz = this.pos.z - from.z; const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        if (this.col.hit) { ai.fleeRot = (ai.fleeRot || 0) + (chance(0.5) ? 1.2 : -1.2); }
        const a = Math.atan2(dx, dz) + (ai.fleeRot || 0);
        speed = C.fleeSpeed;
        wantX = Math.sin(a) * speed; wantZ = Math.cos(a) * speed;
        if (ai.t <= 0) { ai.fleeRot = 0; this.pickRing(); }
      } else if (ai.state === 'cower') {
        this.animState.cower = true;
        if (ai.t <= 0) { ai.state = 'flee'; ai.t = rr(C.fleeAfterCower); }
      } else if (ai.state === 'idle') {
        if (ai.faceYaw !== undefined) faceYaw = ai.faceYaw;
      }
    } else {
      const r = this.combatAI(dt);
      wantX = r.x; wantZ = r.z; speed = r.speed; faceYaw = r.face;
    }
    if (this.swimming) { wantX *= 0.4; wantZ *= 0.4; }
    this.locomote(dt, wantX, wantZ, 10);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (faceYaw !== null && faceYaw !== undefined) this.yaw = dampAngle(this.yaw, faceYaw, 10, dt);
    else if (hs > 0.3) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 8, dt);
    this.animState.speed = hs;
    this.animState.back = false;
    if (faceYaw !== null && faceYaw !== undefined && hs > 0.3) {
      const mv = Math.atan2(this.vel.x, this.vel.z);
      this.animState.back = Math.abs(wrapAngle(mv - this.yaw)) > 2.0;
    }
    this.animState.aim = this.aim; this.animState.aimPitch = this.aimPitch;
    this.updateAnim(dt);
  }
  dodgeCars() {
    const C = AT.civ;
    for (const v of this.game.vehicles.list) {
      if (v.speed < C.dodgeMinCarSpeed) continue;
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z, d = Math.hypot(dx, dz);
      if (d > C.dodgeRadius) continue;
      const vx = v.vel.x / v.speed, vz = v.vel.z / v.speed;
      const ahead = dx * vx + dz * vz, lat = dx * -vz + dz * vx;
      if (ahead > 0 && ahead < C.dodgeAhead && Math.abs(lat) < C.dodgeLateral && this.onGround) {
        const s = lat >= 0 ? 1 : -1;
        this.vel.x = -vz * s * C.dodgeSpeed; this.vel.z = vx * s * C.dodgeSpeed; this.vel.y = C.dodgeHop; this.onGround = false;
        this.ai.state = 'flee'; this.ai.t = C.dodgeFleeTime; this.ai.from = v.pos.clone();
        return;
      }
    }
  }

  // ------------------------------------------------------------ combat (gang + police)
  combatAI(dt) {
    const g = this.game, ai = this.ai, p = g.player, CB = AT.combat, PT = AT.police;
    const out = this._out; out.x = 0; out.z = 0; out.speed = 0; out.face = null;
    const target = p.vehicle ? p.vehicle.pos : p.pos;
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, dist = Math.hypot(dx, dz);
    const toYaw = Math.atan2(dx, dz);
    const police = this.role === 'police';
    const wanted = g.police.level;
    const engage = !p.dead && (this.hostile || (police && wanted > 0));
    // detection
    const eye = this.eyePos(this._eye);
    const pc = p.vehicle ? this._pc.set(target.x, p.vehicle.y + 1, target.z) : p.chestPos(this._pc);
    let sees = false;
    ai.losT = (ai.losT || 0) - dt;
    if (dist < this.detectRange && engage) {
      if (ai.losT <= 0) { ai.losT = CB.losInterval; ai.los = g.physics.los(eye.x, eye.y, eye.z, pc.x, pc.y, pc.z); }
      const fov = Math.abs(wrapAngle(toYaw - this.yaw)) < CB.fov || dist < CB.closeAwareDist || ai.state === 'combat' || ai.alertT > 0;
      sees = ai.los && fov;
    }
    ai.alertT -= dt;
    if (sees) {
      ai.seenT = 0;
      if (!ai.lastSeen) ai.lastSeen = new THREE.Vector3();
      ai.lastSeen.set(target.x, 0, target.z);
      if (ai.state === 'guard' || ai.state === 'patrol') { ai.state = 'combat'; this.fireCd = Math.max(this.fireCd, rr(CB.reactionDelay)); }
    }
    else ai.seenT += dt;
    this.canSee = sees;

    if (!engage) {
      // idle guard or patrol
      if (this.idleAnim) out.face = this.idleFace;
      ai.state = 'guard';
      return out;
    }
    if (ai.state === 'guard' && !sees) {
      if (police) { // run towards player's area when wanted
        const d2 = ai.lastSeen || target;
        const ddx = d2.x - this.pos.x, ddz = d2.z - this.pos.z, dd = Math.hypot(ddx, ddz);
        if (dd > 3) { out.speed = PT.searchSpeed; out.x = ddx / dd * PT.searchSpeed; out.z = ddz / dd * PT.searchSpeed; }
      }
      return out;
    }
    // arrest attempt: police at 1 star, or up to surrenderMaxStars when the player surrenders on foot
    const surrendered = p.surrendered && !p.vehicle;
    const arrestMode = police && !p.vehicle && !p.dead && (wanted === 1 || (surrendered && wanted <= AT.wanted.surrenderMaxStars));
    if (arrestMode) {
      if (dist > PT.arrestRange) {
        const sp = dist > 4 ? PT.arrestChaseSpeed : PT.arrestApproachSpeed;
        out.x = dx / dist * sp; out.z = dz / dist * sp; out.speed = sp; out.face = toYaw;
        ai.arrestT = Math.max(0, ai.arrestT - dt);
      } else {
        out.face = toYaw; ai.arrestT += dt;
        if (ai.arrestT > (surrendered ? PT.surrenderArrestTime : PT.arrestTime)) g.busted();
      }
      this.aim = 0.8 * (dist < PT.arrestAimRange ? 1 : 0); this.aimPitch = 0;
      return out;
    }
    // combat movement
    const def = WEAPONS[this.weaponId];
    const pref = def.melee ? CB.prefDistMelee : def.id === 'shotgun' ? CB.prefDistShotgun : CB.prefDist;
    const chaseTarget = sees ? target : (ai.lastSeen || target);
    const cdx = chaseTarget.x - this.pos.x, cdz = chaseTarget.z - this.pos.z, cd = Math.hypot(cdx, cdz) || 1;
    if (!sees && ai.seenT > 1) {
      if (cd > 2) { out.speed = CB.chaseSpeed; out.x = cdx / cd * CB.chaseSpeed; out.z = cdz / cd * CB.chaseSpeed; }
      if (ai.seenT > CB.giveUpTime && !police && !this.mission) { ai.state = 'guard'; }
    } else {
      ai.strafe += dt;
      const sx = -dz / dist, sz = dx / dist;
      const strafeDir = Math.sin(ai.strafe * 0.8) > 0 ? 1 : -1;
      let mx = 0, mz = 0, sp;
      if (dist > pref + 4) { mx = dx / dist; mz = dz / dist; sp = def.melee ? CB.meleeAdvanceSpeed : CB.advanceSpeed; }
      else if (dist < pref * 0.5 && !def.melee) { mx = -dx / dist; mz = -dz / dist; sp = CB.retreatSpeed; }
      else { mx = sx * strafeDir; mz = sz * strafeDir; sp = Math.sin(ai.strafe * 0.37) > -0.3 ? CB.strafeSpeed : 0; }
      if (def.melee && dist <= pref + 0.5) sp = 0;
      out.x = mx * sp; out.z = mz * sp; out.speed = sp;
      out.face = toYaw;
    }
    // shooting
    this.fireCd -= dt; this.reloadT -= dt;
    if (sees) {
      this.aim = Math.min(1, this.aim + dt * 6);
      this.aimPitch = Math.atan2(pc.y - eye.y, dist) * 0.8;
      if (def.melee) {
        if (dist < CB.meleeRange && this.fireCd <= 0) {
          this.fireCd = CB.meleeCooldown; this.punchT = 0.35;
          g.schedule(CB.meleeHitDelay, () => { if (!this.dead) g.weapons.melee(this, def); });
        }
      } else if (this.reloadT <= 0 && this.fireCd <= 0 && ai.seenT <= 0 && Math.abs(wrapAngle(toYaw - this.yaw)) < CB.aimTolerance) {
        if (this.clip <= 0) { this.reloadT = def.reload * CB.reloadMul; this.clip = def.mag; }
        else {
          if (ai.burst <= 0) ai.burst = def.auto ? Math.floor(rr(CB.burst)) : 1;
          ai.burst--;
          this.fireCd = ai.burst > 0 ? def.rate * CB.burstRateMul : rr(CB.burstGap) * (police ? PT.fireGapMul : CB.gangGapMul) + def.rate;
          this.clip--;
          const m = this.muzzlePos(this._muz);
          const pspeed = p.vehicle ? p.vehicle.speed : Math.hypot(p.vel.x, p.vel.z);
          const aimAt = this._aim.copy(pc);
          const miss = (CB.missBase + dist * CB.missPerMeter + pspeed * CB.missPerTargetSpeed) * this.accuracy;
          aimAt.x += rand(-miss, miss); aimAt.y += rand(-miss, miss) * 0.8; aimAt.z += rand(-miss, miss);
          const dir = aimAt.sub(m).normalize();
          g.weapons.fire(this, def, m, dir, { spreadMul: CB.spreadMul, damageMul: police ? PT.damageMul : AT.gang.damageMul });
        }
      }
    }
    return out;
  }

  onDamaged(a, info) {
    const g = this.game;
    if (info.attacker && info.attacker.isPlayer) {
      if (this.role === 'civ') {
        this.ai.state = 'flee'; this.ai.t = AT.civ.hurtFleeTime; this.ai.from = info.attacker.pos.clone();
        if (this.health > 0) this.game.police.report('hurt_civ', this.pos);
      } else {
        this.hostile = true; this.ai.state = 'combat'; this.ai.alertT = AT.gang.alertTime;
        if (this.role === 'police' && this.game.police) this.game.police.report('hurt_cop', this.pos);
        // gang friends join the fight
        if (this.role === 'gang') for (const o of g.peds.list) if (o.role === 'gang' && !o.dead && o.pos.distanceTo(this.pos) < AT.gang.allyAlertRadius) { o.hostile = true; o.ai.alertT = AT.gang.alertTime; }
      }
    }
    if (this.role === 'civ' && !info.attacker) { this.ai.state = 'flee'; this.ai.t = AT.civ.knockFleeTime; this.ai.from = this.pos.clone(); if (info.dir) this.ai.from.sub(info.dir); }
  }
  onDeath(info) {
    const g = this.game;
    this.setMarker(false);
    if (info.attacker && info.attacker.isPlayer) {
      if (this.role === 'police') g.police.report('kill_cop', this.pos);
      if (this.role === 'civ') g.police.report('kill_civ', this.pos);
      g.stats.kills++;
    }
    if (this.cash > 0 && info.kind !== 'drown' && !this.swimming) g.pickups.add('cash', this.pos.x + rand(-0.5, 0.5), this.pos.y, this.pos.z + rand(-0.5, 0.5), { amount: this.cash, ttl: 40 });
    if (this.role !== 'civ' && this.weaponId !== 'fist' && chance(0.5) && !this.swimming) g.pickups.add('weapon', this.pos.x + 0.6, this.pos.y, this.pos.z, { weapon: this.weaponId, amount: Math.floor(WEAPONS[this.weaponId].mag * rand(1, 2)), ttl: 40 });
    g.events.emit('npcKilled', { npc: this, info });
  }
}

// ---------------------------------------------------------------- manager
export class PedManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pool = [];
    this.spawnT = 0;
    this.civTarget = 34;
  }
  spawn(role, x, z, opts = {}) {
    let n = this.pool.pop();
    const app = opts.appearance || this.appearanceFor(role);
    if (n) { n.setAppearance(app); this.game.scene.add(n.mesh); }
    else n = new NPC(this.game, role, app);
    n.init(role, x, z, opts);
    n.updateAnim(0.016);
    this.list.push(n);
    return n;
  }
  appearanceFor(role) {
    const a = randomAppearance();
    if (role === 'police') Object.assign(a, { shirt: '#1d2d50', pants: '#141a2b', shoes: '#0b0b0b', sleeves: 'short', shorts: false, belt: '#0b0b0b', vest: this.game.police.level >= 4 ? '#2a2f36' : null, glasses: chance(0.4) });
    if (role === 'gang') Object.assign(a, { shirt: pick(['#12b3b3', '#0fa3a8', '#18c7c0']), pants: pick(['#f2f2f2', '#1b1b1b', '#d8d2c0']), hair: '#1b1b1b', sleeves: 'none', shorts: chance(0.3), belt: '#c1121f', glasses: chance(0.5) });
    return a;
  }
  remove(n) {
    const i = this.list.indexOf(n);
    if (i >= 0) this.list.splice(i, 1);
    this.game.scene.remove(n.mesh);
    n.setMarker(false);
    n.mission = null;
    this.pool.push(n);
  }
  broadcastThreat(pos, radius, strength = 1) {
    for (const n of this.list) {
      if (n.dead) continue;
      const d = n.pos.distanceTo(pos);
      if (d > radius) continue;
      if (n.role === 'civ') n.scare(pos, strength);
      else if (n.role === 'gang' && d < radius * 0.6 && n.hostile === false && this.game.player.pos.distanceTo(n.pos) < 25) { n.ai.alertT = 3; }
    }
  }
  stream(dt) {
    const g = this.game, p = g.player, P = p.vehicle ? p.vehicle.pos : p.pos;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      if (n.mission || n.invulnerable) continue;
      const d = Math.hypot(n.pos.x - P.x, n.pos.z - P.z);
      if (d > 160 || (n.dead && n.deadTime > 25 && d > 30) || (n.dead && n.deadTime > 60)) this.remove(n);
    }
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.2;
    let civs = 0;
    for (const n of this.list) if (n.role === 'civ' && !n.dead) civs++;
    const night = g.env.night;
    const target = Math.round(this.civTarget * (1 - night * 0.35) * (g.env.weather.rain > 0.5 ? 0.6 : 1));
    if (civs >= target) return;
    const frustum = g.cameraRig.frustum();
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(35, 120);
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      const b = blockAt(x, z);
      if (!b) continue;
      const ring = g.world.rings[b.i][b.j];
      // snap onto the ring rectangle
      const side = Math.floor(Math.random() * 4);
      let sx, sz;
      if (side === 0) { sx = rand(ring.x0, ring.x1); sz = ring.z0; } else if (side === 1) { sx = rand(ring.x0, ring.x1); sz = ring.z1; }
      else if (side === 2) { sx = ring.x0; sz = rand(ring.z0, ring.z1); } else { sx = ring.x1; sz = rand(ring.z0, ring.z1); }
      const d = Math.hypot(sx - P.x, sz - P.z);
      if (d < 30) continue;
      if (d < 80 && frustum.containsPoint(_spawnPt.set(sx, 1, sz))) continue;
      this.spawn('civ', sx, sz);
      break;
    }
  }
  update(dt) {
    const P = this.game.player.pos;
    for (const n of this.list) {
      const far = n.pos.distanceToSquared(P) > 110 * 110;
      if (far) { n.skip = !n.skip; if (n.skip) continue; n.update(dt * 2); } else n.update(dt);
    }
    this.stream(dt);
  }
}
export { SKIN_TONES, WORLD };
