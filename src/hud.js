// HUD: status panel, wanted stars, minimap (rotating, with blips), objectives, subtitles,
// speedometer, notifications, big messages, full-screen map and the gun shop menu.
import { CITY, WORLD, roadX, roadZ, PLATFORMS } from './config.js';
import { WEAPONS } from './weapons.js';
import { clamp } from './utils.js';

const MAP = { x0: -520, z0: -560, size: 1240 };
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), money: $('money'), clock: $('clock'), hp: $('hpFill'), ar: $('arFill'), arWrap: $('arBar'),
      weapon: $('weaponName'), ammo: $('ammo'), stars: $('stars'), objective: $('objective'), subtitle: $('subtitle'),
      notify: $('notify'), speedo: $('speedo'), speed: $('speedVal'), vhp: $('vhpFill'), vname: $('vehName'),
      big: $('bigText'), bigMain: $('bigMain'), bigSub: $('bigSub'), cross: $('crosshair'), hit: $('hitmarker'),
      dmg: $('damage'), timer: $('timer'), hint: $('hint'), mini: $('minimap'), bigmap: $('bigmap'), bigmapCanvas: $('bigmapCanvas'),
      shop: $('shop'), shopList: $('shopList'), radio: $('radio'), dirInd: $('dmgDir'), zone: $('zone'), wIcon: $('weaponIcon'),
    };
    this.miniCtx = this.el.mini.getContext('2d');
    this.notifyT = 0; this.subT = 0; this.bigT = 0; this.hintT = 0; this.hitT = 0; this.dmgA = 0; this.moneyShown = 0; this.wantedFlashT = 0; this.zoneT = 0; this.lastZone = '';
    this.bigmapOpen = false; this.shopOpen = false;
    this.mapCanvas = null;
  }

  buildMap() {
    const c = document.createElement('canvas'); c.width = c.height = MAP.size;
    const g = c.getContext('2d');
    const X = (x) => x - MAP.x0, Z = (z) => z - MAP.z0;
    const grd = g.createRadialGradient(MAP.size / 2, MAP.size / 2, 100, MAP.size / 2, MAP.size / 2, MAP.size * 0.7);
    grd.addColorStop(0, '#0f3a5c'); grd.addColorStop(1, '#071a2e');
    g.fillStyle = grd; g.fillRect(0, 0, MAP.size, MAP.size);
    // beach and shallows
    g.fillStyle = '#12506e'; g.fillRect(X(WORLD.BEACH_X), Z(-WORLD.BEACH_Z), 90, WORLD.BEACH_Z * 2);
    g.fillStyle = '#d9c192'; g.fillRect(X(WORLD.BEACH_X - 2), Z(-WORLD.BEACH_Z), 33, WORLD.BEACH_Z * 2);
    // island
    g.fillStyle = '#1c1f2c'; g.fillRect(X(WORLD.LAND_MIN_X), Z(WORLD.LAND_MIN_Z), WORLD.BEACH_X - WORLD.LAND_MIN_X, WORLD.LAND_MAX_Z - WORLD.LAND_MIN_Z);
    // platforms
    g.fillStyle = '#6b5a45';
    for (const p of PLATFORMS) g.fillRect(X(p.x0), Z(p.z0), p.x1 - p.x0, p.z1 - p.z0);
    // blocks
    const colors = { park: '#23603c', parking: '#383b4c', docks: '#35322c', residential: '#2a2a36', downtown: '#2b2f40', ocean: '#302a3e', midtown: '#2a2d3b', hospital: '#3a2f3a', police: '#28324c', club: '#43284a', garage: '#35322c', spray: '#2a3a44' };
    for (const b of this.game.world.blocks) { g.fillStyle = colors[b.type] || '#2a2d3b'; g.fillRect(X(b.x0), Z(b.z0), b.x1 - b.x0, b.z1 - b.z0); }
    // building footprints
    g.fillStyle = 'rgba(120,130,170,0.35)';
    for (const b of this.game.physics.boxes) {
      if (b.tag !== 'building' || b.maxY < 3) continue;
      g.fillRect(X(b.minX), Z(b.minZ), b.maxX - b.minX, b.maxZ - b.minZ);
    }
    // roads
    g.fillStyle = '#5b6078';
    const h = CITY.HALF_RW;
    for (let i = 0; i <= CITY.NX; i++) g.fillRect(X(roadX(i) - h), Z(CITY.Z0 - h), CITY.RW, CITY.Z1 - CITY.Z0 + CITY.RW);
    for (let j = 0; j <= CITY.NZ; j++) g.fillRect(X(CITY.X0 - h), Z(roadZ(j) - h), CITY.X1 - CITY.X0 + CITY.RW, CITY.RW);
    g.fillStyle = 'rgba(255,210,80,0.25)';
    for (let i = 0; i <= CITY.NX; i++) g.fillRect(X(roadX(i) - 0.5), Z(CITY.Z0), 1, CITY.Z1 - CITY.Z0);
    for (let j = 0; j <= CITY.NZ; j++) g.fillRect(X(CITY.X0), Z(roadZ(j) - 0.5), CITY.X1 - CITY.X0, 1);
    // district labels
    g.font = 'bold 22px "Trebuchet MS", Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.18)';
    const lab = [['PALMETTO', -290, -150], ['DOWNTOWN', 80, -210], ['MIDTOWN', -80, 120], ['OCEAN DRIVE', 375, -300], ['DOCKLANDS', 0, 380], ['STARLIGHT PIER', 530, -40]];
    for (const [t, x, z] of lab) g.fillText(t, X(x), Z(z));
    this.mapCanvas = c;
  }

  // ------------------------------------------------------------------ messages
  notify(text, dur = 3) { this.el.notify.innerHTML = text; this.el.notify.classList.add('show'); this.notifyT = dur; }
  hint(text) { this.el.hint.innerHTML = text; this.el.hint.classList.add('show'); this.hintT = 0.3; }
  subtitle(who, text, dur) {
    const colors = { ROSA: '#ff5fb0', DEX: '#ffd23f', SHARK: '#35f2ff' };
    this.el.subtitle.innerHTML = `<span style="color:${colors[who] || '#fff'}">${who}:</span> ${text}`;
    this.el.subtitle.classList.add('show'); this.subT = dur;
  }
  setObjective(html) {
    if (!html) { this.el.objective.classList.remove('show'); this.objHtml = null; return; }
    if (html === this.objHtml) return;
    this.objHtml = html;
    this.el.objective.innerHTML = html; this.el.objective.classList.add('show');
  }
  setTimer(t) {
    if (t === null) { this.el.timer.classList.remove('show'); return; }
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    this.el.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.el.timer.classList.add('show');
    this.el.timer.classList.toggle('urgent', t < 15);
  }
  bigText(main, kind, dur, sub = '') {
    this.el.bigMain.textContent = main; this.el.bigSub.textContent = sub;
    this.el.big.className = 'show ' + kind; this.bigT = dur;
  }
  hitMarker(kill, veh) { this.el.hit.className = 'show' + (kill ? ' kill' : ''); this.hitT = 0.15; if (!veh) this.game.audio.hitmarker(); }
  damageFlash(a) { this.dmgA = Math.min(0.85, this.dmgA + a / 40); }
  damageDir(src) {
    const p = this.game.player, yaw = this.game.cameraRig.yaw;
    const a = Math.atan2(src.x - p.pos.x, src.z - p.pos.z) - yaw;
    this.el.dirInd.style.transform = `translate(-50%,-50%) rotate(${-a}rad)`;
    this.el.dirInd.style.opacity = 1; this.dirT = 1;
  }
  flashWanted() { this.wantedFlashT = 2; }
  moneyPop(n) { this.notify(`<span style="color:#7dff9a">+$${n.toLocaleString()}</span>`, 1.5); }
  vehicleName(name) { this.el.vname.textContent = name; this.el.zone.textContent = name; this.el.zone.classList.add('show'); this.zoneT = 2.5; }
  weaponChanged() { this.weaponFlash = 1.5; }

  zoneName(x, z) {
    if (x > 432) return x > 460 && Math.abs(z) < 30 ? 'Starlight Pier' : 'Solano Beach';
    const i = Math.floor((x - CITY.X0) / CITY.P), j = Math.floor((z - CITY.Z0) / CITY.P);
    if (j >= 8 || z > CITY.Z1) return 'Docklands';
    if (i >= 9) return 'Ocean Drive';
    if (i >= 4 && i <= 7 && j >= 1 && j <= 4) return 'Downtown';
    if (i <= 2) return 'Palmetto';
    if (i === 5 && j === 5) return 'Palmera Park';
    return 'Midtown';
  }

  // ------------------------------------------------------------------ shop
  openShop() {
    const g = this.game, p = g.player;
    this.shopOpen = true; this.el.shop.classList.add('show');
    g.input.unlock();
    const items = [
      ['pistol', 'Viper 9 pistol', WEAPONS.pistol.price, () => p.giveWeapon('pistol', 36)],
      ['pistolAmmo', 'Viper 9 ammo ×36', WEAPONS.pistol.ammoPrice, () => p.giveWeapon('pistol', 36)],
      ['smg', 'Hornet SMG', WEAPONS.smg.price, () => p.giveWeapon('smg', 96)],
      ['shotgun', 'Breaker 12 shotgun', WEAPONS.shotgun.price, () => p.giveWeapon('shotgun', 18)],
      ['rifle', 'Kestrel AR rifle', WEAPONS.rifle.price, () => p.giveWeapon('rifle', 90)],
      ['grenade', 'Firecracker grenades ×4', WEAPONS.grenade.price, () => p.giveWeapon('grenade', 4)],
      ['armor', 'Body armor', 250, () => { p.armor = 100; }],
      ['health', 'Med kit', 120, () => { p.health = p.maxHealth; }],
    ];
    this.shopItems = items;
    this.el.shopList.innerHTML = items.map(([id, name, price], i) => `<div class="shopItem" data-i="${i}"><span class="k">${i + 1}</span><span class="n">${name}</span><span class="p">$${price}</span></div>`).join('');
    this.el.shopList.querySelectorAll('.shopItem').forEach((d) => d.addEventListener('click', () => this.buy(+d.dataset.i)));
  }
  buy(i) {
    const g = this.game, p = g.player, it = this.shopItems[i];
    if (!it) return;
    if (p.money < it[2]) { this.notify('Not enough cash.', 1.5); g.audio.empty(); return; }
    p.money -= it[2]; it[3](); g.audio.cash(); this.notify(`Bought ${it[1]}`, 1.5);
  }
  closeShop() { this.shopOpen = false; this.el.shop.classList.remove('show'); this.game.input.lock(); }

  toggleBigMap() {
    this.bigmapOpen = !this.bigmapOpen;
    this.el.bigmap.classList.toggle('show', this.bigmapOpen);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, p = g.player, el = this.el;
    // money counter rolls
    this.moneyShown += (p.money - this.moneyShown) * Math.min(1, dt * 8);
    if (Math.abs(p.money - this.moneyShown) < 1) this.moneyShown = p.money;
    el.money.textContent = '$' + String(Math.round(this.moneyShown)).padStart(8, '0');
    el.clock.textContent = g.env.timeString();
    el.hp.style.width = clamp(p.health / p.maxHealth, 0, 1) * 100 + '%';
    el.hp.classList.toggle('low', p.health < 30);
    el.ar.style.width = clamp(p.armor / 100, 0, 1) * 100 + '%';
    el.arWrap.style.opacity = p.armor > 0 ? 1 : 0.35;
    const def = p.weaponDef, w = p.inv[p.weaponId];
    el.weapon.textContent = def.name;
    el.wIcon.dataset.w = def.id;
    el.ammo.textContent = def.melee ? '' : def.thrown ? `×${w.clip + w.ammo}` : p.reloadT > 0 ? 'RELOADING' : `${w.clip} / ${w.ammo}`;
    // stars
    const lvl = g.police.level;
    this.wantedFlashT -= dt;
    const blink = (lvl > 0 && !g.police.seen && Math.floor(performance.now() / 400) % 2) || (this.wantedFlashT > 0 && Math.floor(performance.now() / 150) % 2);
    let s = '';
    for (let i = 0; i < 5; i++) s += `<span class="star ${i < lvl ? 'on' : ''} ${i < lvl && blink ? 'blink' : ''}">★</span>`;
    if (s !== this.starsHtml) { el.stars.innerHTML = s; this.starsHtml = s; }
    // crosshair
    const showCross = !p.dead && (p.aiming || (p.shootFaceT > 0 && !def.melee)) && !this.bigmapOpen;
    el.cross.classList.toggle('show', showCross);
    el.cross.style.setProperty('--spread', `${10 + p.bloom * 14 + (p.aiming ? 0 : 10)}px`);
    // speedo
    if (p.vehicle) {
      el.speedo.classList.add('show');
      el.speed.textContent = Math.round(Math.abs(p.vehicle.forwardSpeed()) * 3.6);
      el.vhp.style.width = clamp(p.vehicle.health / p.vehicle.def.health, 0, 1) * 100 + '%';
      el.vhp.classList.toggle('low', p.vehicle.health < 400);
      el.radio.textContent = g.audio.stationName();
    } else el.speedo.classList.remove('show');
    // timers
    if ((this.notifyT -= dt) <= 0) el.notify.classList.remove('show');
    if ((this.subT -= dt) <= 0) el.subtitle.classList.remove('show');
    if ((this.bigT -= dt) <= 0) el.big.classList.remove('show');
    if ((this.hintT -= dt) <= 0) el.hint.classList.remove('show');
    if ((this.hitT -= dt) <= 0) el.hit.classList.remove('show');
    if ((this.zoneT -= dt) <= 0) el.zone.classList.remove('show');
    this.dirT = (this.dirT || 0) - dt; el.dirInd.style.opacity = Math.max(0, this.dirT);
    this.dmgA = Math.max(0, this.dmgA - dt * 0.8);
    const lowHp = p.health < 30 && !p.dead ? 0.25 + Math.sin(performance.now() / 200) * 0.1 : 0;
    el.dmg.style.opacity = Math.max(this.dmgA, lowHp);
    // zone name
    const zn = this.zoneName(p.pos.x, p.pos.z);
    if (zn !== this.lastZone) { this.lastZone = zn; if (!p.vehicle || this.zoneT <= 0) { el.zone.textContent = zn; el.zone.classList.add('show'); this.zoneT = 2.5; } }
    this.drawMinimap();
    if (this.bigmapOpen) this.drawBigMap();
  }

  worldBlips() {
    const g = this.game, out = [];
    for (const b of g.blips) { const p = b.marker ? b.marker.pos : b.pos; if (b.marker && (b.marker.target.dead || b.marker.target.destroyed)) continue; out.push({ x: p.x, z: p.z, color: b.color, label: b.label, kind: b.kind, edge: true }); }
    for (const n of g.peds.list) {
      if (n.dead) continue;
      if (n.marker || (n.hostile && n.role === 'gang')) out.push({ x: n.pos.x, z: n.pos.z, color: '#ff3040', kind: 'enemy' });
      else if (n.role === 'police' && g.police.level > 0) out.push({ x: n.pos.x, z: n.pos.z, color: Math.floor(performance.now() / 250) % 2 ? '#3d7bff' : '#ff3040', kind: 'cop' });
    }
    for (const v of g.vehicles.list) if (v.police && g.police.level > 0 && !v.destroyed) out.push({ x: v.pos.x, z: v.pos.z, color: Math.floor(performance.now() / 250) % 2 ? '#3d7bff' : '#ff3040', kind: 'copcar' });
    if (g.police.heli && !g.police.heli.dead) out.push({ x: g.police.heli.pos.x, z: g.police.heli.pos.z, color: '#3d7bff', kind: 'copcar' });
    return out;
  }

  drawMinimap() {
    if (!this.mapCanvas) return;
    const g = this.game, ctx = this.miniCtx, S = this.el.mini.width, R = S / 2 - 6;
    const p = g.player, P = p.vehicle ? p.vehicle.pos : p.pos;
    const yaw = g.cameraRig.yaw;
    const speed = p.vehicle ? p.vehicle.speed : 0;
    const scale = (1.35 - Math.min(speed / 40, 1) * 0.65) * (S / 220);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#071a2e'; ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2);
    ctx.rotate(yaw + Math.PI);
    ctx.scale(scale, scale);
    ctx.drawImage(this.mapCanvas, -(P.x - MAP.x0), -(P.z - MAP.z0));
    ctx.restore();
    // blips
    const c = Math.cos(yaw + Math.PI), s = Math.sin(yaw + Math.PI);
    const toScreen = (x, z) => { const dx = (x - P.x) * scale, dz = (z - P.z) * scale; return [dx * c - dz * s, dx * s + dz * c]; };
    ctx.save(); ctx.translate(S / 2, S / 2);
    for (const b of this.worldBlips()) {
      let [x, y] = toScreen(b.x, b.z);
      const d = Math.hypot(x, y);
      if (d > R - 8) { if (!b.edge) continue; x = x / d * (R - 8); y = y / d * (R - 8); }
      if (b.kind === 'mission') {
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.label, x, y + 0.5);
      } else if (b.kind === 'shop') {
        ctx.fillStyle = '#111'; ctx.fillRect(x - 7, y - 7, 14, 14); ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.strokeRect(x - 7, y - 7, 14, 14);
        ctx.fillStyle = b.color; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.label, x, y + 0.5);
      } else {
        const r = b.kind === 'enemy' || b.kind === 'cop' ? 3.5 : 6;
        ctx.fillStyle = b.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // player arrow
    const pa = (p.vehicle ? p.vehicle.heading : p.yaw) - yaw;
    ctx.rotate(-pa);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // north indicator on the rim (north = -z)
    const dirN = toScreen(P.x, P.z - 1000); const dl = Math.hypot(dirN[0], dirN[1]);
    const Nx = S / 2 + dirN[0] / dl * (R - 2), Ny = S / 2 + dirN[1] / dl * (R - 2);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(Nx, Ny, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', Nx, Ny + 0.5);
    // ring
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2); ctx.stroke();
    // health/armor arcs around minimap
    const hp = clamp(p.health / p.maxHealth, 0, 1), ar = clamp(p.armor / 100, 0, 1);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(S / 2, S / 2, R + 2, Math.PI * 0.55, Math.PI * 1.45); ctx.stroke();
    ctx.strokeStyle = hp < 0.3 ? '#ff3b3b' : '#4dff88'; ctx.beginPath(); ctx.arc(S / 2, S / 2, R + 2, Math.PI * 1.45 - hp * Math.PI * 0.9, Math.PI * 1.45); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(S / 2, S / 2, R + 2, Math.PI * 1.55, Math.PI * 2.45); ctx.stroke();
    if (ar > 0) { ctx.strokeStyle = '#4da6ff'; ctx.beginPath(); ctx.arc(S / 2, S / 2, R + 2, Math.PI * 1.55, Math.PI * 1.55 + ar * Math.PI * 0.9); ctx.stroke(); }
  }

  drawBigMap() {
    const cv = this.el.bigmapCanvas, g = this.game;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    const sc = Math.min(W, H) / MAP.size;
    ctx.fillStyle = '#071a2e'; ctx.fillRect(0, 0, W, H);
    const ox = (W - MAP.size * sc) / 2, oy = (H - MAP.size * sc) / 2;
    ctx.drawImage(this.mapCanvas, ox, oy, MAP.size * sc, MAP.size * sc);
    const T = (x, z) => [ox + (x - MAP.x0) * sc, oy + (z - MAP.z0) * sc];
    for (const b of this.worldBlips()) {
      const [x, y] = T(b.x, b.z);
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x, y, b.kind === 'mission' || b.kind === 'shop' ? 9 : 5, 0, Math.PI * 2); ctx.fill();
      if (b.label) { ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.label.length <= 2 ? b.label : '', x, y + 0.5); if (b.label.length > 2) { ctx.fillText(b.label, x, y - 16); } }
    }
    const p = g.player, P = p.vehicle ? p.vehicle.pos : p.pos, [x, y] = T(P.x, P.z);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-(p.vehicle ? p.vehicle.heading : p.yaw) + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
