// Optional automated-test helpers (loaded only with ?test in the URL).
// They drive the game deterministically via game.simulate() so tests work even in a background tab.
export function installTestKit(game) {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const T = {
    // run game time in small chunks so async mission scripts can advance between chunks
    async run(sec, keys = [], opts = {}) {
      for (let t = 0; t < sec - 1e-6; t += 0.25) { game.simulate(Math.min(0.25, sec - t), keys, opts); await tick(); }
    },
    tap: (code) => T.run(0.05, [code]),
    aimAt(P) {
      const rig = game.cameraRig;
      for (let i = 0; i < 4; i++) {
        rig.update(0, { mouse: { dx: 0, dy: 0 }, down: () => false });
        const c = rig.camera.position, dx = P.x - c.x, dy = P.y - c.y, dz = P.z - c.z;
        rig.yaw = Math.atan2(dx, dz); rig.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      }
    },
    async fight(foes, maxT = 60) {
      const p = game.player; let t = 0;
      while (t < maxT && foes.some((f) => !f.dead) && !p.dead) {
        const tgt = foes.filter((f) => !f.dead).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
        const d = tgt.pos.distanceTo(p.pos);
        const A = () => T.aimAt({ x: tgt.pos.x, y: tgt.pos.y + 1.2, z: tgt.pos.z });
        A();
        if (p.inv[p.weaponId].clip === 0 && p.reloadT <= 0) await T.run(0.05, ['KeyR']);
        await T.run(0.2, d > 25 ? ['KeyW'] : [], { mouseRight: true, mouseLeft: d < 38, each: A });
        t += 0.2;
      }
      return { t: +t.toFixed(1), killed: foes.filter((f) => f.dead).length, of: foes.length, hp: Math.round(p.health), armor: Math.round(p.armor), dead: p.dead };
    },
    // start the mission with the given index by walking into its marker
    async startMission(i) {
      const M = game.missions, p = game.player;
      if (M.active) M.fail('test');
      await T.run(0.3);
      M.index = i; M.cooldown = 0; M.setupStart();
      if (p.vehicle) p.exitVehicle(true);
      p.pos.set(M.startPos.x, 0.15, M.startPos.z); p.vel.set(0, 0, 0);
      await T.run(0.5);
      return M.active && M.active.def.title;
    },
    // render one frame and upload a JPEG capture (canvas + simple HUD text overlay) to /__shot
    async shot(name, w = 1280, h = 720) {
      const r = game.renderer;
      const prevW = innerWidth, prevH = innerHeight;
      r.setPixelRatio(1); r.setSize(w, h, false); game.composer.setSize(w, h);
      game.cameraRig.camera.aspect = w / h; game.cameraRig.camera.updateProjectionMatrix();
      game.bloom.resolution.set(w / 2, h / 2);
      game.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
      game.frame(1 / 60);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(r.domElement, 0, 0, w, h);
      // composite the minimap so HUD placement can be reviewed too
      const mm = document.getElementById('minimap');
      if (document.getElementById('hud').classList.contains('show')) ctx.drawImage(mm, 26, h - 246, 220, 220);
      const data = c.toDataURL('image/jpeg', 0.85);
      game.applyQuality(game.quality);
      game.cameraRig.resize(); void prevW; void prevH;
      await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: data });
      return name;
    },
    objective: () => document.getElementById('objective').textContent,
    big: () => document.getElementById('bigMain').textContent + ' | ' + document.getElementById('bigSub').textContent,
  };
  window.T = T;
  import('./tests.js').then((m) => { m.installTests(game, T); T.ready = true; });
  return T;
}
