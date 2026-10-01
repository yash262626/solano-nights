// Day/night cycle, procedural sky dome, sun/moon lighting, image-based lighting, weather & rain.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rand } from './utils.js';

const KEYS = [
  { h: 0, zen: '#04050e', hor: '#1d1235', gnd: '#07060c', sun: '#8ea4ff', sunI: 0.0, hemi: 0.3, night: 1, fog: '#130d22' },
  { h: 4.8, zen: '#070a1c', hor: '#2d1c40', gnd: '#07060c', sun: '#8ea4ff', sunI: 0.0, hemi: 0.32, night: 1, fog: '#171027' },
  { h: 6.0, zen: '#233772', hor: '#ff8a6a', gnd: '#1a1418', sun: '#ffb07a', sunI: 0.9, hemi: 0.45, night: 0.55, fog: '#7a5a6e' },
  { h: 7.5, zen: '#3c73c6', hor: '#ffd1ae', gnd: '#2b2622', sun: '#ffd9b0', sunI: 2.0, hemi: 0.75, night: 0.08, fog: '#b9a9a8' },
  { h: 10, zen: '#2b6bd4', hor: '#a8cff2', gnd: '#393530', sun: '#fff4e2', sunI: 3.0, hemi: 0.9, night: 0, fog: '#a9c4dc' },
  { h: 15, zen: '#2c68cf', hor: '#b1d3f0', gnd: '#393530', sun: '#fff0d8', sunI: 2.9, hemi: 0.9, night: 0, fog: '#aac5dc' },
  { h: 17.4, zen: '#3a5db0', hor: '#ffc28c', gnd: '#2e2824', sun: '#ffc88f', sunI: 2.2, hemi: 0.7, night: 0.05, fog: '#c9a58f' },
  { h: 18.5, zen: '#35276e', hor: '#ff5a7e', gnd: '#1c1420', sun: '#ff7f55', sunI: 1.1, hemi: 0.5, night: 0.5, fog: '#8a4a6e' },
  { h: 19.4, zen: '#1a1144', hor: '#9a2d74', gnd: '#0f0a14', sun: '#c35a9a', sunI: 0.25, hemi: 0.33, night: 0.85, fog: '#3b1d45' },
  { h: 20.6, zen: '#080a24', hor: '#3a1a52', gnd: '#08060c', sun: '#8ea4ff', sunI: 0.0, hemi: 0.32, night: 1, fog: '#1b1030' },
  { h: 24, zen: '#04050e', hor: '#1d1235', gnd: '#07060c', sun: '#8ea4ff', sunI: 0.0, hemi: 0.3, night: 1, fog: '#130d22' },
];
for (const k of KEYS) for (const f of ['zen', 'hor', 'gnd', 'sun', 'fog']) k[f] = new THREE.Color(k[f]);

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir, uMoonDir;
uniform float uSunVis, uMoonVis, uStars, uTime, uCloud, uFlash, uNight;
varying vec3 vDir;
float hash3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x), mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h,0.,1.), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  float sd = max(dot(d, uSunDir), 0.);
  col += uSunColor * pow(sd, 5.) * 0.4 * uSunVis * (1.0 - t*0.5);
  col += uSunColor * pow(sd, 80.) * 0.9 * uSunVis;
  col += uSunColor * smoothstep(0.9991, 0.9995, sd) * 18. * uSunVis;
  float md = dot(d, uMoonDir);
  col += vec3(0.85,0.9,1.0) * smoothstep(0.99955, 0.9997, md) * 4.0 * uMoonVis;
  col += vec3(0.35,0.4,0.6) * pow(max(md,0.), 120.) * 0.5 * uMoonVis;
  if (h > 0.0) {
    vec3 sp = d * 160.;
    vec3 cell = floor(sp);
    float r = hash3(cell);
    if (r > 0.982) {
      vec3 c = cell + 0.5 + (vec3(hash3(cell+1.3), hash3(cell+2.7), hash3(cell+5.1)) - 0.5)*0.6;
      float dd = length(sp - c);
      float tw = 0.6 + 0.4*sin(uTime*2.5 + r*300.);
      col += vec3(0.9,0.95,1.0) * smoothstep(0.16, 0.0, dd) * uStars * tw * smoothstep(0., 0.3, h) * (1.0 - uCloud);
    }
    vec2 uv = d.xz / (h + 0.1) * 0.55 + vec2(uTime*0.0035, uTime*0.0018);
    float n = fbm(uv * 1.6);
    float cov = mix(0.6, 0.28, uCloud);
    float c = smoothstep(cov, cov + 0.28, n);
    float fade = smoothstep(0.0, 0.18, h);
    vec3 lit = uHorizon * 1.05 + uSunColor * 0.35 * uSunVis;
    vec3 cloudCol = mix(lit, uZenith * 0.7 + uHorizon * 0.25, clamp((n - cov) * 2.0, 0., 1.));
    cloudCol = mix(cloudCol, vec3(0.28,0.29,0.33) * (1.0 - uNight*0.85), uCloud*0.7);
    col = mix(col, cloudCol, c * fade * 0.92);
  }
  col = mix(col, uGround, smoothstep(0.0, -0.1, h));
  col += vec3(0.55,0.6,0.9) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Environment {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.hour = 18.2;           // start at sunset
    this.timeScale = 1 / 45;    // game hours per real second (1 game hour = 45s)
    this.time = 0;
    this.weather = { rain: 0, cloud: 0.15, targetRain: 0, targetCloud: 0.15, timer: 150, storm: false };
    this.wet = 0;
    this.flash = 0; this.nextLightning = 5;
    this.night = 0;
    this.envTimer = 0; this.lastEnvHour = -10;

    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
      uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 }, uCloud: { value: 0 }, uFlash: { value: 0 }, uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    // separate small copy used to render the environment map
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
    this.pmrem = new THREE.PMREMGenerator(game.renderer);
    this.envRT = null;

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 20; sc.far = 480;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.5);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.0018);

    this.buildRain();
    this.cur = { zen: new THREE.Color(), hor: new THREE.Color(), gnd: new THREE.Color(), sun: new THREE.Color(), fog: new THREE.Color(), sunI: 0, hemi: 0, night: 0 };
  }

  buildRain() {
    const N = 6000, size = 70, height = 40;
    const pos = new Float32Array(N * 2 * 3), top = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * size, y = Math.random() * height, z = Math.random() * size;
      pos.set([x, y, z, x, y, z], i * 6);
      top[i * 2] = 0; top[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('isTop', new THREE.BufferAttribute(top, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSize: { value: size }, uHeight: { value: height }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.8, 1.0) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime, uSize, uHeight; uniform vec3 uCam; attribute float isTop; varying float vA;
        void main(){
          vec3 p = position;
          float fall = uTime * 24.0;
          vec3 w;
          w.x = uCam.x + mod(p.x - uCam.x, uSize) - uSize*0.5;
          w.z = uCam.z + mod(p.z - uCam.z, uSize) - uSize*0.5;
          w.y = uCam.y + mod(p.y - fall - uCam.y, uHeight) - uHeight*0.5;
          w += isTop * vec3(0.25, 0.9, 0.12);
          vA = isTop;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `uniform float uAlpha; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, uAlpha * (0.3 + 0.7*vA)); }`,
    });
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  sample(h) {
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
    const c = this.cur;
    c.zen.copy(a.zen).lerp(b.zen, t); c.hor.copy(a.hor).lerp(b.hor, t); c.gnd.copy(a.gnd).lerp(b.gnd, t);
    c.sun.copy(a.sun).lerp(b.sun, t); c.fog.copy(a.fog).lerp(b.fog, t);
    c.sunI = lerp(a.sunI, b.sunI, t); c.hemi = lerp(a.hemi, b.hemi, t); c.night = lerp(a.night, b.night, t);
    return c;
  }

  setWeather(kind) {
    const w = this.weather;
    if (kind === 'clear') { w.targetRain = 0; w.targetCloud = 0.12; w.storm = false; }
    if (kind === 'cloudy') { w.targetRain = 0; w.targetCloud = 0.6; w.storm = false; }
    if (kind === 'rain') { w.targetRain = 0.7; w.targetCloud = 0.9; w.storm = false; }
    if (kind === 'storm') { w.targetRain = 1; w.targetCloud = 1; w.storm = true; }
    w.kind = kind; w.timer = rand(120, 260);
  }
  cycleWeather() {
    const order = ['clear', 'cloudy', 'rain', 'storm'];
    const k = order[(order.indexOf(this.weather.kind || 'clear') + 1) % order.length];
    this.setWeather(k);
    return k;
  }

  update(dt, focus, camera) {
    this.time += dt;
    this.hour = (this.hour + dt * this.timeScale) % 24;
    const w = this.weather;
    w.timer -= dt;
    if (w.timer <= 0) {
      const r = Math.random();
      this.setWeather(r < 0.55 ? 'clear' : r < 0.78 ? 'cloudy' : r < 0.93 ? 'rain' : 'storm');
    }
    w.rain += clamp(w.targetRain - w.rain, -dt * 0.05, dt * 0.05);
    w.cloud += clamp(w.targetCloud - w.cloud, -dt * 0.05, dt * 0.05);
    this.wet = clamp(this.wet + (w.rain > 0.1 ? dt * 0.03 : -dt * 0.008), 0, 1);

    const c = this.sample(this.hour);
    // sun & moon directions (sun rises over the ocean in the east)
    const a = ((this.hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.35).normalize();
    const moonDir = new THREE.Vector3(-Math.cos(a) * 0.9, -Math.sin(a), -0.3).normalize();
    if (moonDir.y < 0.15) moonDir.y = Math.max(moonDir.y, -0.2);
    const sunVis = smoothstep(-0.08, 0.05, sunDir.y);
    const moonVis = smoothstep(-0.05, 0.1, moonDir.y) * (1 - sunVis);

    const cloudDim = 1 - w.cloud * 0.55;
    const u = this.uniforms;
    u.uZenith.value.copy(c.zen).multiplyScalar(1 - w.cloud * 0.35);
    u.uHorizon.value.copy(c.hor).lerp(c.fog, w.cloud * 0.5);
    u.uGround.value.copy(c.gnd);
    u.uSunColor.value.copy(c.sun);
    u.uSunDir.value.copy(sunDir); u.uMoonDir.value.copy(moonDir);
    u.uSunVis.value = sunVis * (1 - w.cloud * 0.7); u.uMoonVis.value = moonVis * (1 - w.cloud * 0.8);
    u.uStars.value = c.night * (1 - w.cloud);
    u.uTime.value = this.time; u.uCloud.value = w.cloud; u.uNight.value = c.night;

    // lightning
    this.flash = Math.max(0, this.flash - dt * 6);
    if (w.storm && w.rain > 0.6) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.flash = 1; this.nextLightning = rand(4, 14);
        setTimeout(() => { this.flash = 0.7; }, 120);
        const delay = rand(0.4, 2.5);
        setTimeout(() => this.game.audio && this.game.audio.thunder(), delay * 1000);
      }
    }
    u.uFlash.value = this.flash * 0.6;

    // lights
    const useSun = sunDir.y > -0.02;
    const L = useSun ? sunDir : moonDir;
    this.sun.color.copy(useSun ? c.sun : new THREE.Color(0.55, 0.62, 0.95));
    this.sun.intensity = (useSun ? c.sunI * smoothstep(-0.02, 0.12, sunDir.y) : 0.55 * moonVis) * cloudDim + this.flash * 2;
    const f = focus;
    const snap = 150 / this.sun.shadow.mapSize.x;
    // optional shadow refresh throttling (medium quality renders shadows every other frame)
    this.shadowFrame = (this.shadowFrame || 0) + 1;
    this.sun.shadow.autoUpdate = !this.shadowThrottle;
    if (this.shadowThrottle && this.shadowFrame % 2 === 0) this.sun.shadow.needsUpdate = true;
    const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
    this.sun.position.set(fx + L.x * 250, f.y + Math.max(L.y, 0.15) * 250, fz + L.z * 250);
    this.sun.target.position.set(fx, f.y, fz);
    this.hemi.color.copy(c.zen).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.copy(c.gnd);
    this.hemi.intensity = c.hemi * (1 - w.cloud * 0.25) + this.flash * 1.5;

    // fog
    const fogC = c.fog.clone().lerp(new THREE.Color(0.35, 0.37, 0.42).multiplyScalar(1 - c.night * 0.8), w.cloud * 0.5);
    this.scene.fog.color.copy(fogC);
    this.scene.fog.density = 0.00115 + w.rain * 0.0035 + c.night * 0.0004;
    this.night = clamp(c.night + w.cloud * 0.25 * (1 - c.night), 0, 1);

    // sky follows camera
    this.sky.position.copy(camera.position);

    // rain
    this.rain.visible = w.rain > 0.02;
    this.rainU.uTime.value = this.time; this.rainU.uCam.value.copy(camera.position);
    this.rainU.uAlpha.value = w.rain * 0.45;
    this.rainU.uColor.value.setRGB(0.6, 0.7, 0.9).multiplyScalar(0.4 + (1 - c.night) * 0.6);

    // refresh image based lighting occasionally
    this.envTimer -= dt;
    if (this.envTimer <= 0 || Math.abs(this.hour - this.lastEnvHour) > 0.25) {
      this.envTimer = 4;
      this.lastEnvHour = this.hour;
      this.updateEnvMap();
    }
    this.envIntensity = lerp(1.0, 0.45, c.night);
  }

  updateEnvMap() {
    const old = this.envRT;
    const savedFlash = this.uniforms.uFlash.value;
    this.uniforms.uFlash.value = 0;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.uniforms.uFlash.value = savedFlash;
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
