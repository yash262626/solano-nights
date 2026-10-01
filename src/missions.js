// Mission system: 3D markers, scripted async missions with objectives, timers, failure and rewards.
import * as THREE from 'three';
import * as TX from './textures.js';
import { blockRect, blockCenter, roadX, roadZ, CITY } from './config.js';
import { nearestNode, findPath, nodePos } from './vehicles.js';
import { rand, pick } from './utils.js';

class Abort extends Error {}

// ---------------------------------------------------------------- markers
// Marker resources are shared: three unit geometries (scaled per marker) and one material set per colour.
// Markers therefore never allocate GPU resources after the first use of a colour, and dispose() only
// has to detach the marker from the scene and the minimap.
let MARKER_RES = null;
const MARKER_MATS = new Map();
function markerRes() {
  if (MARKER_RES) return MARKER_RES;
  const beamTex = TX.makeBeam();
  beamTex.rotation = Math.PI;
  MARKER_RES = {
    beamTex,
    beam: new THREE.CylinderGeometry(0.9, 1, 6, 32, 1, true).translate(0, 3, 0),
    ring: new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
    arrow: new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI),
  };
  return MARKER_RES;
}
function markerMats(color) {
  const key = color.getHex();
  let m = MARKER_MATS.get(key);
  if (!m) {
    const R = markerRes();
    m = {
      beam: new THREE.MeshBasicMaterial({ map: R.beamTex, color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      ring: new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      arrow: new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.8) }),
    };
    MARKER_MATS.set(key, m);
  }
  return m;
}
export class Marker {
  constructor(game, target, opts = {}) {
    this.game = game; this.target = target; this.opts = opts;
    this.color = new THREE.Color(opts.color || 0xffd23f);
    this.radius = opts.radius || 2.2;
    const g = new THREE.Group();
    const R = markerRes(), M = markerMats(this.color);
    if (opts.type !== 'arrow') {
      const beam = new THREE.Mesh(R.beam, M.beam); beam.scale.set(this.radius, 1, this.radius);
      const ring = new THREE.Mesh(R.ring, M.ring); ring.scale.set(this.radius, 1, this.radius);
      ring.position.y = 0.08;
      g.add(beam, ring); this.ring = ring; this.beam = beam;
    }
    const arrow = new THREE.Mesh(R.arrow, M.arrow);
    arrow.position.y = opts.type === 'arrow' ? 3.2 : 4.2;
    g.add(arrow); this.arrow = arrow;
    this.group = g;
    game.scene.add(g);
    this.blip = { marker: this, color: '#' + this.color.getHexString(), label: opts.label || '', kind: opts.kind || 'dest' };
    game.blips.add(this.blip);
    this.t = Math.random() * 5;
  }
  get pos() {
    const t = this.target;
    if (t.pos) return t.pos;
    return t;
  }
  update(dt) {
    this.t += dt;
    const p = this.pos;
    const y = this.target.y !== undefined && this.target.def ? this.target.y + 0.4 : (this.target.pos ? this.target.pos.y : (p.y !== undefined ? p.y : this.game.physics.groundHeight(p.x, p.z, 50)));
    this.group.position.set(p.x, y, p.z);
    this.arrow.rotation.y += dt * 2;
    this.arrow.position.y = (this.opts.type === 'arrow' ? (this.target.def ? 2.6 : 2.7) : 4.2) + Math.sin(this.t * 3) * 0.18;
    if (this.ring) { const s = (1 + Math.sin(this.t * 4) * 0.05) * this.radius; this.ring.scale.set(s, 1, s); }
    this.group.visible = !(this.target.dead || this.target.destroyed);
  }
  // Geometry/materials are shared (see markerRes/markerMats), so detaching is all that is needed.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.game.scene.remove(this.group);
    this.group.clear();
    this.game.blips.delete(this.blip);
  }
}

// ---------------------------------------------------------------- mission context
class Ctx {
  constructor(mgr, def) {
    this.mgr = mgr; this.game = mgr.game; this.def = def;
    this.aborted = false; this.pending = []; this.fails = []; this.markers = []; this.npcs = []; this.vehicles = []; this.pickups = [];
    this.timer = null; this.time = 0;
  }
  check() { if (this.aborted) throw new Abort(); }
  wait(sec) { this.check(); return new Promise((res, rej) => this.pending.push({ at: this.time + sec, res, rej })); }
  until(cond) { this.check(); return new Promise((res, rej) => this.pending.push({ cond, res, rej })); }
  async say(speaker, text, dur) {
    this.game.hud.subtitle(speaker, text, dur);
    await this.wait(dur);
  }
  objective(html) { this.check(); this.game.hud.setObjective(html); }
  marker(target, opts = {}) { const m = new Marker(this.game, target, opts); this.markers.push(m); return m; }
  removeMarker(m) { if (!m) return; m.dispose(); this.markers = this.markers.filter((x) => x !== m); }
  failIf(cond, reason) { this.fails.push({ cond, reason }); }
  clearFails() { this.fails = []; }
  setTimer(sec, reason) { this.timer = { t: sec, reason }; }
  clearTimer() { this.timer = null; this.game.hud.setTimer(null); }
  enemy(x, z, weapon = 'pistol', opts = {}) {
    const n = this.game.peds.spawn('gang', x, z, { weapon, hostile: true, mission: this, marker: true, detectRange: opts.detectRange || 40, ...opts });
    this.npcs.push(n); return n;
  }
  vehicle(type, x, z, heading, opts = {}) {
    const v = this.game.vehicles.spawn(type, x, z, heading, opts);
    v.persistent = true; v.missionTag = this.def.id;
    this.vehicles.push(v); return v;
  }
  pickup(type, x, z, opts = {}) { const p = this.game.pickups.add(type, x, this.game.physics.groundHeight(x, z, 50), z, opts); this.pickups.push(p); return p; }
  giveWeapon(id, ammo) { this.game.player.giveWeapon(id, ammo); this.game.hud.notify(`Received: ${this.game.weaponsDef[id].name}`, 3); }
  update(dt) {
    this.time += dt;
    for (const f of this.fails) if (f.cond()) { this.mgr.fail(f.reason); return; }
    if (this.timer) {
      this.timer.t -= dt;
      this.game.hud.setTimer(Math.max(0, this.timer.t));
      if (this.timer.t <= 0) { this.mgr.fail(this.timer.reason); return; }
    }
    for (const m of this.markers) m.update(dt);
    const ready = [];
    this.pending = this.pending.filter((p) => {
      const ok = p.cond ? p.cond() : this.time >= p.at;
      if (ok) ready.push(p);
      return !ok;
    });
    for (const p of ready) p.res();
  }
  abort() {
    this.aborted = true;
    for (const p of this.pending) p.rej(new Abort());
    this.pending = [];
  }
  cleanup(keepVehicles) {
    for (const m of this.markers) m.dispose();
    this.markers = [];
    for (const n of this.npcs) { n.setMarker(false); n.mission = null; if (!n.dead) { n.hostile = false; } }
    for (const v of this.vehicles) { v.persistent = false; v.missionTag = null; if (!keepVehicles && v !== this.game.player.vehicle && v.ai && v.ai.mode === 'route') v.ai.mode = 'cruise'; }
    for (const p of this.pickups) this.game.pickups.remove(p);
    this.clearTimer();
    this.game.hud.setObjective(null);
  }
}

// ---------------------------------------------------------------- mission scripts
const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;

function missionDefs(game) {
  const W = game.world, L = W.locations, P = () => game.player;
  return [
    {
      id: 'm1', title: 'Neon Welcome', giver: 'rosa',
      async run(c) {
        await c.say('ROSA', "So you're the new face Dex keeps talking about. Welcome to Solano Beach, sugar.", 4.5);
        await c.say('ROSA', "These streets bite after dark. Take this Viper 9 — try not to shoot anyone important.", 4.5);
        c.giveWeapon('pistol', 60);
        await c.say('ROSA', 'My Marlin needs a tune-up. Drive it to Dex Auto Works in the Docklands. Not. A. Scratch.', 4.5);
        const car = c.vehicle('coupe', roadX(10) - CITY.PARK_LANE, L.club.z + 14, 0, { color: '#ff4f8b' });
        c.failIf(() => car.destroyed || car.sinking > 0, "Rosa's Marlin was wrecked.");
        let m = c.marker(car, { type: 'arrow', color: 0x4dc3ff, label: 'Marlin', kind: 'car' });
        c.objective("Get in Rosa's <b>Marlin GT</b>.");
        await c.until(() => P().vehicle === car);
        c.removeMarker(m);
        const dest = { x: L.garage.x, z: L.garage.z - 2 };
        m = c.marker(dest, { color: 0xffd23f, radius: 3.2, label: 'Garage' });
        c.objective('Drive to <b>Dex Auto Works</b> in the Docklands.');
        await c.until(() => P().vehicle !== car || (near(car.pos, dest, 5) && car.speed < 2.5));
        if (P().vehicle !== car) {
          c.objective("Get back in Rosa's <b>Marlin GT</b>.");
          await c.until(() => P().vehicle === car && near(car.pos, dest, 5) && car.speed < 2.5);
        }
        c.removeMarker(m);
        c.objective('Leave the car.');
        await c.until(() => !P().vehicle);
        const dmg = 1 - car.health / car.def.health;
        await c.say('DEX', dmg > 0.3 ? "Rosa's baby... what did you DO to it? Eh, I'll fix it. Come see me for real work." : "Clean delivery. Rosa picked a good one. Come see me when you want real work.", 4.5);
        return { reward: dmg > 0.3 ? 350 : 600 };
      },
    },
    {
      id: 'm2', title: 'Rush Order', giver: 'dex',
      async run(c) {
        await c.say('DEX', 'Client of mine needs a package from a pawn broker up in Palmetto.', 3.5);
        await c.say('DEX', "Clock starts the second you grab it. Deliver to the Starlight Pier. Don't be late.", 4);
        const r = blockRect(1, 1);
        const pk = { x: r.x1 - 1.5, z: (r.z0 + r.z1) / 2 };
        let got = false;
        c.pickup('package', pk.x, pk.z, { onCollect: () => { got = true; } });
        let m = c.marker(pk, { color: 0xff5fd0, label: 'Package' });
        c.objective('Pick up the <b>package</b> in Palmetto.');
        await c.until(() => got);
        c.removeMarker(m);
        const dest = { x: L.pier.x, z: 0 };
        m = c.marker(dest, { color: 0xffd23f, radius: 3.5, label: 'Pier' });
        c.objective('Deliver the package to <b>Starlight Pier</b>!');
        c.setTimer(110, 'The client walked. Too slow.');
        await c.until(() => near(P().vehicle ? P().vehicle.pos : P().pos, dest, 6));
        c.clearTimer(); c.removeMarker(m);
        await c.say('DEX', "(phone) Client's happy. Cash is on its way, speed racer.", 3.5);
        return { reward: 900 };
      },
    },
    {
      id: 'm3', title: 'Pier Pressure', giver: 'rosa',
      async run(c) {
        await c.say('ROSA', 'The Riptides are shaking down my vendors on Starlight Pier.', 3.5);
        await c.say('ROSA', 'Take this Hornet and a vest. Go remind them whose town this is.', 4);
        c.giveWeapon('smg', 260); P().armor = Math.max(P().armor, 75);
        const entry = { x: 438, z: 0 };
        let m = c.marker(entry, { color: 0xffd23f, label: 'Pier' });
        c.objective('Go to <b>Starlight Pier</b>.');
        await c.until(() => near(P().pos, entry, 40) || near(P().vehicle ? P().vehicle.pos : P().pos, entry, 30));
        c.removeMarker(m);
        const spots = [[480, -4, 'pistol'], [486, 5, 'smg'], [512, -5, 'pistol'], [530, 3, 'smg'], [565, -12, 'shotgun'], [575, 14, 'pistol'], [592, -3, 'smg'], [548, 20, 'pistol']];
        const foes = spots.map(([x, z, w]) => c.enemy(x, z, w, { yaw: -Math.PI / 2, detectRange: 45 }));
        const count = () => foes.filter((f) => f.dead).length;
        c.objective(`Take out the <b>Riptides</b> on the pier. (0/${foes.length})`);
        await c.until(() => { c.objective(`Take out the <b>Riptides</b> on the pier. (${count()}/${foes.length})`); return count() === foes.length; });
        await c.say('ROSA', '(phone) Word travels fast on the boardwalk. Nice work.', 3.5);
        return { reward: 1200 };
      },
    },
    {
      id: 'm4', title: 'Tail Lights', giver: 'dex',
      async run(c) {
        await c.say('DEX', 'A Riptide courier is hauling their cash to the docks in a silver Coastal sedan.', 4);
        await c.say('DEX', 'Stop that car before it reaches the hideout. You\'re gonna need wheels.', 3.5);
        const gate = L.hideoutGate;
        // spawn courier somewhere north/east, route to the hideout gate
        let car = null;
        const cands = [[9, 2, 9, 3], [8, 2, 8, 3], [9, 1, 9, 2], [7, 2, 7, 3], [8, 1, 8, 2], [6, 2, 6, 3]];
        for (const [a, b, cc, d] of cands) {
          for (const t of [0.3, 0.6, 0.1, 0.85]) { car = c.game.vehicles.spawnTraffic(nearestNode(roadX(a), roadZ(b)), nearestNode(roadX(cc), roadZ(d)), t, 'sedan', 'route'); if (car) break; }
          if (car) break;
        }
        car.paint.color.set('#c9ccd1'); car.persistent = true; car.health = 1100;
        c.vehicles.push(car);
        car.ai.path = findPath(car.ai.to, nearestNode(gate.x, gate.z)); car.ai.pathIdx = 0;
        car.ai.dest = gate; car.ai.routeSpeed = 15;
        const m = c.marker(car, { type: 'arrow', color: 0xff3040, label: 'Courier', kind: 'enemy' });
        c.objective('Destroy the <b>courier\'s car</b> before it reaches the docks.');
        c.failIf(() => car.npcDriver && near(car.pos, gate, 22), 'The courier made it to the hideout.');
        let closest = 1e9;
        c.failIf(() => car.npcDriver && !car.destroyed && closest < 150 && Math.hypot(car.pos.x - P().pos.x, car.pos.z - P().pos.z) > 380, 'You lost the courier.');
        await c.until(() => {
          const d = Math.hypot(car.pos.x - P().pos.x, car.pos.z - P().pos.z);
          closest = Math.min(closest, d);
          if (car.ai) car.ai.routeSpeed = d < 50 ? 23 : 14;
          return car.destroyed || car.health < 320 || !car.npcDriver;
        });
        c.removeMarker(m);
        let courier = null;
        if (!car.destroyed) {
          car.setNpcDriver(false); car.ai = null;
          const w = car.toWorld(car.def.W / 2 + 0.8, 0, 0.3);
          courier = c.enemy(w.x, w.z, 'pistol', { detectRange: 60 });
          c.objective('The courier bailed! Take him <b>out</b>.');
          await c.until(() => courier.dead);
        }
        c.clearFails();
        const at = courier ? courier.pos : car.pos;
        let got = false;
        c.pickup('package', at.x + 1.5, at.z, { onCollect: () => { got = true; } });
        const pm = c.marker({ x: at.x + 1.5, z: at.z }, { color: 0x3bff7a, radius: 1.5, label: 'Cash' });
        c.objective('Grab the <b>cash bag</b>.');
        await c.until(() => got);
        c.removeMarker(pm);
        await c.say('DEX', "(phone) That's gonna sting. The Riptides will be looking for you now.", 3.5);
        return { reward: 1500 };
      },
    },
    {
      id: 'm5', title: 'Hot Wheels', giver: 'rosa',
      async run(c) {
        await c.say('ROSA', 'A loan shark named Vargas owes me. His Bullet supercar sits in the Midtown lot.', 4);
        await c.say('ROSA', 'Bring it to the docks. And sugar — lose any heat before you get there.', 4);
        const lot = L.carLot;
        const car = c.vehicle('supercar', lot.x, lot.z, Math.PI / 2, { color: '#ffd400' });
        c.failIf(() => car.destroyed || car.sinking > 0, 'The Bullet was destroyed.');
        for (const [dx, dz, w] of [[6, 4, 'pistol'], [-6, -5, 'smg'], [3, -8, 'pistol']]) c.enemy(lot.x + dx, lot.z + dz, w, { detectRange: 20, hostile: true });
        let m = c.marker(car, { type: 'arrow', color: 0x4dc3ff, label: 'Bullet', kind: 'car' });
        c.objective('Steal the <b>Bullet</b> from the Midtown lot.');
        await c.until(() => P().vehicle === car);
        c.removeMarker(m);
        c.game.police.setLevel(2);
        c.game.hud.notify('Vargas called in a favor with the cops!', 3);
        c.objective('<b>Lose the cops.</b>');
        await c.until(() => c.game.police.level === 0);
        const dest = { x: -40, z: 480 };
        m = c.marker(dest, { color: 0xffd23f, radius: 3.5, label: 'Docks' });
        c.objective('Deliver the <b>Bullet</b> to the docks.');
        await c.until(() => {
          if (c.game.police.level > 0) c.objective('<b>Lose the cops</b> before delivering the car!');
          else if (P().vehicle !== car) c.objective('Get back in the <b>Bullet</b>.');
          else c.objective('Deliver the <b>Bullet</b> to the docks.');
          return P().vehicle === car && near(car.pos, dest, 5) && car.speed < 3 && c.game.police.level === 0;
        });
        c.removeMarker(m);
        c.objective('Leave the car.');
        await c.until(() => !P().vehicle);
        await c.say('ROSA', "(phone) Vargas is going to cry when he hears. I love it.", 3.5);
        return { reward: 2000 };
      },
    },
    {
      id: 'm6', title: 'Neon Crown', giver: 'dex',
      async run(c) {
        await c.say('DEX', 'Marco "Shark" Vela runs the Riptides out of that marine supply warehouse on the docks.', 4.5);
        await c.say('DEX', 'Rosa wants it over tonight. Take the Kestrel, the Breaker and some Firecrackers.', 4);
        c.giveWeapon('rifle', 180); c.giveWeapon('shotgun', 36); c.giveWeapon('grenade', 4); P().armor = 100;
        const gate = L.hideoutGate, H = L.hideout;
        let m = c.marker(gate, { color: 0xffd23f, label: 'Warehouse' });
        c.objective('Go to the <b>Riptide warehouse</b> at the docks.');
        await c.until(() => near(P().vehicle ? P().vehicle.pos : P().pos, gate, 35));
        c.removeMarker(m);
        c.pickup('health', gate.x - 4, gate.z - 3, { amount: 100 });
        c.pickup('armor', gate.x + 4, gate.z - 3, { amount: 100 });
        const foes = [];
        const r = blockRect(6, 9);
        const pts = [[H.x - 10, H.z - 2], [H.x + 8, H.z + 2], [H.x - 4, H.z + 6], [H.x + 14, H.z - 4], [r.x0 + 12, r.z0 + 10], [H.x - 20, H.z + 3], [H.x, H.z - 6], [H.x + 18, H.z + 5]];
        const ws = ['smg', 'rifle', 'shotgun', 'pistol', 'smg', 'rifle', 'smg', 'pistol'];
        pts.forEach(([x, z], k) => foes.push(c.enemy(x, z, ws[k], { detectRange: 45, health: 120 })));
        const cnt = () => foes.filter((f) => f.dead).length;
        await c.until(() => { c.objective(`Clear out the <b>Riptides</b>. (${cnt()}/${foes.length})`); return cnt() === foes.length; });
        const boss = c.enemy(H.x, H.z + 7, 'rifle', { health: 450, armor: 100, accuracy: 0.8, detectRange: 70,
          appearance: { skin: '#c68a62', shirt: '#f4f1ea', pants: '#f4f1ea', hair: '#1b1b1b', shoes: '#6b4423', sleeves: 'long', shorts: false, build: 1.12, glasses: true, belt: '#6b4423' } });
        c.enemy(H.x - 4, H.z + 5, 'shotgun'); c.enemy(H.x + 4, H.z + 5, 'smg');
        await c.say('SHARK', 'You think you can walk into MY house? Riptides — finish this clown!', 3.5);
        c.objective('Take down <b>Shark Vela</b>.');
        await c.until(() => boss.dead);
        c.game.police.setLevel(3);
        c.objective('The cops heard the fireworks. <b>Escape the police!</b>');
        await c.until(() => c.game.police.level === 0);
        await c.say('ROSA', '(phone) The Riptides are finished. Solano Beach belongs to us now, sugar.', 4.5);
        return { reward: 5000, final: true };
      },
    },
  ];
}

// ---------------------------------------------------------------- manager
export class Missions {
  constructor(game) {
    this.game = game;
    this.defs = missionDefs(game);
    this.index = 0; this.active = null; this.startMarker = null; this.contacts = {};
    this.cooldown = 2;
  }
  get current() { return this.defs[this.index]; }
  contactSpot(giver) {
    const L = this.game.world.locations;
    if (giver === 'rosa') return { x: L.club.x, z: L.club.z, face: -Math.PI / 2 };
    return { x: L.garage.x, z: L.garage.z + 1, face: Math.PI };
  }
  spawnContacts() {
    const g = this.game;
    const mk = (name, app, weapon) => {
      const s = this.contactSpot(name);
      const n = g.peds.spawn('civ', s.x, s.z, { invulnerable: true, appearance: app, yaw: s.face, weapon });
      n.ai.state = 'idle'; n.ai.faceYaw = s.face; n.cash = 0;
      this.contacts[name] = n;
    };
    mk('rosa', { skin: '#e0ac85', shirt: '#ff3fa4', pants: '#1b1b1b', hair: '#2b1a10', shoes: '#c1121f', sleeves: 'none', shorts: false, build: 0.95, belt: '#ffd23f' });
    mk('dex', { skin: '#7d4a2d', shirt: '#5a7d9a', pants: '#2b2d42', hair: '#1b1b1b', shoes: '#1b1b1b', sleeves: 'short', shorts: false, build: 1.08, bald: true, glasses: true });
  }
  setupStart() {
    if (this.startMarker) { this.startMarker.dispose(); this.startMarker = null; }
    const d = this.current;
    if (!d || this.active) return;
    const s = this.contactSpot(d.giver);
    const fx = Math.sin(s.face) * 2.2, fz = Math.cos(s.face) * 2.2;
    this.startPos = { x: s.x + fx, z: s.z + fz };
    this.startMarker = new Marker(this.game, this.startPos, { color: 0xff3fa4, radius: 1.4, label: d.giver === 'rosa' ? 'R' : 'D', kind: 'mission' });
  }
  update(dt) {
    const g = this.game, p = g.player;
    for (const k in this.contacts) {
      const n = this.contacts[k];
      if (n.dead || !g.peds.list.includes(n)) { this.contacts = {}; this.spawnContacts(); break; }
      n.mesh.visible = !(this.active && this.active.def.giver === k && this.active.time > 8);
    }
    if (this.active) { this.active.update(dt); return; }
    this.cooldown -= dt;
    if (this.startMarker) {
      this.startMarker.update(dt);
      if (this.cooldown <= 0 && !p.vehicle && !p.dead && g.police.level === 0 && Math.hypot(p.pos.x - this.startPos.x, p.pos.z - this.startPos.z) < 1.6) this.start(this.current);
      else if (this.cooldown <= 0 && !p.vehicle && g.police.level > 0 && Math.hypot(p.pos.x - this.startPos.x, p.pos.z - this.startPos.z) < 1.6) g.hud.hint('Lose your wanted level before starting a mission.');
    }
  }
  start(def) {
    const g = this.game;
    if (this.startMarker) { this.startMarker.dispose(); this.startMarker = null; }
    const c = new Ctx(this, def);
    this.active = c;
    g.hud.bigText(def.title.toUpperCase(), 'mission', 3);
    g.audio.jingle(true);
    const who = this.contacts[def.giver];
    if (who) { const dx = g.player.pos.x - who.pos.x, dz = g.player.pos.z - who.pos.z; who.ai.faceYaw = Math.atan2(dx, dz); }
    def.run(c).then((res) => this.pass(c, res)).catch((e) => { if (!(e instanceof Abort)) { console.error(e); this.fail('Mission error'); } });
  }
  pass(c, res) {
    if (this.active !== c) return;
    const g = this.game;
    c.cleanup(true);
    this.active = null;
    g.player.addMoney(res.reward, true);
    g.hud.bigText('MISSION PASSED', 'pass', 4, `+$${res.reward.toLocaleString()}`);
    g.audio.jingle(true);
    g.stats.missions++;
    this.index++;
    this.cooldown = 5;
    for (const k in this.contacts) this.contacts[k].ai.faceYaw = this.contactSpot(k).face;
    if (res.final) g.schedule(4.5, () => g.hud.bigText('SOLANO BEACH IS YOURS', 'pass', 6, 'All story missions complete — the city is yours to explore.'));
    this.setupStart();
    g.save();
  }
  fail(reason) {
    const c = this.active; if (!c) return;
    const g = this.game;
    c.abort(); c.cleanup(false);
    this.active = null;
    g.hud.bigText('MISSION FAILED', 'fail', 4, reason || '');
    g.audio.jingle(false);
    this.cooldown = 5;
    this.setupStart();
  }
}
export { blockCenter, nodePos, rand, pick };
