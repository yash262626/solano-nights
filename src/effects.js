// Pooled visual effects: particles (fire, smoke, sparks, blood, debris, water), tracers,
// muzzle flashes, dynamic light flashes and decals.
import * as THREE from 'three';
import * as TX from './textures.js';
import { rand } from './utils.js';

class ParticlePool {
  constructor(scene, max, texture, blending) {
    this.max = max; this.next = 0;
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.cr = new Float32Array(max); this.cg = new Float32Array(max); this.cb = new Float32Array(max);
    this.cr1 = new Float32Array(max); this.cg1 = new Float32Array(max); this.cb1 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: texture }, scale: { value: 600 }, uLight: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending,
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; uniform float uLight; varying vec4 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb * t.rgb * uLight, vColor.a * t.a); if (gl_FragColor.a < 0.004) discard; }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = 0;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, r1 = r, g1 = g, b1 = b, drag = 0, grav = 0) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.cr1[i] = r1; this.cg1[i] = g1; this.cb1[i] = b1;
    this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    const P = this.pos, C = this.col, S = this.size;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { S[i] = 0; C[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr + this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.grav[i] < 0 && this.py[i] < 0.05) { this.py[i] = 0.05; this.vy[i] *= -0.3; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
      P[i * 3] = this.px[i]; P[i * 3 + 1] = this.py[i]; P[i * 3 + 2] = this.pz[i];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      C[i * 4] = this.cr[i] + (this.cr1[i] - this.cr[i]) * t;
      C[i * 4 + 1] = this.cg[i] + (this.cg1[i] - this.cg[i]) * t;
      C[i * 4 + 2] = this.cb[i] + (this.cb1[i] - this.cb[i]) * t;
      C[i * 4 + 3] = this.a0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}

class DecalPool {
  constructor(scene, tex, max, size) {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    this.max = max; this.next = 0;
    this.d = new THREE.Object3D();
    scene.add(this.mesh);
  }
  add(pos, normal, scale = 1) {
    const d = this.d;
    d.position.copy(pos).addScaledVector(normal, 0.02);
    d.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z);
    d.rotateZ(Math.random() * 6.28);
    d.scale.setScalar(scale);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.next, d.matrix);
    this.next = (this.next + 1) % this.max;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.add = new ParticlePool(scene, 1400, TX.makeSoftDot(), THREE.AdditiveBlending);
    this.alpha = new ParticlePool(scene, 1600, TX.makeSmokePuff(), THREE.NormalBlending);
    this.add.points.renderOrder = 5; this.alpha.points.renderOrder = 4;
    // tracers: one LineSegments buffer
    this.maxTracers = 48;
    this.trPos = new Float32Array(this.maxTracers * 6);
    this.trLife = new Float32Array(this.maxTracers);
    this.trCol = new Float32Array(this.maxTracers * 6);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.trNext = 0;
    // muzzle flash sprites
    const flashTex = TX.makeFlashStar();
    this.flashes = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.renderOrder = 6; scene.add(s);
      this.flashes.push({ s, life: 0 });
    }
    this.flashNext = 0;
    // dynamic point lights (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 12, 2);
      scene.add(l);
      this.lights.push({ l, life: 0, max: 1, peak: 0 });
    }
    this.lightNext = 0;
    this.holes = new DecalPool(scene, TX.makeDecal('hole'), 160, 0.22);
    this.blood = new DecalPool(scene, TX.makeDecal('blood'), 60, 1.4);
    this.scorch = new DecalPool(scene, TX.makeDecal('scorch'), 30, 7);
    this.tmpV = new THREE.Vector3();
  }

  lightFlash(pos, color, intensity, dist, dur) {
    const L = this.lights[this.lightNext]; this.lightNext = (this.lightNext + 1) % this.lights.length;
    L.l.position.copy(pos); L.l.color.set(color); L.l.distance = dist;
    L.peak = intensity; L.life = dur; L.max = dur; L.l.intensity = intensity;
  }
  muzzleFlash(pos, dir, big = 1) {
    const f = this.flashes[this.flashNext]; this.flashNext = (this.flashNext + 1) % this.flashes.length;
    f.s.position.copy(pos); f.s.scale.setScalar(0.55 * big + Math.random() * 0.2);
    f.s.material.rotation = Math.random() * 6.28;
    f.s.visible = true; f.life = 0.05;
    this.lightFlash(pos, 0xffc070, 30 * big, 9, 0.06);
    for (let i = 0; i < 3; i++) this.alpha.emit(pos.x, pos.y, pos.z, dir.x * 2 + rand(-0.5, 0.5), dir.y * 2 + rand(0, 0.6), dir.z * 2 + rand(-0.5, 0.5), 0.6, 0.15, 0.6, 0.6, 0.6, 0.6, 0.25, 0.6, 0.6, 0.6, 2);
  }
  tracer(from, to, color = [1, 0.85, 0.5]) {
    const i = this.trNext; this.trNext = (this.trNext + 1) % this.maxTracers;
    // draw a short streak towards the target
    const d = this.tmpV.copy(to).sub(from);
    const len = d.length();
    const start = Math.min(len * 0.1, 1.2);
    const segLen = Math.min(len - start, 8);
    d.normalize();
    this.trPos.set([from.x + d.x * start, from.y + d.y * start, from.z + d.z * start, from.x + d.x * (start + segLen), from.y + d.y * (start + segLen), from.z + d.z * (start + segLen)], i * 6);
    this.trCol.set([color[0] * 0.3, color[1] * 0.3, color[2] * 0.3, color[0] * 2, color[1] * 2, color[2] * 2], i * 6);
    this.trLife[i] = 0.06;
  }
  impact(pos, normal, kind) {
    const n = normal;
    if (kind === 'blood') {
      for (let i = 0; i < 10; i++) this.alpha.emit(pos.x, pos.y, pos.z, n.x * 2 + rand(-1.5, 1.5), n.y * 2 + rand(0, 2), n.z * 2 + rand(-1.5, 1.5), rand(0.3, 0.6), 0.1, 0.25, 0.45, 0.02, 0.02, 0.9, 0.3, 0.01, 0.01, 1, -12);
      for (let i = 0; i < 4; i++) this.alpha.emit(pos.x, pos.y, pos.z, rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4), 0.6, 0.2, 0.6, 0.5, 0.05, 0.05, 0.35, 0.3, 0.02, 0.02, 2);
      return;
    }
    if (kind === 'water') {
      for (let i = 0; i < 14; i++) this.alpha.emit(pos.x, pos.y, pos.z, rand(-1, 1), rand(2, 5), rand(-1, 1), rand(0.5, 0.9), 0.15, 0.35, 0.85, 0.9, 1, 0.6, 0.85, 0.9, 1, 0.5, -14);
      return;
    }
    if (kind === 'metal' || kind === 'spark') {
      for (let i = 0; i < 8; i++) this.add.emit(pos.x, pos.y, pos.z, n.x * 4 + rand(-3, 3), n.y * 4 + rand(-1, 4), n.z * 4 + rand(-3, 3), rand(0.15, 0.4), 0.09, 0.02, 1, 0.8, 0.4, 1, 1, 0.3, 0.05, 1, -15);
      this.lightFlash(pos, 0xffcc88, 6, 4, 0.05);
    }
    for (let i = 0; i < 6; i++) this.alpha.emit(pos.x, pos.y, pos.z, n.x * 1.5 + rand(-0.6, 0.6), n.y * 1.5 + rand(0, 1), n.z * 1.5 + rand(-0.6, 0.6), rand(0.4, 0.9), 0.15, 0.7, 0.62, 0.58, 0.52, 0.45, 0.5, 0.48, 0.45, 2.5, -1);
    for (let i = 0; i < 4; i++) this.add.emit(pos.x, pos.y, pos.z, n.x * 3 + rand(-2, 2), n.y * 3 + rand(0, 3), n.z * 3 + rand(-2, 2), 0.15, 0.06, 0.02, 1, 0.75, 0.4, 1, 1, 0.3, 0.1, 1, -12);
    if (kind === 'wall') this.holes.add(pos, n, 1);
  }
  explosion(pos, scale = 1) {
    const p = pos;
    this.lightFlash(new THREE.Vector3(p.x, p.y + 2.5, p.z), 0xff8a30, 80 * scale, 30 * scale, 0.7);
    for (let i = 0; i < 26 * scale; i++) {
      const a = Math.random() * 6.28, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), sp = rand(2.5, 8) * scale;
      this.add.emit(p.x, p.y + 0.6, p.z, Math.cos(a) * s * sp, Math.abs(u) * sp + 2.5, Math.sin(a) * s * sp, rand(0.4, 0.9), rand(1.0, 1.8) * scale, rand(2.2, 3.5) * scale, 0.9, 0.38, 0.08, 0.55, 0.3, 0.06, 0.02, 3.5, 2);
    }
    for (let i = 0; i < 30 * scale; i++) {
      const a = Math.random() * 6.28, sp = rand(1, 6) * scale;
      this.alpha.emit(p.x + rand(-1, 1), p.y + rand(0.5, 2), p.z + rand(-1, 1), Math.cos(a) * sp, rand(2, 7), Math.sin(a) * sp, rand(2.5, 5), rand(2, 3) * scale, rand(6, 10) * scale, 0.18, 0.16, 0.15, 0.75, 0.3, 0.29, 0.28, 1.2, 0.6);
    }
    for (let i = 0; i < 30 * scale; i++) {
      const a = Math.random() * 6.28, sp = rand(6, 20);
      this.add.emit(p.x, p.y + 0.5, p.z, Math.cos(a) * sp, rand(4, 14), Math.sin(a) * sp, rand(0.6, 1.4), 0.2, 0.05, 1, 0.7, 0.3, 1, 1, 0.3, 0.05, 0.5, -18);
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * 6.28, sp = rand(4, 12);
      this.alpha.emit(p.x, p.y + 0.5, p.z, Math.cos(a) * sp, rand(5, 12), Math.sin(a) * sp, rand(1, 2), 0.25, 0.2, 0.06, 0.06, 0.06, 1, 0.05, 0.05, 0.05, 0.3, -20);
    }
    const ground = new THREE.Vector3(p.x, 0.2, p.z);
    this.scorch.add(ground, new THREE.Vector3(0, 1, 0), scale);
  }
  smoke(pos, amount = 1, dark = 0.3) {
    this.alpha.emit(pos.x + rand(-0.3, 0.3), pos.y, pos.z + rand(-0.3, 0.3), rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4), rand(1.5, 3), 0.5 * amount, 3 * amount, dark, dark, dark, 0.45, dark * 1.4, dark * 1.4, dark * 1.4, 0.4, 0.4);
  }
  fire(pos, amount = 1) {
    this.add.emit(pos.x + rand(-0.4, 0.4), pos.y, pos.z + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(2, 4), rand(-0.3, 0.3), rand(0.3, 0.7), 0.8 * amount, 0.2, 2.5, 1.2, 0.3, 0.9, 1, 0.2, 0.02, 1, 1);
  }
  splash(pos, size = 1) {
    for (let i = 0; i < 20 * size; i++) this.alpha.emit(pos.x + rand(-1, 1) * size, pos.y, pos.z + rand(-1, 1) * size, rand(-2, 2), rand(3, 7) * size, rand(-2, 2), rand(0.6, 1.2), 0.3, 0.9, 0.85, 0.92, 1, 0.7, 0.85, 0.92, 1, 0.5, -14);
  }
  fountainSpray(x, y, z, r) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * 6.28;
      this.alpha.emit(x, y, z, Math.cos(a) * r * 0.45, rand(4.5, 6), Math.sin(a) * r * 0.45, rand(1.2, 1.5), 0.12, 0.35, 0.85, 0.92, 1, 0.45, 0.85, 0.92, 1, 0.2, -9.8);
    }
  }
  bloodPool(pos) { this.blood.add(new THREE.Vector3(pos.x, pos.y + 0.03, pos.z), new THREE.Vector3(0, 1, 0), 1 + Math.random() * 0.5); }

  update(dt, camera, renderer) {
    const h = renderer.getSize(new THREE.Vector2()).y * renderer.getPixelRatio();
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.uniforms.scale.value = scale; this.alpha.uniforms.scale.value = scale;
    const night = this.game.env ? this.game.env.night : 0;
    this.alpha.uniforms.uLight.value = 0.3 + (1 - night) * 0.7;
    this.add.update(dt); this.alpha.update(dt);
    for (let i = 0; i < this.maxTracers; i++) {
      if (this.trLife[i] > 0) {
        this.trLife[i] -= dt;
        if (this.trLife[i] <= 0) this.trPos.fill(0, i * 6, i * 6 + 6);
      }
    }
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
    for (const f of this.flashes) if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.s.visible = false; }
    for (const L of this.lights) {
      if (L.life > 0) { L.life -= dt; L.l.intensity = L.peak * Math.max(0, L.life / L.max); if (L.life <= 0) L.l.intensity = 0; }
    }
  }
}
