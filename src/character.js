// Shared base for the player and NPCs: skinned body, locomotion, collisions, damage, weapons.
import * as THREE from 'three';
import { createHumanoid, Animator, applyAppearance } from './humanoid.js';
import { weaponModel, WEAPONS } from './weapons.js';
import { WORLD } from './config.js';
import { damp, rand, clamp } from './utils.js';

const _m = new THREE.Vector3();
export class Character {
  constructor(game, appearance) {
    this.game = game;
    const h = createHumanoid(appearance);
    this.mesh = h.mesh; this.bones = h.bones; this.geo = h.geo; this.appearance = appearance;
    this.anim = new Animator(this.bones);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0;
    this.radius = 0.33;
    this.height = 1.8 * (appearance.build || 1);
    this.health = 100; this.maxHealth = 100; this.armor = 0;
    this.dead = false; this.deadTime = 0; this.deadSide = 0;
    this.onGround = true; this.vehicle = null; this.swimming = false;
    this.weaponId = 'fist'; this.weaponMesh = null;
    this.aim = 0; this.aimPitch = 0; this.punchT = 0; this.knockT = 0;
    this.moveSpeed = 0; this.invulnerable = false;
    this.animState = { speed: 0, grounded: true, aim: 0, aimPitch: 0, twoHanded: false, drive: false, dead: false, swim: false, punch: 0, cower: false, handsUp: false, steer: 0 };
    this.col = { hit: false, nx: 0, nz: 0, depth: 0 };
    game.scene.add(this.mesh);
  }
  setAppearance(a) {
    this.appearance = a; applyAppearance(this.geo, a);
    this.mesh.scale.setScalar(a.build || 1); this.height = 1.8 * (a.build || 1);
  }
  setWeapon(id) {
    if (this.weaponMesh) { this.weaponMesh.parent && this.weaponMesh.parent.remove(this.weaponMesh); this.weaponMesh = null; }
    this.weaponId = id;
    const m = weaponModel(id);
    if (m) {
      m.position.set(0, -0.29, 0.03); m.rotation.x = Math.PI / 2;
      this.bones.rElbow.add(m); this.weaponMesh = m;
    }
  }
  get weaponDef() { return WEAPONS[this.weaponId]; }
  muzzlePos(out = new THREE.Vector3()) {
    if (!this.weaponMesh) return out.set(this.pos.x, this.pos.y + 1.45, this.pos.z);
    this.mesh.updateMatrixWorld(true);
    return out.set(0, 0.06, this.weaponMesh.userData.muzzle).applyMatrix4(this.weaponMesh.matrixWorld);
  }
  eyePos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height * 0.92, this.pos.z); }
  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height * 0.72, this.pos.z); }
  hitHeight() { return this.animState.cower ? 1.1 : (this.dead || this.knockT > 0 ? 0.5 : this.height); }

  takeDamage(amount, info = {}) {
    if (this.dead || this.invulnerable) return;
    let a = amount;
    if (this.armor > 0 && info.kind !== 'fall' && info.kind !== 'drown') {
      const ab = Math.min(this.armor, a * 0.75);
      this.armor -= ab; a -= ab;
    }
    this.health -= a;
    this.onDamaged(a, info);
    if (this.health <= 0) { this.health = 0; this.die(info); }
  }
  die(info = {}) {
    if (this.dead) return;
    this.dead = true; this.deadTime = 0; this.deadSide = rand(-1, 1);
    if (info.dir) this.vel.addScaledVector(info.dir, info.kind === 'bullet' ? 1.5 : 0);
    if (info.kind !== 'drown') setTimeout(() => { if (this.dead && !this.swimming) this.game.effects.bloodPool(this.pos); }, 700);
    this.onDeath(info);
  }
  knock(speed) { this.knockT = Math.max(this.knockT, 1.2 + speed * 0.05); this.onGround = false; }
  onDamaged() {}
  onDeath() {}

  // Physics-based locomotion shared by all characters.
  locomote(dt, wantX, wantZ, accel = 12) {
    const g = this.game;
    const k = this.onGround && this.knockT <= 0 ? accel : (this.knockT > 0 ? 0.6 : accel * 0.3);
    if (this.dead) { this.vel.x = damp(this.vel.x, 0, this.onGround ? 6 : 0.5, dt); this.vel.z = damp(this.vel.z, 0, this.onGround ? 6 : 0.5, dt); }
    else { this.vel.x = damp(this.vel.x, wantX, k, dt); this.vel.z = damp(this.vel.z, wantZ, k, dt); }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const res = g.physics.resolveCircle(this.pos, this.radius, this.pos.y + 0.3, this.pos.y + 1.7, this.col);
    if (res.hit) {
      const vn = this.vel.x * res.nx + this.vel.z * res.nz;
      if (vn < 0) { this.vel.x -= vn * res.nx; this.vel.z -= vn * res.nz; }
    }
    const gh = g.physics.groundHeight(this.pos.x, this.pos.z, this.pos.y, this.swimming ? 2.6 : 0.5, 0.15);
    const W = WORLD.WATER_Y;
    if (gh < W - 1.2 && this.pos.y <= W - 1.1) {
      // swimming
      if (!this.swimming) { this.swimming = true; g.effects.splash(new THREE.Vector3(this.pos.x, W, this.pos.z), 1); g.audio.splash(this.pos); }
      this.vel.y = 0;
      this.pos.y = damp(this.pos.y, W - 1.25, 6, dt);
      this.onGround = true;
    } else {
      if (this.swimming && gh > this.pos.y) { this.pos.y = gh; this.vel.y = 0; }
      this.swimming = false;
      this.vel.y -= 21 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= gh) {
        if (this.vel.y < -14 && !this.dead) this.takeDamage((-this.vel.y - 14) * 9, { kind: 'fall' });
        this.pos.y = gh; this.vel.y = 0; this.onGround = true;
      } else this.onGround = this.pos.y - gh < 0.05;
    }
    if (this.knockT > 0) { this.knockT -= dt; }
  }

  updateAnim(dt) {
    const s = this.animState;
    s.dead = this.dead || this.knockT > 0.2;
    s.deadSide = this.deadSide;
    s.swim = this.swimming && !this.dead;
    s.grounded = this.onGround;
    s.drive = !!this.vehicle;
    s.twoHanded = !!(this.weaponDef && this.weaponDef.twoHanded);
    s.punch = this.punchT > 0 ? 1 - this.punchT / 0.35 : 0;
    if (this.punchT > 0) this.punchT -= dt;
    this.anim.update(dt, s);
    if (!this.vehicle) {
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.set(0, this.yaw, 0);
    }
    if (this.weaponMesh) this.weaponMesh.visible = !this.vehicle && !this.swimming && !(this.dead && this.deadTime > 0.5) && this.weaponId !== 'fist';
  }
}
export { _m, clamp };
