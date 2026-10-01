// Automated benchmark + regression suite (loaded only with ?test). Uses game.simulate() so it runs
// deterministically even when the tab is in the background.
import * as THREE from 'three';

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r2 = (x) => Math.round(x * 100) / 100;

export function installTests(game, T) {
  const g = game;
  const gl = () => g.renderer.getContext();
  const sync = () => gl().readPixels(0, 0, 1, 1, gl().RGBA, gl().UNSIGNED_BYTE, new Uint8Array(4));
  const errors = [];
  addEventListener('error', (e) => errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + e.reason));
  const oe = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map(String).join(' ')); oe(...a); };
  T.errors = errors;

  // ------------------------------------------------------------ deterministic benchmark scene
  T.benchScene = () => {
    g.vehicles.trafficTarget = 0; g.vehicles.parkedTarget = 0; g.peds.civTarget = 0;
    g.police.patrolT = 1e9; g.police.clear();
    for (const v of g.vehicles.list.slice()) g.vehicles.remove(v);
    for (const n of g.peds.list.slice()) if (!n.invulnerable) g.peds.remove(n);
    const p = g.player; if (p.vehicle) p.exitVehicle(true);
    p.pos.set(418, 0, -190); p.vel.set(0, 0, 0); p.health = 100;
    g.env.hour = 21; g.env.setWeather('clear'); g.env.weather.cloud = 0.15; g.env.weather.rain = 0; g.env.wet = 0;
    const types = ['sedan', 'coupe', 'supercar', 'taxi', 'police', 'van', 'pickup'];
    for (let k = 0; k < 21; k++) {
      const v = g.vehicles.spawn(types[k % 7], 414.7, -215 - k * 8, 0);
      v.persistent = true; v.ai = null;
      if (k % 2 === 0) v.setNpcDriver(true, '#3a86ff');
    }
    for (let k = 0; k < 7; k++) { const v = g.vehicles.spawn(types[k], 300 + k * 8, -2, Math.PI / 2); v.persistent = true; v.ai = null; }
    for (let k = 0; k < 30; k++) { const n = g.peds.spawn('civ', 411, -215 - k * 5, {}); n.ai.state = 'idle'; }
  };
  const VIEWS = {
    oceanDrive: { pos: [416, 4, -200], look: [420, 1, -300] },
    downtown: { pos: [160, 3, -160], look: [100, 10, -250] },
    park: { pos: [20, 2.2, 10], look: [45, 1.5, 40] },
    aerial: { pos: [620, 60, 220], look: [200, 20, -120] },
  };
  T.bench = async (opts = {}) => {
    const out = { views: {} };
    g.manualStep = true;
    T.benchScene();
    for (let i = 0; i < 30; i++) g.frame(1 / 60);
    for (const [name, v] of Object.entries(VIEWS)) {
      g.debugCam = v;
      for (let i = 0; i < 20; i++) g.frame(1 / 60);
      const info = g.renderer.info;
      info.autoReset = false; info.reset(); g.composer.render(); sync();
      const calls = info.render.calls, tris = info.render.triangles;
      info.autoReset = true;
      const frameRuns = [], renderRuns = [];
      for (let k = 0; k < (opts.runs || 5); k++) {
        sync(); let t0 = performance.now();
        for (let i = 0; i < 20; i++) g.frame(1 / 60);
        sync(); frameRuns.push((performance.now() - t0) / 20);
        t0 = performance.now();
        for (let i = 0; i < 20; i++) g.composer.render();
        sync(); renderRuns.push((performance.now() - t0) / 20);
      }
      out.views[name] = { calls, tris, frameMs: r2(median(frameRuns)), renderMs: r2(median(renderRuns)) };
    }
    g.debugCam = null;
    // CPU-only simulation cost
    let t0 = performance.now();
    for (let i = 0; i < 120; i++) g.frame(1 / 60, true);
    out.simMs = r2((performance.now() - t0) / 120);
    // frame-time spikes over 8 s of game time (captures environment-map refreshes)
    g.debugCam = VIEWS.oceanDrive;
    const times = [];
    for (let i = 0; i < 480; i++) { sync(); const t = performance.now(); g.frame(1 / 60); sync(); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    out.spikes = { p50: r2(times[240]), p99: r2(times[475]), max: r2(times[479]) };
    g.debugCam = null;
    const m = g.renderer.info.memory;
    out.memory = { geometries: m.geometries, textures: m.textures, programs: g.renderer.info.programs.length };
    out.pixelRatio = g.renderer.getPixelRatio(); out.size = [innerWidth, innerHeight]; out.quality = g.quality;
    g.manualStep = false;
    return out;
  };

  // ------------------------------------------------------------ leak probe
  T.leakProbe = async () => {
    const { Marker } = await import('./missions.js');
    const m0 = { ...g.renderer.info.memory };
    for (let k = 0; k < 40; k++) {
      const mk = new Marker(g, { x: 418 + k, z: -190 }, { color: 0x100000 * (k % 15) + 0x3355ff, radius: 1 + (k % 5) * 0.3 });
      mk.update(0.016); g.frame(1 / 60); mk.dispose();
      const pk = g.pickups.add(['cash', 'health', 'armor', 'weapon'][k % 4], 418, 0, -200, { amount: 10, weapon: 'pistol' });
      g.frame(1 / 60); g.pickups.remove(pk);
    }
    g.frame(1 / 60);
    const m1 = g.renderer.info.memory;
    return { geometriesDelta: m1.geometries - m0.geometries, texturesDelta: m1.textures - m0.textures };
  };

  // ------------------------------------------------------------ helicopter hitch probe
  T.heliProbe = async () => {
    g.manualStep = true;
    const p = g.player; if (p.vehicle) p.exitVehicle(true);
    p.pos.set(-440, 0.15, 300); p.health = 100000; p.maxHealth = 100000;
    if (g.police.heli) { g.police.heli.dispose(); g.police.heli = null; }
    for (let i = 0; i < 10; i++) g.frame(1 / 60);
    const prog0 = g.renderer.info.programs.length;
    g.police.setLevel(4);
    const times = [];
    for (let i = 0; i < 20; i++) { sync(); const t = performance.now(); g.frame(1 / 60); sync(); times.push(performance.now() - t); }
    const prog1 = g.renderer.info.programs.length;
    const spawned = !!g.police.heli;
    g.police.clear(); p.maxHealth = 100; p.health = 100;
    g.manualStep = false;
    return { spawned, programsBefore: prog0, programsAfter: prog1, newPrograms: prog1 - prog0, worstFrameMs: r2(Math.max(...times)) };
  };

  // ------------------------------------------------------------ functional regression suite
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); return ok; };
  const fresh = () => {
    const p = g.player;
    if (p.vehicle) p.exitVehicle(true);
    if (g.missions.active) g.missions.fail('test');
    g.police.clear(); g.bustedT = 0; g.deathT = 0;
    if (p.dead) p.respawn(25, 16);
    p.health = 100; p.armor = 0; p.vel.set(0, 0, 0); p.animState.handsUp = false;
    g.vehicles.trafficTarget = 16; g.vehicles.parkedTarget = 10; g.peds.civTarget = 34; g.police.patrolT = 5;
  };
  T.tests = {
    async walking() {
      fresh(); const p = g.player;
      p.pos.set(25, 0.17, 16); g.cameraRig.yaw = 0; await T.run(0.3);
      const a = p.pos.clone(); await T.run(1.5, ['KeyW']);
      const b = p.pos.clone(); await T.run(1.5, ['KeyW', 'ShiftLeft']);
      const walk = b.distanceTo(a) / 1.5, sprint = p.pos.distanceTo(b) / 1.5;
      await T.run(0.1, ['Space']); const jumped = p.pos.y > 0.4 || p.vel.y > 1;
      return check('walking', walk > 3.5 && sprint > walk && jumped, `run ${walk.toFixed(1)} m/s, sprint ${sprint.toFixed(1)} m/s, jump ${jumped}`);
    },
    async driving() {
      fresh(); const p = g.player;
      const v = g.vehicles.spawn('sedan', -300, -418, Math.PI / 2); v.persistent = true;
      const w = v.toWorld(v.def.W / 2 + 1, 0, 0); p.pos.set(w.x, 0.15, w.z);
      await T.run(0.1, ['KeyF']); await T.run(0.3);
      const entered = p.vehicle === v;
      await T.run(3, ['KeyW']); const kmh = v.speed * 3.6;
      const h0 = v.heading; await T.run(0.6, ['KeyW', 'KeyD']); const turned = v.heading - h0;
      await T.run(2, ['KeyS']); const braked = v.speed * 3.6;
      await T.run(0.1, ['KeyF']); await T.run(0.5); const exited = !p.vehicle;
      v.persistent = false;
      return check('driving', entered && kmh > 60 && Math.abs(turned) > 0.2 && braked < kmh && exited, `enter ${entered}, 3s ${kmh.toFixed(0)} km/h, turn ${turned.toFixed(2)}, after brake ${braked.toFixed(0)} km/h, exit ${exited}`);
    },
    async shooting() {
      fresh(); const p = g.player;
      p.pos.set(25, 0.17, 16); p.giveWeapon('pistol', 60); p.switchTo('pistol'); p.inv.pistol.clip = 12;
      const n = g.peds.spawn('civ', 25, 23, {}); n.ai.state = 'idle';
      const A = () => T.aimAt({ x: n.pos.x, y: n.pos.y + 1.2, z: n.pos.z });
      await T.run(0.4, [], { mouseRight: true, each: A });
      const hp0 = n.health; const clip0 = p.inv.pistol.clip;
      await T.run(0.05, [], { mouseRight: true, mouseLeft: true, each: A }); await T.run(0.2, [], { mouseRight: true });
      return check('shooting', n.health < hp0 && p.inv.pistol.clip < clip0, `npc hp ${hp0}→${Math.round(n.health)}, clip ${clip0}→${p.inv.pistol.clip}`);
    },
    async police() {
      fresh(); const p = g.player;
      p.pos.set(25, 0.17, 16); p.giveWeapon('pistol', 60); p.switchTo('pistol'); p.inv.pistol.clip = 12; p.health = 100000; p.maxHealth = 100000;
      for (const n of g.peds.list.slice()) if (!n.invulnerable && n.pos.distanceTo(p.pos) < 60) g.peds.remove(n);
      g.peds.spawn('police', 33, 26, { weapon: 'pistol' });
      const civ = g.peds.spawn('civ', 25, 23, {}); civ.ai.state = 'idle';
      const A = () => T.aimAt({ x: civ.pos.x, y: civ.pos.y + 1.2, z: civ.pos.z });
      for (let k = 0; k < 6 && !civ.dead; k++) { await T.run(0.05, [], { mouseRight: true, mouseLeft: true, each: A }); await T.run(0.3, [], { mouseRight: true, each: A }); }
      const lvl = g.police.level;
      await T.run(10);
      const cops = g.peds.list.filter((n) => n.role === 'police' && !n.dead).length;
      const cars = g.vehicles.list.filter((v) => v.def.police && v.ai && v.ai.mode === 'pursue').length;
      p.maxHealth = 100; p.health = 100;
      return check('police', lvl >= 1 && (cops + cars) > 0, `wanted ${lvl}, officers ${cops}, pursuit cars ${cars}`);
    },
    async arrest() {
      fresh(); const p = g.player;
      p.pos.set(25, 0.17, 16);
      for (const n of g.peds.list.slice()) if (!n.invulnerable && n.pos.distanceTo(p.pos) < 60) g.peds.remove(n);
      g.police.setLevel(1); g.peds.spawn('police', 30, 22, { weapon: 'pistol' });
      let t = 0; while (!(g.bustedT > 0) && t < 12) { await T.run(0.5); t += 0.5; }
      const busted = g.bustedT > 0; await T.run(4.5);
      return check('arrest (1 star)', busted && g.police.level === 0, `busted after ${t}s`);
    },
    async mission1() {
      fresh(); const p = g.player, M = g.missions, L = g.world.locations;
      const title = await T.startMission(0);
      await T.run(14);
      const car = M.active && M.active.vehicles[0];
      if (!car) return check('mission 1', false, 'car not spawned');
      const w = car.toWorld(car.def.W / 2 + 1, 0, 0); p.pos.set(w.x, 0.15, w.z);
      await T.run(0.1, ['KeyF']); await T.run(0.3);
      car.place(L.garage.x, L.garage.z - 2, Math.PI); car.vel.set(0, 0, 0); await T.run(1);
      await T.run(0.1, ['KeyF']); await T.run(6);
      return check('mission 1', M.index === 1 && T.big().startsWith('MISSION PASSED'), `${title}: ${T.big()}`);
    },
    async saveLoad() {
      fresh(); const p = g.player;
      const snap = localStorage.getItem('solanoNights.save.v1');
      p.money = 4321; g.missions.index = 3; p.giveWeapon('smg', 50); g.save();
      p.money = 1; g.missions.index = 0; delete p.inv.smg;
      g.load();
      const ok = p.money === 4321 && g.missions.index === 3 && !!p.inv.smg;
      if (snap) localStorage.setItem('solanoNights.save.v1', snap); else localStorage.removeItem('solanoNights.save.v1');
      g.missions.index = 1;
      return check('save/load', ok, `money ${p.money}, mission ${g.missions.index}`);
    },
    async pause() {
      fresh();
      const t0 = g.time, h0 = g.env.hour;
      g.pause(); const paused = g.state === 'paused';
      g.simulate(1); const frozen = g.time === t0 && g.env.hour === h0;
      g.resume(); g.simulate(0.5); const resumed = g.state === 'playing' && g.time > t0;
      return check('pause/resume', paused && frozen && resumed, `paused ${paused}, frozen ${frozen}, resumed ${resumed}`);
    },
    async helicopter() {
      fresh();
      const r = await T.heliProbe();
      return check('helicopter spawn', r.spawned, `spawned ${r.spawned}, new shader programs ${r.newPrograms}, worst frame ${r.worstFrameMs} ms`);
    },
    async pickups() {
      fresh(); const p = g.player;
      p.pos.set(25, 0.17, 16);
      const n = g.peds.spawn('civ', 28, 18, {}); n.ai.state = 'idle'; n.cash = 55;
      n.takeDamage(999, { kind: 'melee', attacker: null });
      await T.run(0.2);
      const drop = g.pickups.list.find((q) => q.type === 'cash' && q.pos.distanceTo(n.pos) < 3);
      const m0 = p.money;
      if (drop) p.pos.set(drop.pos.x, drop.pos.y, drop.pos.z);
      await T.run(0.5);
      p.armor = 0; const L = g.world.locations; p.pos.set(L.police.x + 6, 0.15, L.police.z); await T.run(0.5);
      return check('pickups & cash drop', !!drop && p.money === m0 + 55 && p.armor > 0, `drop ${!!drop}, money +${p.money - m0}, armor ${p.armor}`);
    },
    async resize() {
      const pr = g.renderer.getPixelRatio(), sz = g.renderer.getSize(new THREE.Vector2());
      dispatchEvent(new Event('resize'));
      const sz2 = g.renderer.getSize(new THREE.Vector2());
      return check('resize', sz2.x === innerWidth && sz2.y === innerHeight, `canvas ${sz2.x}x${sz2.y} @${g.renderer.getPixelRatio()} (was ${sz.x}x${sz.y} @${pr})`);
    },
  };
  T.suite = async (names) => {
    results.length = 0;
    const e0 = errors.length;
    for (const [name, fn] of Object.entries(T.tests)) {
      if (names && !names.includes(name)) continue;
      try { await fn(); } catch (e) { check(name, false, 'threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e)); }
    }
    fresh();
    return { passed: results.filter((r) => r.ok).length, total: results.length, results, newErrors: errors.slice(e0) };
  };
}
