// Entry point: loading screen, title menu, pause menu wiring.
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

async function boot() {
  const game = new Game();
  window.game = game; // exposed for debugging / automated tests
  // test helper: hold keys for a duration
  window.hold = (codes, ms) => new Promise((r) => { codes.forEach((c) => game.input.simulate(c, true)); setTimeout(() => { codes.forEach((c) => game.input.simulate(c, false)); r(); }, ms); });
  window.tap = (code) => window.hold([code], 60);
  try {
    await game.init(async (text, p) => {
      $('loadText').textContent = text;
      $('loadFill').style.width = Math.round(p * 100) + '%';
      await nextFrame();
    });
  } catch (e) {
    console.error(e);
    $('loadText').textContent = 'Failed to start: ' + e.message;
    return;
  }
  $('loading').classList.remove('show');
  $('title').classList.add('show');
  game.state = 'title';
  if (game.hasSave()) $('btnContinue').style.display = '';
  $('qualitySel').value = game.quality;
  $('btnNew').onclick = () => game.start(false);
  $('btnContinue').onclick = () => game.start(true);
  $('btnResume').onclick = () => game.resume();
  $('btnSave').onclick = () => { game.save(); $('btnSave').textContent = 'Saved!'; setTimeout(() => ($('btnSave').textContent = 'Save Game'), 1200); };
  for (const id of ['qualitySel', 'qualitySel2']) $(id).onchange = (e) => { game.qualityLocked = true; game.applyQuality(e.target.value); };
  $('game').addEventListener('click', () => {
    if (game.state === 'playing' && !game.input.locked && !game.hud.shopOpen) game.input.lock();
  });
  addEventListener('keydown', (e) => {
    if (game.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) { e.preventDefault(); game.resume(); }
  });
  if (location.search.includes('test')) import('./testkit.js').then((m) => m.installTestKit(game));
  if (location.search.includes('autostart')) game.start(false);
  const upd = () => {
    if (game.state === 'paused') {
      const p = game.player;
      $('pauseStats').innerHTML = `Missions completed: ${game.missions.index}/${game.missions.defs.length} · Cash: $${p.money.toLocaleString()} · Kills: ${game.stats.kills}`;
      $('qualitySel2').value = game.quality;
    }
    setTimeout(upd, 500);
  };
  upd();
}
boot();
