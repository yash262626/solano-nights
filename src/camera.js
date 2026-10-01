// Third-person camera: orbit, over-the-shoulder aiming, vehicle chase cam, collision, shake & recoil.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from './utils.js';

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 3200);
    this.yaw = 0; this.pitch = 0.22; this.dist = 4.4; this.aimBlend = 0;
    this.trauma = 0; this.recoil = 0; this.lastMouse = 0; this.time = 0;
    this.pivot = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.frust = new THREE.Frustum(); this.pm = new THREE.Matrix4();
    this.sens = 0.0023;
    this.out = {};
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  addRecoil(r) { this.recoil += r; }
  frustum() { return this.frust; }
  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  update(dt, input) {
    this.time += dt;
    const g = this.game, p = g.player, cam = this.camera;
    const aiming = !p.vehicle && !p.dead && p.aiming;
    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 12, dt);
    // look input
    const sens = this.sens * (aiming ? 0.6 : 1);
    if (input.mouse.dx || input.mouse.dy) this.lastMouse = this.time;
    this.yaw -= input.mouse.dx * sens;
    this.pitch += input.mouse.dy * sens;
    const kx = (input.down('ArrowLeft') ? 1 : 0) - (input.down('ArrowRight') ? 1 : 0);
    const ky = (input.down('ArrowDown') ? 1 : 0) - (input.down('ArrowUp') ? 1 : 0);
    if (kx || ky) { this.yaw += kx * dt * 2.2; this.pitch += ky * dt * 1.5; this.lastMouse = this.time; }
    // recoil kicks the view upward
    if (this.recoil > 0) { const r = Math.min(this.recoil, dt * 0.6 + this.recoil * dt * 12); this.pitch -= r; this.recoil -= r; }
    this.pitch = clamp(this.pitch, -0.75, 1.35);

    let fov = 66, dist, pivot = this.pivot;
    if (p.vehicle) {
      const v = p.vehicle, sp = v.speed;
      pivot.set(v.pos.x, v.y + 1.5 + v.def.p.roof * 0.35, v.pos.z);
      dist = 5 + v.def.L * 0.45 + Math.min(sp * 0.035, 2);
      if (this.time - this.lastMouse > 1.1 && sp > 2) {
        const vf = v.forwardSpeed();
        const tgt = vf >= -1 ? v.heading : v.heading + Math.PI;
        this.yaw = dampAngle(this.yaw, tgt, 2.6, dt);
        this.pitch = damp(this.pitch, 0.2, 1.5, dt);
      }
      fov = 66 + Math.min(sp * 0.35, 20);
    } else {
      const a = this.aimBlend;
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      const off = lerp(0.3, 0.55, a);
      const baseY = p.swimming ? p.pos.y + 1.3 : p.pos.y + lerp(1.55, 1.6, a) - (p.animState.cower ? 0.5 : 0);
      pivot.set(p.pos.x + rx * off, baseY, p.pos.z + rz * off);
      dist = lerp(4.3, 1.85, a);
      fov = lerp(66, 50, a) + (p.sprinting ? 4 : 0);
      if (p.dead) { this.yaw += dt * 0.25; dist = 6; this.pitch = damp(this.pitch, 0.6, 1, dt); }
    }
    this.dist = damp(this.dist, dist, 6, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let dx = -Math.sin(this.yaw) * cp, dy = sp, dz = -Math.cos(this.yaw) * cp;
    // collision
    let d = this.dist;
    const hit = g.physics.raycast(pivot.x, pivot.y, pivot.z, dx, dy, dz, d + 0.3, this.out);
    if (hit) d = Math.max(0.4, hit.t - 0.3);
    this.pos.set(pivot.x + dx * d, pivot.y + dy * d, pivot.z + dz * d);
    const gh = g.physics.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.2) + 0.25;
    if (this.pos.y < gh) this.pos.y = gh;
    cam.position.copy(this.pos);
    cam.lookAt(pivot);
    // shake
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      cam.rotation.x += (Math.random() - 0.5) * 0.05 * s;
      cam.rotation.y += (Math.random() - 0.5) * 0.05 * s;
      cam.position.y += (Math.random() - 0.5) * 0.15 * s;
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 5, dt); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frust.setFromProjectionMatrix(this.pm);
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
}
