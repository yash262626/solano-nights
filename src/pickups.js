// World pickups: health, armor, cash, weapons and mission items. Spinning, glowing, respawning.
import * as THREE from 'three';
import { weaponModel, WEAPONS } from './weapons.js';

const COLORS = { health: 0xff3b4a, armor: 0x3b8bff, cash: 0x3bff7a, weapon: 0xffc83b, package: 0xff5fd0 };
// Glow ring/beam materials are shared per pickup colour (previously two new materials per pickup,
// which leaked on every cash drop).
const GLOW = new Map();
function glowMats(color) {
  let m = GLOW.get(color);
  if (!m) {
    m = {
      ring: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      beam: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
    GLOW.set(color, m);
  }
  return m;
}
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const red = new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 1.2, roughness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
  GEO = {
    ring: new THREE.RingGeometry(0.45, 0.6, 32).rotateX(-Math.PI / 2),
    beam: new THREE.CylinderGeometry(0.35, 0.35, 2.2, 16, 1, true).translate(0, 1.1, 0),
    red, white,
    box: new THREE.BoxGeometry(0.5, 0.5, 0.5),
    crossH: new THREE.BoxGeometry(0.46, 0.14, 0.16), crossV: new THREE.BoxGeometry(0.14, 0.46, 0.16),
    vest: new THREE.CylinderGeometry(0.22, 0.2, 0.45, 8).scale(1, 1, 0.6),
    vestMat: new THREE.MeshStandardMaterial({ color: 0x2a4a8a, emissive: 0x1a3aff, emissiveIntensity: 0.6, roughness: 0.5 }),
    cash: new THREE.BoxGeometry(0.34, 0.12, 0.18),
    cashMat: new THREE.MeshStandardMaterial({ color: 0x4cae5a, emissive: 0x1a8a3a, emissiveIntensity: 0.6, roughness: 0.6 }),
    pkg: new THREE.BoxGeometry(0.45, 0.35, 0.35),
    pkgMat: new THREE.MeshStandardMaterial({ color: 0xb58a55, emissive: 0x442200, emissiveIntensity: 0.3, roughness: 0.8 }),
  };
  return GEO;
}

export class Pickups {
  constructor(game) { this.game = game; this.list = []; this.t = 0; }
  add(type, x, y, z, opts = {}) {
    const G = geos();
    const group = new THREE.Group();
    const inner = new THREE.Group();
    if (type === 'health') inner.add(new THREE.Mesh(G.crossH, G.red), new THREE.Mesh(G.crossV, G.red));
    else if (type === 'armor') inner.add(new THREE.Mesh(G.vest, G.vestMat));
    else if (type === 'cash') { for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(G.cash, G.cashMat); m.position.y = k * 0.12 - 0.12; m.rotation.y = k * 0.3; inner.add(m); } }
    else if (type === 'weapon') { const m = weaponModel(opts.weapon); if (m) { m.scale.setScalar(2.2); m.rotation.y = Math.PI / 2; m.position.z = -0.3; inner.add(m); } }
    else if (type === 'package') inner.add(new THREE.Mesh(G.pkg, G.pkgMat));
    inner.position.y = 0.8;
    const glow = glowMats(COLORS[type] || 0xffffff);
    const ring = new THREE.Mesh(G.ring, glow.ring); ring.position.y = 0.05;
    const beam = new THREE.Mesh(G.beam, glow.beam);
    group.add(inner, ring, beam);
    group.position.set(x, y, z);
    this.game.scene.add(group);
    const p = { type, group, inner, pos: new THREE.Vector3(x, y, z), opts, active: true, respawnT: 0, ttl: opts.ttl || 0, age: 0 };
    this.list.push(p);
    return p;
  }
  // All geometry/materials are shared (weapon models share cached geometry too), so detaching is enough.
  remove(p) {
    const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1);
    this.game.scene.remove(p.group);
    p.group.clear();
  }
  collect(p) {
    const g = this.game, pl = g.player, o = p.opts;
    if (p.type === 'health') { if (pl.health >= pl.maxHealth) return false; pl.health = Math.min(pl.maxHealth, pl.health + (o.amount || 50)); g.hud.notify('+ Health', 1.5); }
    else if (p.type === 'armor') { if (pl.armor >= 100) return false; pl.armor = Math.min(100, pl.armor + (o.amount || 50)); g.hud.notify('+ Armor', 1.5); }
    else if (p.type === 'cash') { pl.addMoney(o.amount || 50); }
    else if (p.type === 'weapon') { pl.giveWeapon(o.weapon, o.amount || WEAPONS[o.weapon].mag * 2); g.hud.notify(`Picked up ${WEAPONS[o.weapon].name}`, 2); }
    else if (p.type === 'package') { if (o.onCollect) o.onCollect(); }
    if (p.type === 'cash') g.audio.cash(); else g.audio.pickup();
    return true;
  }
  update(dt) {
    this.t += dt;
    const pl = this.game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.ttl && p.age > p.ttl) { this.remove(p); continue; }
      if (!p.active) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) { p.active = true; p.group.visible = true; }
        continue;
      }
      p.inner.rotation.y += dt * 2;
      p.inner.position.y = 0.8 + Math.sin(this.t * 2.5 + i) * 0.1;
      if (pl.dead || pl.vehicle && p.type !== 'package' && p.type !== 'cash') continue;
      const d = Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z);
      const R = pl.vehicle ? 2.5 : 1.3;
      if (d < R && Math.abs(pl.pos.y - p.pos.y) < 2 && this.collect(p)) {
        if (p.opts.respawn) { p.active = false; p.respawnT = p.opts.respawn; p.group.visible = false; }
        else this.remove(p);
      }
    }
  }
}
