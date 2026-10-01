// Player controller: on-foot movement, aiming/shooting, vehicles (enter/exit/carjack/drive-by), inventory.
import * as THREE from 'three';
import { Character } from './character.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { clamp, dampAngle, damp, rand, wrapAngle } from './utils.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Player extends Character {
  constructor(game) {
    super(game, { skin: '#e0ac85', shirt: '#2ec4b6', pants: '#f1faee', hair: '#3b2416', shoes: '#6b4423', sleeves: 'short', shorts: false, build: 1.0, belt: '#6b4423', glasses: true });
    this.isPlayer = true;
    this.money = 250;
    this.inv = { fist: { clip: 0, ammo: 0 } };
    this.aiming = false; this.sprinting = false; this.walkMode = false;
    this.fireCd = 0; this.reloadT = 0; this.bloom = 0; this.shootFaceT = 0; this.meleeT = -1;
    this.lastVehicle = null; this.enterCd = 0;
    this.maxHealth = 100; this.health = 100;
    this.setWeapon('fist');
    this.mesh.frustumCulled = false;
  }
  get team() { return 'player'; }
  addMoney(n, silent) {
    this.money = Math.max(0, this.money + n);
    if (!silent && n > 0) this.game.hud.moneyPop(n);
  }
  owned() { return WEAPON_ORDER.filter((id) => this.inv[id] && (id === 'fist' || this.inv[id].clip + this.inv[id].ammo > 0)); }
  giveWeapon(id, ammo) {
    if (!this.inv[id]) this.inv[id] = { clip: 0, ammo: 0 };
    const w = this.inv[id];
    w.ammo += ammo;
    if (w.clip === 0) this.refill(id);
    if (this.weaponId === 'fist' || (this.weaponId === 'pistol' && id !== 'grenade' && WEAPONS[id].slot > 1)) this.switchTo(id);
  }
  refill(id) {
    const w = this.inv[id], def = WEAPONS[id];
    const take = Math.min(def.mag - w.clip, w.ammo);
    w.clip += take; w.ammo -= take;
  }
  switchTo(id) {
    if (!this.inv[id]) return;
    this.reloadT = 0;
    this.setWeapon(id);
    this.game.hud.weaponChanged();
  }
  cycle(dir) {
    const o = this.owned();
    const i = o.indexOf(this.weaponId);
    this.switchTo(o[(i + dir + o.length) % o.length]);
  }
  startReload() {
    const def = this.weaponDef, w = this.inv[this.weaponId];
    if (!def.mag || def.thrown || this.reloadT > 0 || w.clip >= def.mag || w.ammo <= 0) return;
    this.reloadT = def.reload;
    this.game.audio.reload();
  }

  // ------------------------------------------------------------------ update
  update(dt, input) {
    const g = this.game;
    this.enterCd -= dt;
    if (this.dead) {
      this.deadTime += dt;
      if (!this.vehicle) this.locomote(dt, 0, 0);
      this.aiming = false; this.animState.aim = 0;
      this.updateAnim(dt);
      return;
    }
    if (this.vehicle) this.updateVehicle(dt, input);
    else this.updateFoot(dt, input);
    // weapon switching
    if (input.mouse.wheel) this.cycle(input.mouse.wheel > 0 ? 1 : -1);
    if (input.hit('KeyQ')) this.cycle(-1);
    for (let k = 1; k <= 6; k++) if (input.hit('Digit' + k)) { const id = WEAPON_ORDER[k - 1]; if (this.owned().includes(id)) this.switchTo(id); }
    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; this.refill(this.weaponId); }
    }
    if (input.hit('KeyR')) this.startReload();
    this.updateAnim(dt);
  }

  updateFoot(dt, input) {
    const g = this.game, rig = g.cameraRig;
    const cy = rig.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy), rx = -Math.cos(cy), rz = Math.sin(cy);
    const mx = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const mz = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    let dx = fx * mz + rx * mx, dz = fz * mz + rz * mx;
    const l = Math.hypot(dx, dz); if (l > 0) { dx /= l; dz /= l; }
    const def = this.weaponDef;
    this.aiming = input.mouse.right && !this.swimming && this.knockT <= 0;
    if (input.hit('CapsLock') || input.hit('KeyC')) this.walkMode = !this.walkMode;
    this.sprinting = input.down('ShiftLeft') && !this.aiming && l > 0 && !this.swimming;
    let speed = this.aiming ? 2.7 : this.sprinting ? 7.8 : this.walkMode ? 1.7 : 4.6;
    if (this.swimming) speed = 2.3;
    if (this.knockT > 0) speed = 0;
    this.locomote(dt, dx * speed, dz * speed, this.onGround ? 11 : 2);
    if (input.hit('Space') && this.onGround && !this.swimming && this.knockT <= 0) { this.vel.y = 6.4; this.onGround = false; }
    // facing
    this.shootFaceT -= dt;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.aiming || this.shootFaceT > 0) this.yaw = dampAngle(this.yaw, cy, 20, dt);
    else if (hs > 0.4 && l > 0) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 11, dt);
    this.animState.speed = hs;
    this.animState.back = (this.aiming || this.shootFaceT > 0) && hs > 0.3 && Math.abs(wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.yaw)) > 2.0;
    this.aim = damp(this.aim, (this.aiming || this.shootFaceT > 0) && !def.melee ? 1 : 0, 14, dt);
    this.aimPitch = clamp(-rig.pitch + 0.12, -1, 1);
    this.animState.aim = this.aim; this.animState.aimPitch = this.aimPitch;

    // attacks
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 3);
    if (this.meleeT > 0) { this.meleeT -= dt; if (this.meleeT <= 0) g.weapons.melee(this, def); }
    const w = this.inv[this.weaponId];
    const want = def.auto ? input.mouse.left : input.mouse.leftPressed;
    if (want && this.fireCd <= 0 && this.reloadT <= 0 && !this.swimming && this.knockT <= 0 && g.inputEnabledForFire) {
      if (def.melee) { this.punchT = 0.35; this.fireCd = def.rate; this.meleeT = 0.14; this.shootFaceT = 0.4; }
      else if (def.thrown) {
        if (w.clip > 0) {
          w.clip--; if (w.clip === 0) this.refill('grenade');
          this.fireCd = def.rate; this.punchT = 0.35; this.shootFaceT = 0.5;
          // ballistic throw that lands on the crosshair point (clamped range)
          const f = rig.forward(_a);
          const o = _b.set(this.pos.x, this.pos.y + 1.7, this.pos.z).addScaledVector(f, 0.6).clone();
          const tgt = this.aimPoint();
          let hx = tgt.x - o.x, hz = tgt.z - o.z; const D = clamp(Math.hypot(hx, hz), 3, 40);
          hx /= D || 1; hz /= D || 1;
          const th = 0.62, G = 20, dy = clamp(tgt.y - o.y, -10, 10);
          const denom = 2 * Math.cos(th) ** 2 * (D * Math.tan(th) - dy);
          const sp = clamp(denom > 0 ? Math.sqrt(G * D * D / denom) : 22, 5, 24);
          const dir = new THREE.Vector3(hx * Math.cos(th), Math.sin(th), hz * Math.cos(th));
          g.weapons.throwGrenade(this, o, dir, sp, 0);
          if (w.clip === 0 && w.ammo === 0) this.cycle(-1);
        }
      } else if (w.clip > 0) {
        this.fireCd = def.rate;
        w.clip--;
        this.shootFaceT = 0.6;
        const moving = hs > 0.5 ? 1.4 : 1;
        const spreadMul = (this.aiming ? 1 : 2) * (1 + this.bloom) * moving;
        const muzzle = this.muzzlePos(_c);
        const target = this.aimPoint();
        const dir = _b.subVectors(target, muzzle).normalize();
        g.weapons.fire(this, def, muzzle.clone(), dir.clone(), { spreadMul });
        rig.addRecoil(def.recoil * (this.aiming ? 0.7 : 1));
        this.bloom = Math.min(this.bloom + def.recoil * (def.auto ? 3 : 6), 1.4);
        if (w.clip === 0) this.startReload();
      } else {
        g.audio.empty(); this.fireCd = 0.3;
        if (w.ammo > 0) this.startReload();
        else if (this.owned().length > 1) this.cycle(-1);
      }
    }
    // enter vehicle
    if ((input.hit('KeyF') || input.hit('Enter')) && this.enterCd <= 0) this.tryEnter();
  }

  // Point in the world under the crosshair.
  aimPoint() {
    const g = this.game, cam = g.cameraRig.camera;
    const f = g.cameraRig.forward(_a).clone();
    const o = cam.position.clone();
    const t0 = Math.max(0, _b.set(this.pos.x, this.pos.y + 1.4, this.pos.z).sub(o).dot(f));
    o.addScaledVector(f, t0 + 0.3);
    const hit = g.weapons.raycast(o, f, 250, this, this.vehicle || null);
    return hit ? hit.point : o.addScaledVector(f, 250);
  }

  tryEnter() {
    const g = this.game;
    const v = g.vehicles.nearestEnterable(this.pos, 2.6);
    if (!v) return false;
    if (v.npcDriver) {
      const shirt = '#' + v.bustColor.getHexString();
      v.setNpcDriver(false);
      const w = v.toWorld(v.def.W / 2 + 1.1, 0, 0.2);
      const cop = !!v.def.police;
      const n = g.peds.spawn(cop ? 'police' : 'civ', w.x, w.z, cop ? { weapon: 'pistol' } : {});
      if (!cop) { n.appearance.shirt = shirt; n.setAppearance(n.appearance); n.knock(2); n.vel.set(Math.cos(v.heading) * 3, 2, -Math.sin(v.heading) * 3); n.scare(this.pos); }
      g.police.report(cop ? 'steal_cop' : 'carjack', this.pos);
      g.hud.notify(cop ? 'You jacked a police cruiser!' : 'Carjacked!', 2);
    }
    this.enterVehicle(v);
    return true;
  }
  enterVehicle(v) {
    const g = this.game;
    v.ai = null; v.driver = this; v.npcDriver = false; v.bust.visible = false;
    if (v.police) v.siren = false;
    this.vehicle = v; this.lastVehicle = v;
    this.vel.set(0, 0, 0); this.aiming = false; this.aim = 0; this.swimming = false; this.knockT = 0;
    v.body.add(this.mesh);
    this.mesh.position.set(v.seat.x, v.seat.y, v.seat.z);
    this.mesh.rotation.set(0, 0, 0);
    this.enterCd = 0.5;
    g.hud.vehicleName(v.def.name);
    g.events.emit('enterVehicle', { vehicle: v });
  }
  exitVehicle(force) {
    const g = this.game, v = this.vehicle;
    if (!v) return;
    const tries = [[v.def.W / 2 + 0.8, 0.2], [-(v.def.W / 2 + 0.8), 0.2], [0, v.def.L / 2 + 1.2], [0, -(v.def.L / 2 + 1.2)]];
    let best = null;
    for (const [lx, lz] of tries) {
      const p = v.toWorld(lx, 0, lz);
      const before = p.clone();
      g.physics.resolveCircle(p, 0.35, v.y + 0.2, v.y + 1.7);
      if (p.distanceTo(before) < 0.15) { best = p; break; }
    }
    if (!best) best = v.toWorld(0, 2.2, 0);
    g.scene.add(this.mesh);
    this.vehicle = null;
    v.driver = null;
    v.input.throttle = 0; v.input.brake = 0; v.input.steer = 0; v.input.handbrake = v.speed < 6;
    this.pos.set(best.x, Math.max(g.physics.groundHeight(best.x, best.z, v.y + 2.5), best.y), best.z);
    this.yaw = v.heading;
    this.vel.set(v.vel.x * 0.6, 0, v.vel.z * 0.6);
    if (v.speed > 9 && !force) { this.knock(v.speed); this.takeDamage(v.speed * 1.2, { kind: 'fall' }); }
    this.enterCd = 0.5;
    this.mesh.visible = true;
    g.events.emit('exitVehicle', { vehicle: v });
  }

  updateVehicle(dt, input) {
    const g = this.game, v = this.vehicle;
    const inp = v.input;
    inp.throttle = input.down('KeyW') ? 1 : 0;
    inp.brake = input.down('KeyS') ? 1 : 0;
    inp.steer = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    inp.handbrake = input.down('Space');
    if (input.hit('KeyH')) g.audio.horn(v.pos);
    if (input.hit('KeyN')) g.hud.notify(g.audio.nextStation(), 2.5);
    if (input.hit('KeyG') && v.def.police) { v.siren = !v.siren; }
    this.pos.set(v.pos.x, v.y, v.pos.z);
    this.yaw = v.heading;
    this.animState.speed = 0; this.animState.steer = v.steer * 2;
    // drive-by: aim with right mouse, fire with left (pistol / smg)
    const def = this.weaponDef;
    this.aiming = false;
    this.fireCd -= dt;
    if (input.mouse.right && (def.id === 'pistol' || def.id === 'smg')) {
      this.aiming = true;
      const want = def.auto ? input.mouse.left : input.mouse.leftPressed;
      const w = this.inv[this.weaponId];
      if (want && this.fireCd <= 0 && this.reloadT <= 0 && w.clip > 0 && g.inputEnabledForFire) {
        this.fireCd = def.rate; w.clip--;
        const target = this.aimPoint();
        const f = g.cameraRig.forward(_a);
        const side = (f.x * Math.cos(v.heading) - f.z * Math.sin(v.heading)) >= 0 ? 1 : -1;
        const muzzle = v.toWorld(side * (v.def.W / 2 + 0.25), v.def.p.belt + 0.2, 0.1);
        const dir = _b.subVectors(target, muzzle).normalize();
        g.weapons.fire(this, def, muzzle, dir.clone(), { spreadMul: 1.8 });
        g.cameraRig.addRecoil(def.recoil * 0.5);
        if (w.clip === 0) this.startReload();
      }
    }
    if (v.sinking > 0.6) { this.exitVehicle(true); return; }
    if ((input.hit('KeyF') || input.hit('Enter')) && this.enterCd <= 0) this.exitVehicle();
  }

  onDamaged(a, info) {
    const g = this.game;
    g.hud.damageFlash(a);
    if (a > 1) g.audio.hurt();
    if (info.attacker && info.attacker !== this) {
      const src = info.attacker.pos || info.point;
      if (src) g.hud.damageDir(src);
    }
  }
  onDeath(info) {
    this.game.events.emit('playerDeath', { info });
  }
  respawn(x, z, heading = 0) {
    if (this.vehicle) this.exitVehicle(true);
    this.dead = false; this.deadTime = 0; this.health = this.maxHealth; this.knockT = 0;
    this.pos.set(x, this.game.physics.groundHeight(x, z, 50), z); this.vel.set(0, 0, 0);
    this.yaw = heading; this.anim.deadT = 0;
    this.game.scene.add(this.mesh);
    this.mesh.visible = true;
    this.game.cameraRig.yaw = heading;
  }
}
export { rand };
