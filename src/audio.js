// Fully procedural WebAudio sound: weapons, explosions, engine, siren, ambience, UI and a synthwave radio.
import { clamp } from './utils.js';

export class AudioSys {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.enabled = true;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.enabled = false; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.0; this.musicBus.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.setupAmbience();
    this.setupEngine();
    this.setupSiren();
    this.setupRadio();
  }
  loopNoise(buf, filterType, freq, gain) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
    return { src, f, g };
  }
  setupAmbience() {
    this.city = this.loopNoise(this.brown, 'lowpass', 500, 0.05);
    this.ocean = this.loopNoise(this.noise, 'lowpass', 700, 0);
    this.rain = this.loopNoise(this.noise, 'highpass', 1500, 0);
    this.wind = this.loopNoise(this.noise, 'bandpass', 400, 0);
  }
  setupEngine() {
    const ctx = this.ctx;
    this.eng = { o1: ctx.createOscillator(), o2: ctx.createOscillator(), o3: ctx.createOscillator(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    const e = this.eng;
    e.o1.type = 'sawtooth'; e.o2.type = 'sawtooth'; e.o3.type = 'square';
    e.o2.detune.value = 12; e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 2;
    e.g.gain.value = 0;
    const g3 = ctx.createGain(); g3.gain.value = 0.4;
    e.o1.connect(e.f); e.o2.connect(e.f); e.o3.connect(g3); g3.connect(e.f); e.f.connect(e.g); e.g.connect(this.sfx);
    e.o1.start(); e.o2.start(); e.o3.start();
    // tyre screech
    this.screech = this.loopNoise(this.noise, 'bandpass', 2200, 0);
    this.screech.f.Q.value = 6;
  }
  setupSiren() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 900;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lg = ctx.createGain(); lg.gain.value = 300; lfo.connect(lg); lg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(); lfo.start();
    this.siren = { o, lfo, g };
  }
  env(g, t, a, peak, dcy) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }
  spatial(pos) {
    if (!pos) return { vol: 1, pan: 0 };
    const L = this.listener, dx = pos.x - L.x, dz = pos.z - L.z, dy = (pos.y || 0) - L.y;
    const d = Math.hypot(dx, dy, dz);
    const vol = 1 / (1 + d * 0.06);
    // pan relative to listener facing
    const rx = -Math.cos(L.yaw), rz = Math.sin(L.yaw);
    const pan = d > 0.5 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
    return { vol, pan, d };
  }
  out(pos, gain = 1) {
    const ctx = this.ctx, s = this.spatial(pos);
    const g = ctx.createGain(); g.gain.value = gain * s.vol;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = s.pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    return { node: g, vol: s.vol, d: s.d };
  }
  noiseBurst(dest, t, dur, type, freq, peak, q = 1, start = 0) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(dest);
    this.env(g, t, 0.002, peak, dur);
    src.start(t, start + Math.random() * 1.5); src.stop(t + dur + 0.1);
    return f;
  }
  tone(dest, t, type, f0, f1, dur, peak) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain(); o.connect(g); g.connect(dest);
    this.env(g, t, 0.003, peak, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- one shots
  gunshot(kind, pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 1); if (o.vol < 0.03) return;
    const t = this.ctx.currentTime, d = o.node;
    const cfg = {
      pistol: [2200, 0.16, 0.9, 150], smg: [2800, 0.1, 0.7, 170], shotgun: [1200, 0.35, 1.2, 90], rifle: [2400, 0.2, 1.0, 120], heli: [2400, 0.2, 0.8, 120], punch: [600, 0.08, 0.6, 80],
    }[kind] || [2200, 0.16, 0.9, 150];
    this.noiseBurst(d, t, cfg[1], 'lowpass', cfg[0], cfg[2]);
    this.noiseBurst(d, t, cfg[1] * 2.5, 'bandpass', 500, cfg[2] * 0.35);
    this.tone(d, t, 'sine', cfg[3], 40, 0.12, cfg[2] * 0.8);
    if (o.d > 60) this.noiseBurst(d, t + 0.05, 0.5, 'lowpass', 400, 0.2);
  }
  empty() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.sfx, t, 'square', 1800, 1500, 0.03, 0.08); }
  reload() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.noiseBurst(this.sfx, t, 0.05, 'bandpass', 3000, 0.3, 4);
    this.noiseBurst(this.sfx, t + 0.35, 0.06, 'bandpass', 2500, 0.35, 4);
    this.tone(this.sfx, t + 0.4, 'square', 900, 700, 0.03, 0.1);
  }
  explosion(pos, size = 1) {
    if (!this.ctx) return;
    const o = this.out(pos, 1.6 * size), t = this.ctx.currentTime, d = o.node;
    const f = this.noiseBurst(d, t, 2.2, 'lowpass', 1200, 1.4);
    f.frequency.exponentialRampToValueAtTime(90, t + 1.8);
    this.tone(d, t, 'sine', 90, 25, 1.2, 1.5);
    this.noiseBurst(d, t, 0.25, 'highpass', 2000, 0.5);
  }
  thunder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.noiseBurst(this.sfx, t, 3.5, 'lowpass', 600, 0.9);
    f.frequency.exponentialRampToValueAtTime(60, t + 3);
    this.noiseBurst(this.sfx, t + 0.2, 2.5, 'lowpass', 200, 0.6);
  }
  crash(pos, strength = 1) {
    if (!this.ctx) return;
    const o = this.out(pos, clamp(strength, 0.2, 1.5)), t = this.ctx.currentTime;
    this.noiseBurst(o.node, t, 0.35, 'lowpass', 1500, 1);
    this.noiseBurst(o.node, t, 0.5, 'bandpass', 3500, 0.35, 8);
    this.tone(o.node, t, 'triangle', 180, 60, 0.25, 0.6);
  }
  thud(pos) { if (!this.ctx) return; const o = this.out(pos, 0.8), t = this.ctx.currentTime; this.tone(o.node, t, 'sine', 140, 50, 0.15, 0.8); this.noiseBurst(o.node, t, 0.1, 'lowpass', 800, 0.5); }
  horn(pos) {
    if (!this.ctx) return; const o = this.out(pos, 0.5), t = this.ctx.currentTime;
    for (const f of [392, 494]) { const os = this.ctx.createOscillator(); os.type = 'square'; os.frequency.value = f; const g = this.ctx.createGain(); os.connect(g); g.connect(o.node); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.setValueAtTime(0.25, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); os.start(t); os.stop(t + 0.5); }
  }
  pickup() { if (!this.ctx) return; const t = this.ctx.currentTime; [880, 1320, 1760].forEach((f, i) => this.tone(this.sfx, t + i * 0.05, 'square', f, f, 0.08, 0.12)); }
  cash() { if (!this.ctx) return; const t = this.ctx.currentTime; [1500, 2000].forEach((f, i) => this.tone(this.sfx, t + i * 0.07, 'triangle', f, f, 0.12, 0.25)); }
  hitmarker() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.sfx, t, 'square', 2400, 2000, 0.04, 0.08); }
  hurt() { if (!this.ctx) return; const t = this.ctx.currentTime; this.noiseBurst(this.sfx, t, 0.15, 'lowpass', 500, 0.6); }
  ui() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.sfx, t, 'sine', 700, 900, 0.06, 0.15); }
  splash(pos) { if (!this.ctx) return; const o = this.out(pos, 1), t = this.ctx.currentTime; this.noiseBurst(o.node, t, 0.6, 'lowpass', 1400, 0.8); }
  jingle(success) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = success ? [523, 659, 784, 1047, 784, 1047] : [440, 415, 392, 330];
    notes.forEach((f, i) => { this.tone(this.sfx, t + i * 0.13, 'sawtooth', f, f, 0.25, 0.18); this.tone(this.sfx, t + i * 0.13, 'square', f / 2, f / 2, 0.2, 0.08); });
  }
  wasted() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.sfx, t, 'sawtooth', 220, 55, 2.5, 0.35); this.noiseBurst(this.sfx, t, 2, 'lowpass', 300, 0.4); }

  // ---------------------------------------------------------------- continuous
  update(dt, state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.1) => param.setTargetAtTime(v, t, tc);
    // engine
    const e = this.eng;
    if (state.engine) {
      const rpm = state.engine.rpm, thr = state.engine.throttle;
      const base = 38 + rpm * 110;
      set(e.o1.frequency, base, 0.05); set(e.o2.frequency, base * 1.01, 0.05); set(e.o3.frequency, base / 2, 0.05);
      set(e.f.frequency, 300 + rpm * 1400 + thr * 900, 0.05);
      set(e.g.gain, 0.08 + thr * 0.08 + rpm * 0.04, 0.05);
      set(this.screech.g.gain, clamp(state.engine.slip, 0, 1) * 0.12, 0.05);
    } else { set(e.g.gain, 0, 0.1); set(this.screech.g.gain, 0, 0.05); }
    // siren
    set(this.siren.g.gain, clamp(state.siren || 0, 0, 1) * 0.08, 0.2);
    // ambience
    set(this.city.g.gain, 0.04 + (1 - (state.night || 0)) * 0.03, 0.5);
    set(this.ocean.g.gain, clamp(state.ocean || 0, 0, 1) * 0.12 * (0.6 + 0.4 * Math.sin(t * 0.5)), 0.3);
    set(this.rain.g.gain, (state.rain || 0) * 0.09, 0.5);
    set(this.wind.g.gain, clamp(state.speed || 0, 0, 1) * 0.08, 0.2);
    // radio
    set(this.musicBus.gain, state.radio ? 0.22 : 0, 0.4);
    this.tickRadio(state.radio);
  }

  // ---------------------------------------------------------------- synthwave radio
  setupRadio() {
    this.radio = { step: 0, next: 0, bpm: 104, station: 0 };
    this.stations = [
      { name: 'WAVE 88.3 — NEON NIGHTS', prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bpm: 104, lead: 'square' },
      { name: 'KRUSH 101.9 — SUNSET DRIVE', prog: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], bpm: 118, lead: 'sawtooth' },
      { name: 'RADIO OFF', prog: null },
    ];
  }
  nextStation() {
    if (!this.radio) return 'RADIO OFF';
    this.radio.station = (this.radio.station + 1) % this.stations.length;
    return this.stations[this.radio.station].name;
  }
  stationName() { return this.radio ? this.stations[this.radio.station].name : ''; }
  tickRadio(on) {
    const ctx = this.ctx, R = this.radio, st = this.stations[R.station];
    if (!on || !st.prog) { R.next = 0; return; }
    const spb = 60 / st.bpm / 4; // 16th notes
    if (R.next < ctx.currentTime) R.next = ctx.currentTime + 0.05;
    while (R.next < ctx.currentTime + 0.2) {
      const t = R.next, s = R.step % 64, bar = Math.floor(s / 16), chord = st.prog[bar];
      const dest = this.musicBus;
      const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
      // kick on quarters, snare on 2 & 4, hats on 8ths
      if (s % 4 === 0) this.tone(dest, t, 'sine', 120, 40, 0.18, 0.9);
      if (s % 8 === 4) this.noiseBurst(dest, t, 0.18, 'bandpass', 1800, 0.5);
      if (s % 2 === 0) this.noiseBurst(dest, t, 0.04, 'highpass', 7000, 0.18);
      // bass eighths
      if (s % 2 === 0) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(chord[0] - 24 + (s % 8 === 6 ? 12 : 0));
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 4;
        const g = ctx.createGain(); o.connect(f); f.connect(g); g.connect(dest);
        this.env(g, t, 0.005, 0.35, spb * 1.8); o.start(t); o.stop(t + spb * 2);
      }
      // arpeggio
      const note = chord[s % 3] + (Math.floor(s / 3) % 2 ? 12 : 0);
      this.tone(dest, t, st.lead, mtof(note), mtof(note), spb * 0.9, 0.06);
      // pad on bar start
      if (s % 16 === 0) for (const n of chord) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = (Math.random() - 0.5) * 14;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
        const g = ctx.createGain(); o.connect(f); f.connect(g); g.connect(dest);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 16);
        o.start(t); o.stop(t + spb * 16 + 0.1);
      }
      R.step++; R.next += spb;
    }
  }
}
