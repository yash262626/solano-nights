// Game orchestration: renderer + post-processing, systems, main loop, global game events.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Input } from './input.js';
import { Physics } from './physics.js';
import { World } from './world.js';
import { Environment } from './sky.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { WeaponSystem, WEAPONS } from './weapons.js';
import { VehicleManager } from './vehicles.js';
import { PedManager } from './npc.js';
import { Police } from './police.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Missions } from './missions.js';
import { Pickups } from './pickups.js';
import { HUD } from './hud.js';
import { setAnisotropy } from './textures.js';
import { blockRect, roadX, roadZ, CITY } from './config.js';
import { clamp, rand, pick } from './utils.js';
import { EventBus, Scheduler } from './events.js';

const NO_INPUT = { mouse: { dx: 0, dy: 0 }, down: () => false };

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.45 }, uGrain: { value: 0.022 }, uCA: { value: 0.0025 }, uSat: { value: 1.12 }, uTint: { value: new THREE.Vector3(1.0, 0.98, 1.03) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uCA, uSat; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec2 uv = vUv; vec2 d = uv - 0.5; float r2 = dot(d,d);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * uCA * r2 * 4.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * uCA * r2 * 4.0).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat) * uTint;
      col *= 1.0 - uVignette * smoothstep(0.15, 0.85, r2 * 2.0);
      float n = fract(sin(dot(uv * vec2(12.9898, 78.233) + fract(uTime) * 91.7, vec2(1.0))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const SAVE_KEY = 'solanoNights.save.v1';

export class Game {
  constructor() {
    this.state = 'loading';
    this.time = 0;
    this.blips = new Set();
    this.stats = { kills: 0, missions: 0 };
    this.weaponsDef = WEAPONS;
    this.inputEnabledForFire = true;
    this.quality = localStorage.getItem('solanoNights.quality') || 'high';
    this.events = new EventBus();
    this.scheduler = new Scheduler();
    this._audioState = { engine: null, siren: 0, night: 0, rain: 0, ocean: 0, speed: 0, radio: false };
    this._engineState = { rpm: 0, throttle: 0, slip: 0 };
  }
  // run fn after `delay` seconds of game time (respects pause)
  schedule(delay, fn) { this.scheduler.after(delay, fn); }

  async init(progress) {
    const canvas = document.getElementById('game');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    setAnisotropy(renderer.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.input = new Input(canvas);
    this.physics = new Physics(16);
    this.audio = new AudioSys(this);
    this.hud = new HUD(this);
    this.cameraRig = new CameraRig(this);

    await progress('Generating textures & city…', 0.1);
    this.world = new World(this);
    this.world.build();
    await progress('Lighting the neon…', 0.55);
    this.env = new Environment(this);
    this.effects = new Effects(this);
    this.weapons = new WeaponSystem(this);
    this.vehicles = new VehicleManager(this);
    this.police = new Police(this);
    this.peds = new PedManager(this);
    this.pickups = new Pickups(this);
    await progress('Spawning citizens…', 0.7);
    this.player = new Player(this);
    const L = this.world.locations;
    this.player.respawn(L.club.x - 1, L.club.z + 5, Math.PI / 2);
    this.cameraRig.yaw = -Math.PI / 2 + 0.6;
    this.missions = new Missions(this);
    this.missions.spawnContacts();
    this.wireEvents();
    this.placeWorldPickups();
    this.addShopBlips();
    this.hud.buildMap();
    await progress('Post-processing…', 0.85);
    this.setupComposer();
    this.applyQuality(this.quality);
    // warm-up: spawn some traffic and people around the start point
    for (let i = 0; i < 60; i++) { this.vehicles.stream(1); this.peds.stream(1); }
    this.env.update(0.016, this.player.pos, this.cameraRig.camera);
    this.cameraRig.update(0.016, this.input);
    // pre-compile shaders to avoid hitches
    this.renderer.compile(this.scene, this.cameraRig.camera);
    await progress('Ready', 1);
    addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing' && !this.hud.shopOpen && !this.hud.bigmapOpen && this.wasLocked) this.pause();
      if (this.input.locked) this.wasLocked = true;
    });
    this.clock = new THREE.Clock();
    this.fpsAcc = 0; this.fpsN = 0; this.fpsCheckT = 0; this.fps = 60;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupComposer() {
    const r = this.renderer, w = innerWidth, h = innerHeight;
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.scene, this.cameraRig.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.7, 0.55, 0.82);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.composer.addPass(this.fxaa);
  }
  // internal resolution for a quality level, capped (~2.3 MP on high) so big/high-DPI screens stay smooth
  pixelRatioFor(q) {
    const cap = Math.sqrt(2.3e6 / (Math.max(1, innerWidth) * Math.max(1, innerHeight)));
    return q === 'high' ? Math.min(devicePixelRatio, 1.5, Math.max(cap, 0.75)) : q === 'medium' ? Math.min(1, Math.max(cap * 0.85, 0.7)) : 0.7;
  }
  applyQuality(q, opts = {}) {
    this.quality = q;
    localStorage.setItem('solanoNights.quality', q);
    // Automatic downgrades never toggle castShadow: that would recompile every lit shader mid-game.
    if (!opts.auto) this.env.sun.castShadow = q !== 'low';
    this.env.shadowThrottle = q !== 'high';
    const ms = q === 'high' ? 2048 : 1024;
    if (this.env.sun.shadow.mapSize.x !== ms) { this.env.sun.shadow.mapSize.set(ms, ms); if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; } }
    this.bloom.enabled = q !== 'low';
    this.world.drawDistance = q === 'high' ? 750 : q === 'medium' ? 550 : 400;
    this.vehicles.trafficTarget = q === 'low' ? 10 : 16;
    this.peds.civTarget = q === 'low' ? 22 : 34;
    this.resize();
    const sel = document.getElementById('qualitySel'); if (sel) sel.value = q;
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    // recompute the resolution cap for the new window size (previously the old ratio was kept)
    const pr = this.pixelRatioFor(this.quality);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.cameraRig.resize();
  }

  allCharacters() {
    const a = this._chars || (this._chars = []);
    a.length = 0; a.push(this.player); for (const n of this.peds.list) a.push(n);
    return a;
  }

  placeWorldPickups() {
    const L = this.world.locations, P = this.pickups, gh = (x, z) => this.physics.groundHeight(x, z, 50);
    const add = (type, x, z, opts) => P.add(type, x, gh(x, z), z, { respawn: 90, ...opts });
    add('health', L.hospital.x + 4, L.hospital.z, { amount: 100 });
    add('health', L.park.x + 8, L.park.z, { amount: 50 });
    add('health', 447, -210, { amount: 50 });
    add('armor', L.police.x + 6, L.police.z, { amount: 100 });
    add('armor', 600, 18, { amount: 50 });
    let r = blockRect(3, 3); add('weapon', r.x0 + 2, (r.z0 + r.z1) / 2, { weapon: 'pistol', amount: 36 });
    r = blockRect(2, 9); add('weapon', r.x0 + 2, r.z0 + 2, { weapon: 'smg', amount: 64 });
    r = blockRect(0, 5); add('weapon', r.x1 - 2, (r.z0 + r.z1) / 2, { weapon: 'shotgun', amount: 12 });
    add('weapon', 612, -20, { weapon: 'rifle', amount: 60 });
    r = blockRect(1, 2); add('weapon', (r.x0 + r.x1) / 2 + 6, (r.z0 + r.z1) / 2, { weapon: 'grenade', amount: 3 });
    for (let k = 0; k < 10; k++) {
      const b = blockRect(Math.floor(rand(0, CITY.NX)), Math.floor(rand(0, CITY.NZ)));
      add('cash', b.x0 + 2, rand(b.z0 + 5, b.z1 - 5), { amount: Math.floor(rand(50, 250)), respawn: 240 });
    }
  }
  addShopBlips() {
    const L = this.world.locations;
    this.blips.add({ pos: L.gunshop, color: '#ff7a3c', label: 'G', kind: 'shop' });
    for (const s of L.spray) this.blips.add({ pos: s, color: '#35f2ff', label: 'S', kind: 'shop' });
    this.blips.add({ pos: L.hospital, color: '#ff4d5a', label: '+', kind: 'shop' });
  }

  // ------------------------------------------------------------------ state
  start(continueSave) {
    this.audio.init();
    if (continueSave) this.load();
    this.missions.setupStart();
    this.state = 'playing';
    document.getElementById('title').classList.remove('show');
    document.getElementById('hud').classList.add('show');
    this.input.lock();
    if (!continueSave) this.hud.notify('Walk into the pink marker by <b>Club Nocturne</b> to meet Rosa.', 7);
    this.clock.getDelta();
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.getElementById('pause').classList.add('show');
    this.input.unlock();
    if (this.audio.ctx) this.audio.ctx.suspend();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    document.getElementById('pause').classList.remove('show');
    this.input.lock();
    if (this.audio.ctx) this.audio.ctx.resume();
    this.clock.getDelta();
  }
  save() {
    const p = this.player;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ money: p.money, mission: this.missions.index, inv: p.inv, armor: p.armor, stats: this.stats })); } catch (e) { /* storage unavailable */ }
  }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return;
      const p = this.player;
      p.money = s.money; p.inv = s.inv || p.inv; p.armor = s.armor || 0;
      this.missions.index = s.mission || 0;
      this.stats = s.stats || this.stats;
      const best = p.owned().filter((id) => id !== 'grenade').pop();
      p.switchTo(best || 'fist');
      this.hud.notify('Game loaded.', 2);
    } catch (e) { /* corrupted save */ }
  }

  // ------------------------------------------------------------------ events
  // Gameplay systems emit events on this.events; the global reactions to them live here.
  wireEvents() {
    const E = this.events;
    E.on('gunfire', ({ shooter, origin }) => {
      this.peds.broadcastThreat(origin, 45, 1);
      if (shooter.isPlayer) {
        this.shotReportT = this.shotReportT || 0;
        if (this.time - this.shotReportT > 1.5) { this.shotReportT = this.time; this.police.report('shots', origin); }
      }
    });
    E.on('explosion', ({ pos, owner }) => {
      this.peds.broadcastThreat(pos, 70, 2);
      if (owner && owner.isPlayer) this.police.report('explosion', pos);
    });
    E.on('vehicleDamagedByPlayer', ({ vehicle: v, info }) => {
      if (v.police && v.npcDriver && info.kind !== 'explosion') {
        if (this.time - (this.ramT || 0) > 2) { this.ramT = this.time; this.police.report(info.kind === 'bullet' ? 'hurt_cop' : 'ram_cop', v.pos); }
      }
    });
    E.on('carCollision', ({ a, b, impact }) => {
      const pv = this.player.vehicle;
      if (!pv || (a !== pv && b !== pv)) return;
      const o = a === pv ? b : a;
      if (o.npcDriver && o.ai && impact > 4) o.ai.panic = 8;
    });
    E.on('vehicleDestroyed', ({ vehicle: v, sunk, attacker }) => {
      const p = this.player;
      if (p.vehicle === v) {
        p.exitVehicle(true);
        if (!sunk) p.takeDamage(160, { kind: 'explosion', attacker });
      }
      if (v.npcDriver) v.setNpcDriver(false);
    });
    E.on('enterVehicle', ({ vehicle: v }) => {
      if (v.def.police && this.police.level === 0) this.hud.notify('Press <b>G</b> to toggle the siren.', 3);
    });
    E.on('playerDeath', () => {
      this.hud.bigText('FLATLINED', 'fail', 5, 'Hospital fee: -$100');
      this.audio.wasted();
      this.deathT = 5.5;
      this.missions.fail('You died.');
    });
  }
  busted() {
    if (this.bustedT > 0 || this.player.dead) return;
    this.bustedT = 4;
    this.hud.bigText('CUFFED', 'fail', 4, 'Weapons confiscated · Bail: -$200');
    this.audio.jingle(false);
    this.missions.fail('You got arrested.');
    this.player.vel.set(0, 0, 0);
    this.player.animState.handsUp = true;
  }
  respawnAt(loc, cost) {
    const p = this.player;
    this.police.clear();
    p.money = Math.max(0, p.money - cost);
    p.respawn(loc.x, loc.z, loc.heading || 0);
    p.armor = 0;
    this.hud.notify(`$${cost} deducted.`, 3);
  }

  // ------------------------------------------------------------------ per-frame logic
  handleGlobalInput() {
    const I = this.input, h = this.hud;
    if (I.hit('Escape') || I.hit('KeyP')) {
      if (h.shopOpen) h.closeShop(); else if (h.bigmapOpen) h.toggleBigMap(); else this.pause();
      return;
    }
    if (I.hit('KeyM')) h.toggleBigMap();
    if (I.hit('F7')) this.hud.notify('Weather: ' + this.env.cycleWeather(), 2);
    if (I.hit('F8')) { this.env.hour = (this.env.hour + 1) % 24; this.hud.notify('Time: ' + this.env.timeString(), 1.5); }
    if (h.shopOpen) {
      for (let k = 1; k <= 8; k++) if (I.hit('Digit' + k)) h.buy(k - 1);
    }
  }
  interactions(dt) {
    const p = this.player, L = this.world.locations, h = this.hud;
    if (p.dead) return;
    if (!p.vehicle) {
      const gs = L.gunshop;
      if (Math.hypot(p.pos.x - gs.x, p.pos.z - gs.z) < 3) {
        if (!h.shopOpen) h.hint('Press <b>E</b> to browse <b>IRONCLAD ARMS</b>');
        if (this.input.hit('KeyE')) { if (h.shopOpen) h.closeShop(); else h.openShop(); }
      } else if (h.shopOpen) h.closeShop();
    }
    this.sprayCd = (this.sprayCd || 0) - dt;
    if (p.vehicle) {
      for (const s of L.spray) {
        if (Math.hypot(p.vehicle.pos.x - s.x, p.vehicle.pos.z - s.z) < 5) {
          const v = p.vehicle;
          if (this.sprayCd > 0) continue;
          if (v.speed > 3) { h.hint('Stop inside to respray ($100)'); continue; }
          if (p.money < 100) { h.hint('Respray costs $100.'); continue; }
          this.sprayCd = 8;
          p.money -= 100;
          const col = pick(v.def.colors.concat(['#ff4f8b', '#2ec4c6', '#ffcc33', '#7b2cbf', '#e8e4da']));
          v.health = v.def.health; v.burnT = 0; v.deformed = 0;
          v.bodyGeo.attributes.position.array.set(v.origPos); v.bodyGeo.attributes.position.needsUpdate = true; v.bodyGeo.computeVertexNormals();
          v.paint.color.set(col);
          const had = this.police.level > 0;
          this.police.clear();
          h.bigText('FRESH PAINT', 'pass', 2.5, had ? "Nobody saw nothin'. -$100" : 'Good as new. -$100');
          this.audio.cash();
          document.getElementById('fade').classList.add('flash');
          this.schedule(0.6, () => document.getElementById('fade').classList.remove('flash'));
        }
      }
    }
  }

  loop() {
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    if (this.manualStep) return;
    // real frame-rate tracking for automatic quality scaling
    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc > 1) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.autoQuality(); }
    this.frame(dt);
  }
  // Deterministic stepping for automated tests: runs `seconds` of game time while holding `keys`.
  simulate(seconds, keys = [], opts = {}) {
    this.manualStep = true;
    const dt = 1 / 60, n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      for (const k of keys) { if (!this.input.keys.has(k)) this.input.pressed.add(k); this.input.keys.add(k); }
      if (opts.mouseLeft !== undefined) { if (opts.mouseLeft && !this.input.mouse.left) this.input.mouse.leftPressed = true; this.input.mouse.left = opts.mouseLeft; }
      if (opts.mouseRight !== undefined) this.input.mouse.right = opts.mouseRight;
      if (opts.each) opts.each(i);
      this.frame(dt, i < n - 1 && !opts.renderAll);
    }
    for (const k of keys) this.input.keys.delete(k);
    this.input.mouse.left = false; this.input.mouse.right = false;
    this.manualStep = false;
    this.clock.getDelta();
  }
  frame(dt, skipRender = false) {
    if (this.state === 'paused' || this.state === 'loading') { this.input.endFrame(); return; }
    this.time += dt;
    this.scheduler.update(dt);
    const titleMode = this.state === 'title';

    if (!titleMode) {
      this.handleGlobalInput();
      this.inputEnabledForFire = !this.hud.shopOpen && !this.hud.bigmapOpen;
      if (this.bustedT > 0) {
        this.bustedT -= dt;
        if (this.bustedT <= 0) {
          const p = this.player;
          p.animState.handsUp = false;
          for (const id in p.inv) if (id !== 'fist') delete p.inv[id];
          p.switchTo('fist');
          this.respawnAt(this.world.locations.police, 200);
        }
      }
      if (this.deathT > 0) {
        this.deathT -= dt;
        if (this.deathT <= 0) this.respawnAt(this.world.locations.hospital, 100);
      }
      if (!(this.bustedT > 0)) this.player.update(dt, this.input);
      else this.player.updateAnim(dt);
    } else {
      // attract mode: slowly orbit the camera around the player
      this.cameraRig.yaw += dt * 0.05;
    }
    this.vehicles.update(dt);
    this.peds.update(dt);
    this.police.update(dt);
    this.weapons.update(dt);
    this.pickups.update(dt);
    if (!titleMode) { this.missions.update(dt); this.interactions(dt); }
    this.cameraRig.update(dt, titleMode ? NO_INPUT : this.input);
    const cam = this.cameraRig.camera;
    if (this.debugCam) { // free camera used for screenshots / testing
      const d = this.debugCam;
      cam.position.set(d.pos[0], d.pos[1], d.pos[2]); cam.lookAt(d.look[0], d.look[1], d.look[2]);
      cam.updateMatrixWorld();
      this.cameraRig.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.cameraRig.frust.setFromProjectionMatrix(this.cameraRig.pm);
    }
    const focus = this.player.vehicle ? this.player.vehicle.pos : this.player.pos;
    this.env.update(dt, focus, cam);
    this.world.update(dt, this.time, { night: this.env.night, wet: this.env.wet }, cam.position);
    for (const f of this.world.fountains) if (f.x - cam.position.x < 150 && cam.position.x - f.x < 150 && Math.abs(f.z - cam.position.z) < 150) this.effects.fountainSpray(f.x, f.y, f.z, f.r);
    this.effects.update(dt, cam, this.renderer);
    // audio
    const p = this.player, v = p.vehicle;
    this.audio.listener.x = cam.position.x; this.audio.listener.y = cam.position.y; this.audio.listener.z = cam.position.z; this.audio.listener.yaw = this.cameraRig.yaw;
    let siren = 0;
    for (const c of this.vehicles.list) if (c.siren && !c.destroyed) siren = Math.max(siren, 1 - c.pos.distanceTo(cam.position) / 160);
    const vf = v ? Math.abs(v.forwardSpeed()) : 0;
    const gearT = v ? (vf / v.def.maxSpeed) * 4.5 : 0;
    const as = this._audioState, es = this._engineState;
    if (v && !v.destroyed) {
      es.rpm = clamp(0.15 + (gearT % 1) * 0.7 + Math.floor(gearT) * 0.04 + v.input.throttle * 0.1, 0, 1.2);
      es.throttle = v.input.throttle; es.slip = v.slip * (vf > 4 ? 1 : 0);
      as.engine = es;
    } else as.engine = null;
    as.siren = siren; as.night = this.env.night; as.rain = this.env.weather.rain;
    as.ocean = clamp(1 - Math.abs(cam.position.x - 460) / 120, 0, 1); as.speed = vf / 45; as.radio = !!v && !titleMode;
    this.audio.update(dt, as);
    // post fx
    this.grade.uniforms.uTime.value = this.time;
    const hp = clamp(p.health / p.maxHealth, 0, 1);
    this.grade.uniforms.uSat.value = p.dead ? 0.1 : 0.85 + hp * 0.3;
    this.bloom.strength = 0.45 + this.env.night * 0.55;
    this.renderer.toneMappingExposure = 1.0 + this.env.night * 0.05;
    this.scene.environmentIntensity = this.env.envIntensity || 1;
    if (!titleMode) this.hud.update(dt);
    if (!skipRender) this.composer.render();
    this.input.endFrame();
  }
  autoQuality() {
    if (this.state !== 'playing' || this.qualityLocked || document.hidden || this.manualStep) { this.fpsCheckT = 0; return; }
    this.fpsCheckT++;
    if (this.fpsCheckT < 4) return;
    if (this.fps < 28 && this.quality === 'high') { this.applyQuality('medium', { auto: true }); this.fpsCheckT = 0; this.hud.notify('Graphics quality auto-set to Medium', 2); }
    else if (this.fps < 22 && this.quality === 'medium') { this.applyQuality('low', { auto: true }); this.fpsCheckT = 0; this.hud.notify('Graphics quality auto-set to Low', 2); this.qualityLocked = true; }
  }
}
export { roadX, roadZ };
