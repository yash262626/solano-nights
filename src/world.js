// Procedural city: roads, districts, buildings, parks, beach, pier, docks and props.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, SIDES } from './builder.js';
import {
  CITY, WORLD, PLATFORMS, roadX, roadZ, blockRect, districtOf, LANDMARKS, isLandmark, terrainHeight,
} from './config.js';
import * as TX from './textures.js';
import { mulberry32, clamp } from './utils.js';

const CHUNK = 168;
const NEON = { pink: 0xff2f9a, cyan: 0x2ff3ff, purple: 0xa04dff, yellow: 0xffd23f, green: 0x3dff8a, orange: 0xff7a2f, red: 0xff2a3a, blue: 0x3d7bff };
const NEON_KEYS = Object.keys(NEON);

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.physics = game.physics;
    this.chunks = new Map();
    this.global = new Builder();
    this.inst = { palms: [], trees: [], lamps: [], benches: [], umbrellas: [], containers: [], bushes: [], bins: [], hydrants: [] };
    this.windowMats = []; this.neonMats = []; this.signMats = [];
    this.blocks = [];
    this.rings = [];
    this.locations = {};
    this.parkingSpots = [];
    this.animated = [];
    this.fountains = [];
    this.night = 0;
  }

  // ------------------------------------------------------------------ setup
  chunkFor(x, z) {
    const cx = Math.floor((x + 504) / CHUNK), cz = Math.floor((z + 504) / CHUNK);
    const k = cx * 100 + cz;
    let c = this.chunks.get(k);
    if (!c) {
      c = { b: new Builder(), group: new THREE.Group(), x: cx * CHUNK - 504 + CHUNK / 2, z: cz * CHUNK - 504 + CHUNK / 2 };
      this.chunks.set(k, c);
    }
    return c.b;
  }

  makeMaterials() {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const m = {};
    for (const name in TX.FACADE_STYLES) {
      const f = TX.makeFacade(name);
      const mat = std({ map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: f.roughnessMap, roughness: 1, metalness: f.style.metal });
      m['f_' + name] = mat; this.windowMats.push(mat);
    }
    const gravel = TX.makeRoofGravel();
    m.roof = std({ map: gravel.map, normalMap: gravel.normalMap, roughness: 0.95 });
    const tiles = TX.makeRoofTiles();
    m.roofTile = std({ map: tiles.map, normalMap: tiles.normalMap, roughness: 0.75 });
    m.trim = std({ color: 0xd9d4ca, roughness: 0.75 });
    m.trimDark = std({ color: 0x2b2d33, roughness: 0.5, metalness: 0.4 });
    m.metal = std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 });
    m.paintVC = std({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.2 });
    const shop = TX.makeShopfront();
    m.shopfront = std({ map: shop.map, emissiveMap: shop.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.25, metalness: 0.2 });
    this.shopMat = m.shopfront;
    const aw = TX.makeAwning();
    m.awning = std({ map: aw.map, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const atlas = TX.makeSignAtlas(); this.signRects = atlas.rects;
    m.sign = new THREE.MeshBasicMaterial({ map: atlas.map, color: 0xffffff, side: THREE.DoubleSide });
    m.sign.userData.noShadow = true;
    const vatlas = TX.makeVerticalSignAtlas(); this.vsignRects = vatlas.rects;
    m.vsign = new THREE.MeshBasicMaterial({ map: vatlas.map, color: 0xffffff, side: THREE.DoubleSide });
    m.vsign.userData.noShadow = true;
    this.signMats.push(m.sign, m.vsign);
    for (const k of NEON_KEYS) {
      const nm = new THREE.MeshBasicMaterial({ color: NEON[k] });
      nm.userData.base = new THREE.Color(NEON[k]); nm.userData.noShadow = true;
      m['neon_' + k] = nm; this.neonMats.push(nm);
    }
    const sw = TX.makeSidewalk();
    m.sidewalk = std({ map: sw.map, normalMap: sw.normalMap, roughness: 0.85 });
    const conc = TX.makeConcrete(14);
    m.curb = std({ map: conc.map, normalMap: conc.normalMap, roughness: 0.85, color: 0xbbbbbb });
    const conc2 = TX.makeConcrete(31, '#77736c');
    m.concreteGround = std({ map: conc2.map, normalMap: conc2.normalMap, roughness: 0.9 });
    m.seawall = std({ map: conc.map, normalMap: conc.normalMap, roughness: 0.9, color: 0x8a8378 });
    const road = TX.makeRoad();
    m.road = std({ map: road.map, normalMap: road.normalMap, roughness: 0.88 });
    const inter = TX.makeIntersection();
    m.inter = std({ map: inter.map, normalMap: inter.normalMap, roughness: 0.88 });
    this.roadMats = [m.road, m.inter];
    const pk = TX.makeParking();
    m.parking = std({ map: pk.map, roughness: 0.85 });
    this.roadMats.push(m.parking);
    const gr = TX.makeGrass();
    m.grass = std({ map: gr.map, normalMap: gr.normalMap, roughness: 1 });
    const sand = TX.makeSand();
    m.sand = std({ map: sand.map, normalMap: sand.normalMap, roughness: 0.95 });
    const wood = TX.makeWood();
    m.wood = std({ map: wood.map, normalMap: wood.normalMap, roughness: 0.8 });
    m.pool = std({ color: 0x2ad4e6, roughness: 0.05, metalness: 0.1, emissive: 0x19c6dc, emissiveIntensity: 0.1 });
    this.poolMat = m.pool;
    const leaf = TX.makeLeafCluster();
    m.hedge = std({ map: leaf.map, normalMap: leaf.normalMap, roughness: 0.9, color: 0x9ab87a });
    m.glassRail = std({ color: 0x9fd8ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.35 });
    m.glassRail.userData.noShadow = true;
    m.darkWindow = std({ color: 0x0c1116, roughness: 0.1, metalness: 0.6 });
    m.red = std({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2 });
    m.red.userData.noShadow = true; this.blinkMat = m.red;
    this.mats = m;
  }

  // ------------------------------------------------------------------ build
  build() {
    this.makeMaterials();
    this.buildGround();
    this.buildRoads();
    for (let i = 0; i < CITY.NX; i++) {
      this.rings.push([]);
      for (let j = 0; j < CITY.NZ; j++) this.buildBlock(i, j);
    }
    this.buildMargins();
    this.buildBeach();
    this.buildPier();
    this.buildDocksWaterfront();
    this.buildDistant();
    this.finalize();
    this.buildInstances();
  }

  buildGround() {
    // Island base: its sides are the sea wall
    const g = this.global;
    g.box(WORLD.LAND_MIN_X, -7, WORLD.LAND_MIN_Z, WORLD.BEACH_X, -0.02, WORLD.LAND_MAX_Z, { side: 'seawall', top: 'road', tw: 6, ttw: 14, skip: { px: true } });
    // Sea bed & water
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1f3a3a, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = -6.5; this.scene.add(bed);

    const wn = TX.makeWaterNormal();
    wn.repeat.set(160, 160);
    this.waterNormal = wn;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({
      color: 0x0b4f66, roughness: 0.06, metalness: 0.15, normalMap: wn, normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true, opacity: 0.86, envMapIntensity: 1.3,
    }));
    // blend two differently scaled/scrolling samples of the normal map to hide tiling
    this.waterTime = { value: 0 };
    water.material.onBeforeCompile = (sh) => {
      sh.uniforms.uWaterTime = this.waterTime;
      const chunk = THREE.ShaderChunk.normal_fragment_maps.replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
         vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 0.31 + vec2(-uWaterTime * 0.0021, uWaterTime * 0.0034) ).xyz * 2.0 - 1.0;
         vec3 mapN3 = texture2D( normalMap, vNormalMapUv * 2.7 + vec2(uWaterTime * 0.011, uWaterTime * 0.006) ).xyz * 2.0 - 1.0;
         mapN = normalize(vec3(mapN.xy + mapN2.xy * 1.3 + mapN3.xy * 0.5, mapN.z));`);
      sh.fragmentShader = 'uniform float uWaterTime;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', chunk);
    };
    water.rotation.x = -Math.PI / 2; water.position.y = WORLD.WATER_Y; water.receiveShadow = true;
    water.renderOrder = 1;
    this.water = water; this.scene.add(water);
  }

  buildRoads() {
    const g = this.global, h = CITY.HALF_RW, y = 0.02;
    for (let j = 0; j <= CITY.NZ; j++) {
      const z = roadZ(j);
      for (let i = 0; i < CITY.NX; i++) {
        const xa = roadX(i) + h, xb = roadX(i + 1) - h, len = xb - xa;
        // road along x: texture v along x, u across z
        g.poly('road', [[xa, y, z + h], [xb, y, z + h], [xb, y, z - h], [xa, y, z - h]], [[1, 0], [1, len / 14], [0, len / 14], [0, 0]]);
      }
    }
    for (let i = 0; i <= CITY.NX; i++) {
      const x = roadX(i);
      for (let j = 0; j < CITY.NZ; j++) {
        const za = roadZ(j) + h, zb = roadZ(j + 1) - h, len = zb - za;
        g.poly('road', [[x - h, y, zb], [x + h, y, zb], [x + h, y, za], [x - h, y, za]], [[0, len / 14], [1, len / 14], [1, 0], [0, 0]]);
      }
    }
    for (let i = 0; i <= CITY.NX; i++) for (let j = 0; j <= CITY.NZ; j++) {
      const x = roadX(i), z = roadZ(j);
      g.poly('inter', [[x - h, y, z + h], [x + h, y, z + h], [x + h, y, z - h], [x - h, y, z - h]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    // Parking spots along the curb lanes (both sides of each segment)
    for (let j = 0; j <= CITY.NZ; j++) for (let i = 0; i < CITY.NX; i++) {
      const z = roadZ(j);
      for (let x = roadX(i) + 16; x < roadX(i + 1) - 14; x += 9) {
        this.parkingSpots.push({ x, z: z + CITY.PARK_LANE, heading: -Math.PI / 2 });
        this.parkingSpots.push({ x, z: z - CITY.PARK_LANE, heading: Math.PI / 2 });
      }
    }
    for (let i = 0; i <= CITY.NX; i++) for (let j = 0; j < CITY.NZ; j++) {
      const x = roadX(i);
      for (let z = roadZ(j) + 16; z < roadZ(j + 1) - 14; z += 9) {
        this.parkingSpots.push({ x: x - CITY.PARK_LANE, z, heading: 0 });
        this.parkingSpots.push({ x: x + CITY.PARK_LANE, z, heading: Math.PI });
      }
    }
  }

  // Street furniture along the four curbs of a block.
  blockEdgeProps(r, i, j, rng, kind) {
    const edges = [
      { x: (r.x0 + r.x1) / 2, z: r.z0 + 0.9, ax: 'x', len: r.x1 - r.x0, yaw: Math.PI, road: 'j', idx: j },
      { x: (r.x0 + r.x1) / 2, z: r.z1 - 0.9, ax: 'x', len: r.x1 - r.x0, yaw: 0, road: 'j', idx: j + 1 },
      { x: r.x0 + 0.9, z: (r.z0 + r.z1) / 2, ax: 'z', len: r.z1 - r.z0, yaw: -Math.PI / 2, road: 'i', idx: i },
      { x: r.x1 - 0.9, z: (r.z0 + r.z1) / 2, ax: 'z', len: r.z1 - r.z0, yaw: Math.PI / 2, road: 'i', idx: i + 1 },
    ];
    for (const e of edges) {
      const boulevard = (e.road === 'j' && e.idx === 5) || (e.road === 'i' && e.idx === 5) || (e.road === 'i' && e.idx === 10);
      for (const off of [-22, 0, 22]) {
        const x = e.ax === 'x' ? e.x + off : e.x, z = e.ax === 'z' ? e.z + off : e.z;
        this.inst.lamps.push({ x, z, yaw: e.yaw });
      }
      for (const off of [-11, 11]) {
        const x = e.ax === 'x' ? e.x + off : e.x, z = e.ax === 'z' ? e.z + off : e.z;
        if (boulevard || kind === 'ocean' || kind === 'downtown') this.addPalm(x, z, rng, 0.9 + rng() * 0.3);
        else if (kind !== 'docks' && rng() < 0.55) this.addTree(x, z, rng, 0.8 + rng() * 0.3);
      }
      if (kind !== 'docks' && rng() < 0.6) {
        const off = -30 + rng() * 60;
        const x = e.ax === 'x' ? e.x + off : e.x, z = e.ax === 'z' ? e.z + off : e.z;
        this.inst.benches.push({ x, z, yaw: e.yaw + Math.PI });
      }
      if (rng() < 0.5) {
        const off = -33 + rng() * 66;
        const x = e.ax === 'x' ? e.x + off : e.x, z = e.ax === 'z' ? e.z + off : e.z;
        (rng() < 0.5 ? this.inst.bins : this.inst.hydrants).push({ x, z, yaw: rng() * 6 });
      }
    }
  }
  addPalm(x, z, rng, s = 1) {
    this.inst.palms.push({ x, z, yaw: rng() * 6.28, s, y: terrainHeight(x, z) });
    this.physics.addBox(x - 0.25, 0, z - 0.25, x + 0.25, 8, z + 0.25, 'tree');
  }
  addTree(x, z, rng, s = 1) {
    this.inst.trees.push({ x, z, yaw: rng() * 6.28, s, y: terrainHeight(x, z) });
    this.physics.addBox(x - 0.25, 0, z - 0.25, x + 0.25, 5, z + 0.25, 'tree');
  }

  buildBlock(i, j) {
    const r = blockRect(i, j), d = districtOf(i, j);
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const B = this.chunkFor(cx, cz);
    const rng = mulberry32(i * 1013 + j * 7919 + 17);
    B.box(r.x0, -0.3, r.z0, r.x1, 0.15, r.z1, { side: 'curb', top: d === 'docks' ? 'concreteGround' : 'sidewalk', tw: 4, ttw: d === 'docks' ? 8 : 4 });
    this.rings[i][j] = { x0: r.x0 + 2, x1: r.x1 - 2, z0: r.z0 + 2, z1: r.z1 - 2 };
    const L = { x0: r.x0 + 4, x1: r.x1 - 4, z0: r.z0 + 4, z1: r.z1 - 4 };
    let type = d;
    this.blockEdgeProps(r, i, j, rng, d);

    if (isLandmark(LANDMARKS.park, i, j)) { type = 'park'; this.buildPark(B, L, rng, i, j); }
    else if (isLandmark(LANDMARKS.parking, i, j)) { type = 'parking'; this.buildParking(B, L, rng, i, j); }
    else if (isLandmark(LANDMARKS.hospital, i, j)) { type = 'hospital'; this.buildHospital(B, L, rng); }
    else if (isLandmark(LANDMARKS.police, i, j)) { type = 'police'; this.buildPolice(B, L, rng); }
    else if (isLandmark(LANDMARKS.club, i, j)) { type = 'club'; this.buildClub(B, L, rng); }
    else if (isLandmark(LANDMARKS.garage, i, j)) { type = 'garage'; this.buildGarage(B, L, rng); }
    else if (isLandmark(LANDMARKS.gunshop, i, j)) { type = 'midtown'; this.buildGunShopBlock(B, L, rng); }
    else if (isLandmark(LANDMARKS.spray, i, j)) { type = 'spray'; this.buildSprayBlock(B, L, rng, i, j); }
    else if (isLandmark(LANDMARKS.hideout, i, j)) { type = 'docks'; this.buildHideout(B, L, rng); }
    else if (d === 'downtown') this.buildDowntown(B, L, rng);
    else if (d === 'ocean') this.buildOcean(B, L, rng, j);
    else if (d === 'residential') this.buildResidential(B, L, rng);
    else if (d === 'docks') this.buildDocks(B, L, rng);
    else this.buildMidtown(B, L, rng);
    this.blocks.push({ i, j, type, ...r });
  }

  // ------------------------------------------------------------------ buildings
  building(B, x0, z0, x1, z1, h, style, o = {}) {
    const base = o.base !== undefined ? o.base : 0.15;
    const st = TX.FACADE_STYLES[style];
    const rng = o.rng || Math.random;
    const uOff = Math.floor(rng() * 8) * (1 / st.cols);
    B.box(x0, base, z0, x1, base + h, z1, { side: 'f_' + style, top: o.roofMat || 'roof', tw: st.tileW, th: st.tileH, uOff, vBase: 0.15, ttw: 6 });
    this.physics.addBox(x0, base - 0.2, z0, x1, base + h, z1);
    const top = base + h;
    if (o.parapet !== false) {
      const t = 0.35, ph = 0.9, k = o.parapetMat || 'trim';
      B.box(x0, top, z0, x1, top + ph, z0 + t, { side: k, top: k });
      B.box(x0, top, z1 - t, x1, top + ph, z1, { side: k, top: k });
      B.box(x0, top, z0 + t, x0 + t, top + ph, z1 - t, { side: k, top: k });
      B.box(x1 - t, top, z0 + t, x1, top + ph, z1 - t, { side: k, top: k });
    }
    if (o.props !== false && x1 - x0 > 8 && z1 - z0 > 8) {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const w = 1.5 + rng() * 2.5, dd = 1.5 + rng() * 2, hh = 1 + rng() * 1.5;
        const px = x0 + 2 + rng() * (x1 - x0 - 4 - w), pz = z0 + 2 + rng() * (z1 - z0 - 4 - dd);
        B.box(px, top, pz, px + w, top + hh, pz + dd, { side: 'metal', top: 'metal' });
      }
      if (rng() < 0.3 && h < 45) { // water tank
        const px = x0 + 3 + rng() * (x1 - x0 - 6), pz = z0 + 3 + rng() * (z1 - z0 - 6);
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(px + ox * 1.1 - 0.1, top, pz + oz * 1.1 - 0.1, px + ox * 1.1 + 0.1, top + 2.5, pz + oz * 1.1 + 0.1, { side: 'trimDark' });
        B.box(px - 1.5, top + 2.5, pz - 1.5, px + 1.5, top + 6, pz + 1.5, { side: 'wood', top: 'trimDark', tw: 4 });
      }
    }
    if (o.shops) this.shopFronts(B, x0, z0, x1, z1, o.shops, rng, base);
    if (o.neonTrim) this.neonTrim(B, x0, z0, x1, z1, top + (o.parapet === false ? 0 : 0.9), o.neonTrim);
    return top;
  }
  neonTrim(B, x0, z0, x1, z1, y, color) {
    const k = 'neon_' + color, t = 0.14;
    B.box(x0 - t, y - t, z0 - t, x1 + t, y, z0, { side: k });
    B.box(x0 - t, y - t, z1, x1 + t, y, z1 + t, { side: k });
    B.box(x0 - t, y - t, z0, x0, y, z1, { side: k });
    B.box(x1, y - t, z0, x1 + t, y, z1, { side: k });
  }
  // sides: object {px:true,...} for faces that front a street
  shopFronts(B, x0, z0, x1, z1, sides, rng, base = 0.15) {
    const AW = [[0.9, 0.2, 0.3], [0.1, 0.55, 0.6], [0.95, 0.75, 0.2], [0.2, 0.35, 0.8], [0.3, 0.7, 0.35], [0.85, 0.35, 0.65], [0.95, 0.5, 0.25]];
    for (const name in sides) {
      if (!sides[name]) continue;
      const s = SIDES[name];
      const isX = s.n[0] !== 0;
      const faceW = isX ? z1 - z0 : x1 - x0;
      if (faceW < 7) continue;
      const fc = isX ? (name === 'px' ? x1 : x0) : (name === 'pz' ? z1 : z0);
      const mid = isX ? (z0 + z1) / 2 : (x0 + x1) / 2;
      // storefront band
      const bd = 0.22;
      if (isX) {
        const a = Math.min(fc, fc + s.n[0] * bd), b = Math.max(fc, fc + s.n[0] * bd);
        B.box(a, base, z0 + 0.5, b, base + 4, z1 - 0.5, { side: 'shopfront', top: 'trimDark', tw: 8, th: 4, vBase: base });
      } else {
        const a = Math.min(fc, fc + s.n[2] * bd), b = Math.max(fc, fc + s.n[2] * bd);
        B.box(x0 + 0.5, base, a, x1 - 0.5, base + 4, b, { side: 'shopfront', top: 'trimDark', tw: 8, th: 4, vBase: base });
      }
      // shops every ~9m: awning + sign
      const n = Math.max(1, Math.floor(faceW / 9)), segW = faceW / n;
      for (let k = 0; k < n; k++) {
        const c = mid - faceW / 2 + segW * (k + 0.5);
        const col = AW[Math.floor(rng() * AW.length)];
        const hw = segW / 2 - 0.4, out = 1.9;
        // build awning as slanted quad (CCW from above/outside)
        const alongVec = s.r; // right vector along facade
        const pt = (al, od, y) => [
          (isX ? fc : c) + alongVec[0] * al + s.n[0] * od,
          y,
          (isX ? c : fc) + alongVec[2] * al + s.n[2] * od,
        ];
        const top0 = base + 4.6, top1 = base + 3.9;
        B.poly('awning', [pt(-hw, 0.25, top0), pt(hw, 0.25, top0), pt(hw, out, top1), pt(-hw, out, top1)], [[0, 0], [hw / 2, 0], [hw / 2, 1], [0, 1]], col, true);
        B.poly('awning', [pt(-hw, out, top1), pt(hw, out, top1), pt(hw, out, top1 - 0.45), pt(-hw, out, top1 - 0.45)], [[0, 0], [hw / 2, 0], [hw / 2, 0.3], [0, 0.3]], col);
        // sign above the awning
        const R = this.signRects[Math.floor(rng() * this.signRects.length)];
        const sw = Math.min(segW - 1.5, 6), sh = sw / 4;
        const scc = pt(0, 0.3, base + 5.2 + sh / 2);
        B.face('sign', scc, s.r, [0, 1, 0], sw / 2, sh / 2, s.n, R.u0, R.u1, R.v0, R.v1);
      }
    }
  }
  streetSides(L, x0, z0, x1, z1) {
    const e = 0.6;
    return { px: Math.abs(x1 - L.x1) < e, nx: Math.abs(x0 - L.x0) < e, pz: Math.abs(z1 - L.z1) < e, nz: Math.abs(z0 - L.z0) < e };
  }
  splitLot(L, rng, gap = 4) {
    const w = L.x1 - L.x0, d = L.z1 - L.z0, r = rng();
    const hx = (w - gap) / 2, hz = (d - gap) / 2;
    if (r < 0.45) return [
      { x0: L.x0, z0: L.z0, x1: L.x0 + hx, z1: L.z0 + hz }, { x0: L.x1 - hx, z0: L.z0, x1: L.x1, z1: L.z0 + hz },
      { x0: L.x0, z0: L.z1 - hz, x1: L.x0 + hx, z1: L.z1 }, { x0: L.x1 - hx, z0: L.z1 - hz, x1: L.x1, z1: L.z1 }];
    if (r < 0.7) return [{ x0: L.x0, z0: L.z0, x1: L.x0 + hx, z1: L.z1 }, { x0: L.x1 - hx, z0: L.z0, x1: L.x1, z1: L.z1 }];
    if (r < 0.9) return [{ x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z0 + hz }, { x0: L.x0, z0: L.z1 - hz, x1: L.x1, z1: L.z1 }];
    return [{ x0: L.x0, z0: L.z0, x1: L.x0 + hx, z1: L.z1 },
      { x0: L.x1 - hx, z0: L.z0, x1: L.x1, z1: L.z0 + hz }, { x0: L.x1 - hx, z0: L.z1 - hz, x1: L.x1, z1: L.z1 }];
  }
  alleyGround(B, L) { B.box(L.x0, 0.15, L.z0, L.x1, 0.16, L.z1, { top: 'concreteGround', ttw: 8 }); }

  buildMidtown(B, L, rng) {
    this.alleyGround(B, L);
    const styles = ['concrete', 'brick', 'stucco', 'decoWhite', 'decoPeach', 'decoMint', 'tealGlass', 'brick', 'stuccoBlue', 'decoLav'];
    for (const p of this.splitLot(L, rng)) {
      const floors = 3 + Math.floor(rng() * rng() * 9);
      const style = styles[Math.floor(rng() * styles.length)];
      const sides = this.streetSides(L, p.x0, p.z0, p.x1, p.z1);
      this.building(B, p.x0, p.z0, p.x1, p.z1, floors * 3.5, style, { rng, shops: sides, neonTrim: rng() < 0.25 ? NEON_KEYS[Math.floor(rng() * NEON_KEYS.length)] : null });
      if (rng() < 0.3) this.inst.bins.push({ x: (p.x0 + p.x1) / 2, z: p.z1 + 1.5, yaw: 0 });
    }
  }
  buildGunShopBlock(B, L, rng) {
    this.alleyGround(B, L);
    const w = L.x1 - L.x0;
    // west half: gun shop (faces west street)
    const x1 = L.x0 + (w - 4) / 2;
    this.building(B, L.x0, L.z0, x1, L.z1, 10.5, 'brick', { rng, shops: { nz: true, pz: true } });
    // storefront facing west with custom sign
    B.box(L.x0 - 0.22, 0.15, L.z0 + 10, L.x0, 4.15, L.z1 - 10, { side: 'shopfront', top: 'trimDark', tw: 8, th: 4, vBase: 0.15 });
    this.addTextSign(B, 'IRONCLAD ARMS', '#ff5a3c', L.x0 - 0.3, 6, (L.z0 + L.z1) / 2, 'nx', 14, 2.6, 'GUNS · AMMO · ARMOR');
    this.building(B, x1 + 4, L.z0, L.x1, L.z1, 24.5, 'concrete', { rng, shops: this.streetSides(L, x1 + 4, L.z0, L.x1, L.z1) });
    this.locations.gunshop = { x: L.x0 - 2.5, z: (L.z0 + L.z1) / 2, heading: -Math.PI / 2 };
  }
  // A unique text sign rendered to its own texture.
  addTextSign(B, text, color, x, y, z, side, w, h, sub = null) {
    const key = 'txt_' + text;
    if (!this.mats[key]) {
      const t = TX.makeTextSign(text, color, 1024, Math.round(1024 * h / w), '#07070b', sub);
      const mat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
      mat.userData.noShadow = true;
      this.mats[key] = mat; this.signMats.push(mat);
    }
    const s = SIDES[side];
    B.face(key, [x, y, z], s.r, [0, 1, 0], w / 2, h / 2, s.n, 0, 1, 0, 1);
  }

  buildDowntown(B, L, rng) {
    B.box(L.x0, 0.15, L.z0, L.x1, 0.17, L.z1, { top: 'sidewalk', ttw: 4 });
    const styles = ['glass', 'darkGlass', 'tealGlass', 'concrete', 'glass'];
    const two = rng() < 0.5;
    const towers = two
      ? (rng() < 0.5
        ? [{ x0: L.x0, z0: L.z0, x1: L.x0 + 27, z1: L.z1 }, { x0: L.x1 - 27, z0: L.z0, x1: L.x1, z1: L.z1 }]
        : [{ x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z0 + 27 }, { x0: L.x0, z0: L.z1 - 27, x1: L.x1, z1: L.z1 }])
      : [{ x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z1 }];
    for (const t of towers) {
      const style = styles[Math.floor(rng() * styles.length)];
      // podium
      const podH = 10.5;
      this.building(B, t.x0, t.z0, t.x1, t.z1, podH, 'concrete', { rng, shops: this.streetSides(L, t.x0, t.z0, t.x1, t.z1), props: false });
      let x0 = t.x0 + 4, z0 = t.z0 + 4, x1 = t.x1 - 4, z1 = t.z1 - 4;
      let base = 0.15 + podH + 0.9;
      const total = (two ? 45 : 70) + rng() * (two ? 90 : 110);
      const tiers = 1 + Math.floor(rng() * 3);
      let remaining = total;
      for (let k = 0; k < tiers; k++) {
        const h = Math.round((k === tiers - 1 ? remaining : remaining * (0.5 + rng() * 0.2)) / 3.5) * 3.5;
        remaining -= h;
        const neon = rng() < 0.7 ? NEON_KEYS[Math.floor(rng() * NEON_KEYS.length)] : null;
        const top = this.building(B, x0, z0, x1, z1, h, style, { rng, base, props: k === tiers - 1, neonTrim: neon, parapetMat: 'trimDark' });
        base = top + 0.9;
        const ins = 2.5 + rng() * 2;
        if (x1 - x0 - ins * 2 < 10 || z1 - z0 - ins * 2 < 10) break;
        x0 += ins; z0 += ins; x1 -= ins; z1 -= ins;
      }
      // spire with aircraft warning light
      if (rng() < 0.6) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sh = 8 + rng() * 14;
        B.box(cx - 0.25, base, cz - 0.25, cx + 0.25, base + sh, cz + 0.25, { side: 'metal' });
        B.box(cx - 0.4, base + sh, cz - 0.4, cx + 0.4, base + sh + 0.8, cz + 0.4, { side: 'red', top: 'red' });
      }
    }
    // plaza palms between towers
    for (let k = 0; k < 4; k++) this.addPalm(L.x0 + 6 + rng() * (L.x1 - L.x0 - 12), L.z0 + 6 + rng() * (L.z1 - L.z0 - 12), rng);
  }

  buildOcean(B, L, rng, j) {
    this.alleyGround(B, L);
    const styles = ['decoPink', 'decoMint', 'decoLav', 'decoWhite', 'decoPeach'];
    // back row (west half) generic mid-rise, front row hotels facing Ocean Drive (east)
    const midX = L.x0 + 26;
    this.building(B, L.x0, L.z0, midX - 2, L.z1, (3 + Math.floor(rng() * 4)) * 3.5, pick(styles, rng), { rng, shops: { nx: true } });
    const n = 3, gap = 3, w = (L.z1 - L.z0 - gap * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const z0 = L.z0 + k * (w + gap), z1 = z0 + w;
      const floors = 3 + Math.floor(rng() * 4);
      const style = styles[(j * 3 + k) % styles.length];
      const neon = NEON_KEYS[(j + k * 2) % NEON_KEYS.length];
      const top = this.building(B, midX + 2, z0, L.x1, z1, floors * 3.5, style, { rng, shops: { px: true, nz: k === 0, pz: k === n - 1 }, neonTrim: neon });
      // floor-line neon strip on the ocean face
      const nk = 'neon_' + NEON_KEYS[(j * 2 + k + 3) % NEON_KEYS.length];
      for (let f = 2; f <= floors; f += 2) B.box(L.x1, 0.15 + f * 3.5 - 0.1, z0 + 0.5, L.x1 + 0.12, 0.15 + f * 3.5 + 0.04, z1 - 0.5, { side: nk });
      // vertical hotel sign
      if (floors >= 4) {
        const R = this.vsignRects[(j * 3 + k) % this.vsignRects.length];
        const sh = Math.min(floors * 3.5 - 6, 14), zc = z0 + 2.2, yc = 0.15 + 5.5 + sh / 2;
        B.box(L.x1, yc - sh / 2, zc - 0.12, L.x1 + 2.6, yc + sh / 2, zc + 0.12, { side: 'trimDark' });
        B.face('vsign', [L.x1 + 1.35, yc, zc + 0.13], [1, 0, 0], [0, 1, 0], 1.25, sh / 2, [0, 0, 1], R.u0, R.u1, R.v0, R.v1);
        B.face('vsign', [L.x1 + 1.35, yc, zc - 0.13], [-1, 0, 0], [0, 1, 0], 1.25, sh / 2, [0, 0, -1], R.u0, R.u1, R.v0, R.v1);
      }
      // cafe umbrellas on the sidewalk in front
      for (let u = 0; u < 2; u++) this.inst.umbrellas.push({ x: L.x1 + 2.2, z: z0 + 3 + u * (w - 6), s: 0.8, yaw: rng() * 6, y: 0.15, color: pick([[1, 0.3, 0.5], [0.2, 0.8, 0.8], [1, 0.85, 0.3], [0.9, 0.9, 0.9]], rng) });
      void top;
    }
  }

  buildResidential(B, L, rng) {
    B.box(L.x0, 0.15, L.z0, L.x1, 0.17, L.z1, { top: 'grass', ttw: 6 });
    const styles = ['stucco', 'stuccoBlue', 'stuccoYel', 'decoPeach', 'decoMint'];
    const cols = 3, colW = (L.x1 - L.x0) / cols;
    for (const row of [0, 1]) {
      for (let c = 0; c < cols; c++) {
        const hw = 9 + rng() * 3, hd = 9 + rng() * 3;
        const cx = L.x0 + colW * (c + 0.5) + (rng() - 0.5) * 2;
        const z0 = row === 0 ? L.z0 + 4 : L.z1 - 4 - hd;
        const x0 = cx - hw / 2, x1 = cx + hw / 2, z1 = z0 + hd;
        const floors = rng() < 0.4 ? 2 : 1;
        const style = styles[Math.floor(rng() * styles.length)];
        const top = this.building(B, x0, z0, x1, z1, floors * 3.5, style, { rng, parapet: false, props: false, roofMat: 'roof' });
        this.hipRoof(B, x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, top, 2.2 + rng());
        // pool in back yard
        if (rng() < 0.45) {
          const pz0 = row === 0 ? z1 + 3 : z0 - 8, px0 = cx - 3;
          B.box(px0 - 0.4, 0.15, pz0 - 0.4, px0 + 6.4, 0.3, pz0 + 4.4, { side: 'trim', top: 'trim' });
          B.box(px0, 0.15, pz0, px0 + 6, 0.31, pz0 + 4, { top: 'pool', ttw: 6 });
        }
        if (rng() < 0.7) this.addPalm(x1 + 2, row === 0 ? z0 - 2 : z1 + 2, rng, 0.8);
        if (rng() < 0.5) this.inst.bushes.push({ x: x0 - 1, z: row === 0 ? z0 - 1.5 : z1 + 1.5, s: 1 + rng(), yaw: rng() * 6, y: 0.15 });
      }
    }
    // low front walls
    for (const z of [L.z0 + 0.2, L.z1 - 0.2]) {
      for (let x = L.x0; x < L.x1 - 6; x += 10.3) {
        B.box(x, 0.15, z - 0.15, x + 6, 0.9, z + 0.15, { side: 'trim', top: 'trim' });
        this.physics.addBox(x, 0, z - 0.15, x + 6, 0.9, z + 0.15, 'wall');
      }
    }
  }
  hipRoof(B, x0, z0, x1, z1, y, rh) {
    const w = x1 - x0, d = z1 - z0, t = 3;
    const uv = (p) => [p[0] / t, p[2] / t];
    const P = (a) => a;
    if (w >= d) {
      const zm = (z0 + z1) / 2, ra = [x0 + d / 2, y + rh, zm], rb = [x1 - d / 2, y + rh, zm];
      const q = [
        [[x0, y, z1], [x1, y, z1], rb, ra], // south
        [[x1, y, z0], [x0, y, z0], ra, rb], // north
      ];
      for (const f of q) B.poly('roofTile', f.map(P), f.map(uv), undefined, true);
      B.poly('roofTile', [[x1, y, z1], [x1, y, z0], rb], [[x1, y, z1], [x1, y, z0], rb].map(uv), undefined, true);
      B.poly('roofTile', [[x0, y, z0], [x0, y, z1], ra], [[x0, y, z0], [x0, y, z1], ra].map(uv), undefined, true);
    } else {
      const xm = (x0 + x1) / 2, ra = [xm, y + rh, z0 + w / 2], rb = [xm, y + rh, z1 - w / 2];
      const q = [
        [[x1, y, z1], [x1, y, z0], ra, rb], // east
        [[x0, y, z0], [x0, y, z1], rb, ra], // west
      ];
      for (const f of q) B.poly('roofTile', f, f.map(uv), undefined, true);
      B.poly('roofTile', [[x0, y, z1], [x1, y, z1], rb], [[x0, y, z1], [x1, y, z1], rb].map(uv), undefined, true);
      B.poly('roofTile', [[x1, y, z0], [x0, y, z0], ra], [[x1, y, z0], [x0, y, z0], ra].map(uv), undefined, true);
    }
  }

  buildDocks(B, L, rng) {
    const styles = ['warehouse', 'warehouseRed'];
    const r = rng();
    if (r < 0.55) {
      const x1 = L.x0 + 34;
      this.building(B, L.x0, L.z0 + 4, x1, L.z1 - 4, 10 + Math.floor(rng() * 3) * 2, styles[Math.floor(rng() * 2)], { rng, parapet: false });
      this.containerYard(B, x1 + 4, L.z0, L.x1, L.z1, rng);
    } else {
      this.containerYard(B, L.x0, L.z0, L.x1 - 30, L.z1, rng);
      this.building(B, L.x1 - 26, L.z0 + 2, L.x1, L.z1 - 2, 12, styles[Math.floor(rng() * 2)], { rng, parapet: false });
    }
    this.fence(B, L, rng);
  }
  containerYard(B, x0, z0, x1, z1, rng) {
    const cw = 2.6, cl = 12.2, ch = 2.6;
    const palette = [[0.75, 0.2, 0.15], [0.15, 0.35, 0.65], [0.2, 0.55, 0.35], [0.85, 0.55, 0.15], [0.55, 0.55, 0.58], [0.6, 0.15, 0.35], [0.1, 0.5, 0.55]];
    for (let x = x0 + 1; x + cw < x1 - 1; x += cw + 0.4) {
      for (let z = z0 + 2; z + cl < z1 - 2; z += cl + 4) {
        if (rng() < 0.25) continue;
        const stack = 1 + Math.floor(rng() * 3);
        for (let s = 0; s < stack; s++) this.inst.containers.push({ x: x + cw / 2, z: z + cl / 2, y: 0.15 + s * ch, yaw: 0, color: palette[Math.floor(rng() * palette.length)] });
        this.physics.addBox(x, 0, z, x + cw, 0.15 + stack * ch, z + cl, 'container');
      }
    }
  }
  fence(B, L, rng) {
    // chain-link style fence segments with gaps at the middle of each side
    const h = 2.2, t = 0.08;
    const segs = [
      [L.x0, L.z0 - 0.5, (L.x0 + L.x1) / 2 - 5, L.z0 - 0.5], [(L.x0 + L.x1) / 2 + 5, L.z0 - 0.5, L.x1, L.z0 - 0.5],
      [L.x0, L.z1 + 0.5, (L.x0 + L.x1) / 2 - 5, L.z1 + 0.5], [(L.x0 + L.x1) / 2 + 5, L.z1 + 0.5, L.x1, L.z1 + 0.5],
    ];
    for (const [ax, az, bx] of segs) {
      B.box(ax, 0.15, az - t, bx, 0.15 + h, az + t, { side: 'glassRail' });
      for (let x = ax; x <= bx; x += 3) B.box(x - 0.05, 0.15, az - 0.05, x + 0.05, 0.15 + h, az + 0.05, { side: 'trimDark' });
      this.physics.addBox(ax, 0, az - 0.1, bx, h, az + 0.1, 'fence');
    }
    void rng;
  }

  buildPark(B, L, rng, i, j) {
    B.box(L.x0, 0.15, L.z0, L.x1, 0.17, L.z1, { top: 'grass', ttw: 6 });
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    // cross paths
    B.box(cx - 2, 0.17, L.z0, cx + 2, 0.18, L.z1, { top: 'sidewalk', ttw: 4 });
    B.box(L.x0, 0.17, cz - 2, L.x1, 0.18, cz + 2, { top: 'sidewalk', ttw: 4 });
    // fountain
    const big = i === 5 && j === 5;
    const fr = big ? 6 : 3.5;
    const seg = 16;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const mx = cx + Math.cos((a0 + a1) / 2) * fr, mz = cz + Math.sin((a0 + a1) / 2) * fr;
      const len = 2 * fr * Math.sin(Math.PI / seg) + 0.1;
      B.obox('trim', mx, 0.5, mz, 0.6, 0.7, len, -(a0 + a1) / 2 + Math.PI / 2 * 0, undefined);
    }
    B.box(cx - fr, 0.18, cz - fr, cx + fr, 0.5, cz + fr, { top: 'pool', ttw: 6 });
    B.box(cx - 0.6, 0.5, cz - 0.6, cx + 0.6, 2.4, cz + 0.6, { side: 'trim', top: 'trim' });
    this.physics.addBox(cx - fr - 0.3, 0, cz - fr - 0.3, cx + fr + 0.3, 0.85, cz + fr + 0.3, 'fountain');
    this.fountains.push({ x: cx, z: cz, y: 2.4, r: fr });
    // trees / palms / benches / hedges
    for (let k = 0; k < (big ? 26 : 14); k++) {
      const x = L.x0 + 3 + rng() * (L.x1 - L.x0 - 6), z = L.z0 + 3 + rng() * (L.z1 - L.z0 - 6);
      if (Math.abs(x - cx) < fr + 4 && Math.abs(z - cz) < fr + 4) continue;
      if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      if (rng() < 0.5) this.addPalm(x, z, rng, 0.8 + rng() * 0.4); else this.addTree(x, z, rng, 0.9 + rng() * 0.5);
    }
    for (let k = 0; k < 10; k++) {
      const x = L.x0 + 2 + rng() * (L.x1 - L.x0 - 4), z = L.z0 + 2 + rng() * (L.z1 - L.z0 - 4);
      if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
      this.inst.bushes.push({ x, z, s: 1 + rng() * 1.5, yaw: rng() * 6, y: 0.17 });
    }
    for (const [dx, dz, yaw] of [[3, 12, -Math.PI / 2], [-3, -12, Math.PI / 2], [12, 3, Math.PI], [-12, -3, 0]]) this.inst.benches.push({ x: cx + dx, z: cz + dz, yaw });
    for (const [dx, dz] of [[4, 20], [-4, -20], [20, -4], [-20, 4]]) this.inst.lamps.push({ x: cx + dx, z: cz + dz, yaw: 0, park: true });
    if (big) this.locations.park = { x: cx, z: cz - fr - 3 };
  }
  buildParking(B, L, rng, i, j) {
    B.box(L.x0, 0.15, L.z0, L.x1, 0.17, L.z1, { top: 'parking', ttw: 10 });
    B.box(L.x0 + 2, 0.17, L.z0 + 2, L.x0 + 6, 3.2, L.z0 + 5, { side: 'trim', top: 'trimDark' });
    this.physics.addBox(L.x0 + 2, 0, L.z0 + 2, L.x0 + 6, 3.2, L.z0 + 5, 'kiosk');
    const spots = [];
    for (let x = L.x0 + 5; x < L.x1 - 4; x += 5) for (const z of [L.z0 + 10, L.z1 - 10]) spots.push({ x, z, heading: z < (L.z0 + L.z1) / 2 ? 0 : Math.PI });
    this.lotSpots = this.lotSpots || [];
    this.lotSpots.push(...spots.filter(() => rng() < 0.5));
    if (i === 4 && j === 6) this.locations.carLot = { x: (L.x0 + L.x1) / 2, z: (L.z0 + L.z1) / 2 };
  }

  buildHospital(B, L, rng) {
    this.alleyGround(B, L);
    const x0 = L.x0 + 4, x1 = L.x1 - 4, z0 = L.z0 + 4, z1 = L.z1 - 16;
    this.building(B, x0, z0, x1, z1, 35, 'hospital', { rng, parapet: true });
    this.building(B, x0 + 10, z1, x1 - 10, L.z1 - 2, 7, 'hospital', { rng, props: false });
    this.addTextSign(B, 'ST. MARISOL MEDICAL', '#ff4d5a', (x0 + x1) / 2, 8.8, L.z1 - 1.9, 'pz', 22, 2.2);
    // rooftop red cross
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, y = 35.15 + 0.9;
    B.box(cx - 4, y, cz - 1.2, cx + 4, y + 0.6, cz + 1.2, { side: 'neon_red', top: 'neon_red' });
    B.box(cx - 1.2, y, cz - 4, cx + 1.2, y + 0.6, cz + 4, { side: 'neon_red', top: 'neon_red' });
    this.locations.hospital = { x: cx, z: L.z1 + 2, heading: 0 };
  }
  buildPolice(B, L, rng) {
    this.alleyGround(B, L);
    const x0 = L.x0 + 2, x1 = L.x1 - 2, z0 = L.z0 + 2, z1 = L.z0 + 34;
    this.building(B, x0, z0, x1, z1, 21, 'police', { rng, neonTrim: 'blue' });
    this.addTextSign(B, 'SOLANO BEACH POLICE', '#3d8bff', (x0 + x1) / 2, 6, z1 + 0.1, 'pz', 22, 2.2);
    B.box(L.x0, 0.16, z1 + 2, L.x1, 0.18, L.z1, { top: 'parking', ttw: 10 });
    this.locations.police = { x: (x0 + x1) / 2, z: L.z1 + 2, heading: 0 };
    this.policeLot = [];
    for (let k = 0; k < 4; k++) this.policeLot.push({ x: L.x0 + 10 + k * 9, z: z1 + 12, heading: 0 });
  }
  buildClub(B, L, rng) {
    this.alleyGround(B, L);
    const midX = L.x0 + 26;
    this.building(B, L.x0, L.z0, midX - 2, L.z1, 17.5, 'decoLav', { rng, shops: { nx: true } });
    const z0 = L.z0 + 6, z1 = L.z1 - 6;
    this.building(B, midX + 2, z0, L.x1, z1, 21, 'decoPink', { rng, neonTrim: 'cyan' });
    for (let f = 1; f <= 5; f++) B.box(L.x1, 0.15 + f * 3.5, z0 + 0.5, L.x1 + 0.14, 0.15 + f * 3.5 + 0.14, z1 - 0.5, { side: f % 2 ? 'neon_pink' : 'neon_cyan' });
    this.addTextSign(B, 'NOCTURNE', '#ff2fa0', L.x1 + 0.4, 12, (z0 + z1) / 2, 'px', 20, 5, 'CLUB · COCKTAILS · LIVE');
    B.box(L.x1, 0.15, (z0 + z1) / 2 - 4, L.x1 + 3, 4.2, (z0 + z1) / 2 + 4, { side: 'trimDark', top: 'neon_pink', skip: { nx: true } });
    this.locations.club = { x: L.x1 + 5.5, z: (z0 + z1) / 2 + 6, heading: Math.PI / 2 };
    for (let u = 0; u < 3; u++) this.inst.umbrellas.push({ x: L.x1 + 2.2, z: L.z0 + 3 + u * 26, s: 0.8, yaw: 0, y: 0.15, color: [1, 0.35, 0.6] });
  }
  buildGarage(B, L, rng) {
    B.box(L.x0, 0.15, L.z0, L.x1, 0.17, L.z1, { top: 'concreteGround', ttw: 8 });
    // garage: open front facing north, walls + roof with colliders on walls only
    const x0 = L.x0 + 14, x1 = L.x1 - 14, z0 = L.z0 + 10, z1 = L.z1 - 8, h = 8;
    B.box(x0, 0.15, z1 - 0.5, x1, h, z1, { side: 'f_warehouseRed', top: 'roof', tw: 18, th: 10 });
    B.box(x0, 0.15, z0, x0 + 0.5, h, z1, { side: 'f_warehouseRed', top: 'roof', tw: 18, th: 10 });
    B.box(x1 - 0.5, 0.15, z0, x1, h, z1, { side: 'f_warehouseRed', top: 'roof', tw: 18, th: 10 });
    B.box(x0, h, z0, x1, h + 0.4, z1, { side: 'trimDark', top: 'roof', bottom: 'trimDark' });
    this.physics.addBox(x0, 0, z1 - 0.5, x1, h, z1); this.physics.addBox(x0, 0, z0, x0 + 0.5, h, z1); this.physics.addBox(x1 - 0.5, 0, z0, x1, h, z1);
    this.physics.addBox(x0, h, z0, x1, h + 0.4, z1);
    this.addTextSign(B, 'DEX AUTO WORKS', '#ffd23f', (x0 + x1) / 2, h - 1.2, z0 - 0.05, 'nz', 16, 2);
    // workbench props inside
    B.box(x0 + 1, 0.15, z1 - 2.5, x0 + 8, 1.1, z1 - 0.6, { side: 'metal', top: 'wood' });
    this.garageLight = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
    this.locations.garage = { x: (x0 + x1) / 2, z: z0 + 6, heading: Math.PI };
    this.locations.garageDoor = { x: (x0 + x1) / 2, z: L.z0 - 1 };
    this.containerYard(B, L.x0, L.z0, x0 - 2, L.z1, rng);
  }
  buildSprayBlock(B, L, rng, i, j) {
    this.alleyGround(B, L);
    // small drive-in spray shop open to the north street, rest of the block is regular buildings
    const x0 = L.x0 + 2, x1 = L.x0 + 18, z0 = L.z0, z1 = L.z0 + 17;
    const h = 7;
    B.box(x0, 0.15, z0, x0 + 0.5, h, z1, { side: 'f_stuccoBlue', tw: 8, th: 7 });
    B.box(x1 - 0.5, 0.15, z0, x1, h, z1, { side: 'f_stuccoBlue', tw: 8, th: 7 });
    B.box(x0, 0.15, z1 - 0.5, x1, h, z1, { side: 'f_stuccoBlue', tw: 8, th: 7 });
    B.box(x0, h, z0, x1, h + 0.4, z1, { side: 'trimDark', top: 'roof', bottom: 'trimDark' });
    this.physics.addBox(x0, 0, z0, x0 + 0.5, h, z1); this.physics.addBox(x1 - 0.5, 0, z0, x1, h, z1); this.physics.addBox(x0, 0, z1 - 0.5, x1, h, z1);
    this.physics.addBox(x0, h, z0, x1, h + 0.4, z1);
    this.addTextSign(B, 'SPRAY SHACK', '#35f2ff', (x0 + x1) / 2, h - 1.2, z0 - 0.05, 'nz', 12, 2, 'FRESH PAINT · NO QUESTIONS');
    this.locations.spray = this.locations.spray || [];
    this.locations.spray.push({ x: (x0 + x1) / 2, z: z0 + 8, heading: Math.PI });
    this.building(B, L.x0, L.z0 + 21, L.x0 + 22, L.z1, 10.5, i === 1 ? 'stuccoYel' : 'brick', { rng, shops: { nx: true, pz: true } });
    const rest = { x0: L.x0 + 26, x1: L.x1, z0: L.z0, z1: L.z1 };
    this.building(B, rest.x0, rest.z0, rest.x1, rest.z1, 14, i === 1 ? 'stucco' : 'warehouse', { rng, shops: { px: true, nz: true, pz: true } });
    void j;
  }
  buildHideout(B, L, rng) {
    B.box(L.x0, 0.15, L.z0, L.x1, 0.17, L.z1, { top: 'concreteGround', ttw: 8 });
    // warehouse at the back (south), open yard with cover crates facing the north gate
    const x0 = L.x0 + 20, x1 = L.x1 - 6, z0 = L.z0 + 24, z1 = L.z1 - 4;
    this.building(B, x0, z0, x1, z1, 14, 'warehouseRed', { rng, parapet: false });
    this.addTextSign(B, 'RIPTIDE MARINE SUPPLY', '#2ff3ff', (x0 + x1) / 2, 11, z0 - 0.05, 'nz', 20, 2.2);
    this.containerYard(B, L.x0, L.z0 + 6, x0 - 3, L.z1 - 4, rng);
    const crates = [[0.15, 6], [0.4, 9], [0.7, 5], [0.85, 12], [0.3, 15], [0.6, 16], [0.5, 3]];
    for (const [fx, dz] of crates) {
      const x = x0 + 2 + fx * (x1 - x0 - 6), z = L.z0 + dz;
      B.box(x, 0.17, z, x + 2, 1.4, z + 2, { side: 'wood', top: 'wood' });
      this.physics.addBox(x, 0, z, x + 2, 1.4, z + 2, 'crate');
    }
    this.fence(B, L, rng);
    this.locations.hideout = { x: (x0 + x1) / 2, z: z0 - 9 };
    this.locations.hideoutGate = { x: (L.x0 + L.x1) / 2, z: L.z0 - 2 };
  }

  // ------------------------------------------------------------------ edges / beach / pier
  buildMargins() {
    const B = (x, z) => this.chunkFor(x, z);
    const rng = mulberry32(77);
    const X0 = CITY.X0 - CITY.HALF_RW, X1 = CITY.X1 + CITY.HALF_RW, Z0 = CITY.Z0 - CITY.HALF_RW, Z1 = CITY.Z1 + CITY.HALF_RW;
    // split long slabs into chunk-sized pieces so they are culled properly
    const slab = (x0, z0, x1, z1, top) => {
      for (let x = x0; x < x1; x += CHUNK / 2) for (let z = z0; z < z1; z += CHUNK / 2) {
        const xa = x, xb = Math.min(x + CHUNK / 2, x1), za = z, zb = Math.min(z + CHUNK / 2, z1);
        B((xa + xb) / 2, (za + zb) / 2).box(xa, -0.3, za, xb, 0.15, zb, { side: 'curb', top, tw: 4, ttw: top === 'concreteGround' ? 8 : 4 });
      }
    };
    slab(WORLD.LAND_MIN_X, WORLD.LAND_MIN_Z, X0, WORLD.LAND_MAX_Z, 'sidewalk');
    slab(X0, WORLD.LAND_MIN_Z, X1, Z0, 'sidewalk');
    slab(X0, Z1, X1, WORLD.LAND_MAX_Z, 'concreteGround');
    slab(X1, WORLD.LAND_MIN_Z, WORLD.BEACH_X, WORLD.LAND_MAX_Z, 'sidewalk');
    // palms + lamps along west / north promenades, railings at the sea wall
    for (let z = WORLD.LAND_MIN_Z + 8; z < WORLD.LAND_MAX_Z - 4; z += 16) {
      this.addPalm(WORLD.LAND_MIN_X + 6, z, rng);
      this.inst.lamps.push({ x: X0 - 1, z: z + 8, yaw: Math.PI / 2 });
    }
    for (let x = X0 + 8; x < X1 - 4; x += 16) {
      this.addPalm(x, WORLD.LAND_MIN_Z + 6, rng);
      this.inst.lamps.push({ x: x + 8, z: Z0 - 1, yaw: 0 });
      this.inst.lamps.push({ x: x + 8, z: Z1 + 1, yaw: Math.PI });
    }
    for (let x = X1 + 1; x < X1 + 2; x++) for (let z = WORLD.LAND_MIN_Z + 12; z < WORLD.LAND_MAX_Z; z += 22) {
      if (Math.abs(z) < 12) continue;
      this.addPalm(429.5, z, rng, 1.1);
      this.inst.lamps.push({ x: 428, z: z + 11, yaw: -Math.PI / 2 });
    }
    const rail = (x0, z0, x1, z1) => {
      B((x0 + x1) / 2, (z0 + z1) / 2).box(x0, 0.15, z0, x1, 1.1, z1, { side: 'trimDark', top: 'trimDark' });
      this.physics.addBox(x0, 0, z0, x1, 1.1, z1, 'rail');
    };
    for (let z = WORLD.LAND_MIN_Z; z < WORLD.LAND_MAX_Z; z += 84) rail(WORLD.LAND_MIN_X, z, WORLD.LAND_MIN_X + 0.15, Math.min(z + 84, WORLD.LAND_MAX_Z));
    for (let x = WORLD.LAND_MIN_X; x < X1; x += 84) rail(x, WORLD.LAND_MIN_Z, Math.min(x + 84, X1), WORLD.LAND_MIN_Z + 0.15);
  }

  buildBeach() {
    const x0 = WORLD.BEACH_X, x1 = 760, zN = -WORLD.BEACH_Z, zS = WORLD.BEACH_Z;
    const geo = new THREE.PlaneGeometry(x1 - x0, zS - zN, 60, 90);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + (x0 + x1) / 2, z = pos.getZ(k) + (zN + zS) / 2;
      let y = 0.1 - (x - x0) * 0.035;
      if (y > -0.9) y += Math.sin(z * 0.05) * Math.sin(x * 0.11) * 0.15 * (y + 0.9);
      pos.setXYZ(k, x, Math.max(y, -6.4), z);
      uv.setXY(k, x / 8, z / 8);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mats.sand);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const rng = mulberry32(91);
    for (let k = 0; k < 70; k++) {
      const x = 436 + rng() * 22, z = zN + 10 + rng() * (zS - zN - 20);
      if (Math.abs(z) < 14) continue;
      if (rng() < 0.45) this.addPalm(x, z, rng, 0.9 + rng() * 0.4);
      else this.inst.umbrellas.push({ x, z, y: terrainHeight(x, z), s: 1, yaw: rng() * 6, color: pick([[1, 0.3, 0.45], [0.2, 0.75, 0.85], [1, 0.85, 0.3], [0.95, 0.95, 0.95], [0.6, 0.35, 0.9]], rng) });
    }
    // lifeguard towers
    const cols = [[1, 0.55, 0.65], [0.45, 0.85, 0.8], [1, 0.85, 0.45], [0.7, 0.6, 1]];
    for (let k = 0; k < 5; k++) {
      const z = -380 + k * 170 + (k === 2 ? 40 : 0), x = 452;
      const y = terrainHeight(x, z);
      const Bk = this.chunkFor(x, z);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Bk.box(x + ox * 1.2 - 0.1, y, z + oz * 1.2 - 0.1, x + ox * 1.2 + 0.1, y + 2.5, z + oz * 1.2 + 0.1, { side: 'trim' });
      Bk.box(x - 1.6, y + 2.5, z - 1.6, x + 1.6, y + 4.8, z + 1.6, { side: 'paintVC', top: 'paintVC', col: cols[k % cols.length] });
      Bk.poly('paintVC', [[x - 2, y + 4.8, z + 2], [x + 2, y + 4.8, z + 2], [x, y + 5.8, z]], [[0, 0], [1, 0], [0.5, 1]], [0.95, 0.95, 0.95], true);
      Bk.poly('paintVC', [[x + 2, y + 4.8, z - 2], [x - 2, y + 4.8, z - 2], [x, y + 5.8, z]], [[0, 0], [1, 0], [0.5, 1]], [0.95, 0.95, 0.95], true);
      Bk.poly('paintVC', [[x + 2, y + 4.8, z + 2], [x + 2, y + 4.8, z - 2], [x, y + 5.8, z]], [[0, 0], [1, 0], [0.5, 1]], [0.95, 0.95, 0.95], true);
      Bk.poly('paintVC', [[x - 2, y + 4.8, z - 2], [x - 2, y + 4.8, z + 2], [x, y + 5.8, z]], [[0, 0], [1, 0], [0.5, 1]], [0.95, 0.95, 0.95], true);
      this.physics.addBox(x - 1.6, y, z - 1.6, x + 1.6, y + 5, z + 1.6, 'tower');
    }
    this.locations.beach = { x: 445, z: -120 };
  }

  buildPier() {
    const x0 = WORLD.PROMENADE_X, x1 = 560, hw = 8, y = 0.15;
    PLATFORMS.push({ x0, x1, z0: -hw, z1: hw, y });
    PLATFORMS.push({ x0: 540, x1: 620, z0: -26, z1: 26, y });
    const deck = (a, b, za, zb) => {
      for (let x = a; x < b; x += 40) {
        const xb = Math.min(x + 40, b), Bk = this.chunkFor((x + xb) / 2, (za + zb) / 2);
        Bk.box(x, y - 0.5, za, xb, y, zb, { side: 'wood', top: 'wood', bottom: 'wood', tw: 4 });
      }
    };
    deck(x0, x1, -hw, hw);
    deck(540, 620, -26, 26);
    // pilings
    for (let x = 440; x < 620; x += 8) for (const z of [-hw + 0.5, hw - 0.5]) {
      if (x > 540) continue;
      this.chunkFor(x, z).box(x - 0.25, -6, z - 0.25, x + 0.25, y - 0.5, z + 0.25, { side: 'wood' });
    }
    for (let x = 544; x < 620; x += 10) for (let z = -24; z <= 24; z += 12) this.chunkFor(x, z).box(x - 0.3, -6, z - 0.3, x + 0.3, y - 0.5, z + 0.3, { side: 'wood' });
    // railings
    const rail = (xa, za, xb, zb) => {
      this.chunkFor((xa + xb) / 2, (za + zb) / 2).box(Math.min(xa, xb), y, Math.min(za, zb), Math.max(xa, xb), y + 1.1, Math.max(za, zb), { side: 'trim', top: 'trim' });
      this.physics.addBox(Math.min(xa, xb), y - 1, Math.min(za, zb), Math.max(xa, xb), y + 1.1, Math.max(za, zb), 'rail');
    };
    rail(440, -hw, 540, -hw + 0.15); rail(440, hw - 0.15, 540, hw);
    rail(540, -26, 620, -25.85); rail(540, 25.85, 620, 26); rail(619.85, -26, 620, 26);
    rail(540, -26, 540.15, -hw); rail(540, hw, 540.15, 26);
    // stalls with signs
    const stalls = [['TACOS', 470, -1], ['ARCADE', 500, 1], ['ICE CREAM', 525, -1], ['SURF RENTAL', 555, 1]];
    for (const [name, x, side] of stalls) {
      const z = side * (hw - 2.5), Bk = this.chunkFor(x, z);
      Bk.box(x - 3, y, z - 1.8, x + 3, y + 3, z + 1.8, { side: 'paintVC', top: 'trimDark', col: side > 0 ? [0.4, 0.85, 0.8] : [1, 0.6, 0.7] });
      this.physics.addBox(x - 3, y, z - 1.8, x + 3, y + 3, z + 1.8, 'stall');
      this.addTextSign(Bk, name, side > 0 ? '#35f2ff' : '#ff3fa4', x, y + 3.7, z - side * 1.85, side > 0 ? 'nz' : 'pz', 6, 1.2);
    }
    this.addTextSign(this.chunkFor(436, 0), 'STARLIGHT PIER', '#ffd23f', 436, 6.5, 0, 'nx', 14, 2.6);
    for (const z of [-hw + 0.3, hw - 0.3]) this.chunkFor(436, z).box(435.7, y, z - 0.3, 436.3, 7.8, z + 0.3, { side: 'trimDark' });
    this.physics.addBox(435.7, 0, -hw, 436.3, 7.8, -hw + 0.6); this.physics.addBox(435.7, 0, hw - 0.6, 436.3, 7.8, hw);
    for (let x = 450; x < 540; x += 18) { this.inst.lamps.push({ x, z: -hw + 0.6, yaw: 0 }); this.inst.lamps.push({ x: x + 9, z: hw - 0.6, yaw: Math.PI }); }
    this.locations.pier = { x: 445, z: 0 };
    this.locations.pierEnd = { x: 580, z: 0 };
    this.buildFerrisWheel(600, 0);
  }

  buildFerrisWheel(x, z) {
    const R = 17, cy = R + 4, g = new THREE.Group();
    g.position.set(x, cy, z);
    const wheel = new THREE.Group();
    const pink = this.mats.neon_pink, cyan = this.mats.neon_cyan, purple = this.mats.neon_purple;
    const rim1 = new THREE.Mesh(new THREE.TorusGeometry(R, 0.22, 6, 72), pink); rim1.rotation.y = Math.PI / 2; rim1.position.x = 1.2;
    const rim2 = rim1.clone(); rim2.position.x = -1.2;
    const rim3 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.16, 6, 48), cyan); rim3.rotation.y = Math.PI / 2;
    wheel.add(rim1, rim2, rim3);
    const spokes = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const sg = new THREE.BoxGeometry(0.12, R, 0.12); sg.translate(0, R / 2, 0);
      sg.rotateX(a);
      spokes.push(sg);
    }
    const sp = new THREE.Mesh(mergeGeometries(spokes), purple); wheel.add(sp);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3, 16), this.mats.metal); hub.rotation.z = Math.PI / 2; wheel.add(hub);
    // chase lights
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), 64);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      m4.makeTranslation((k % 2 ? 1.2 : -1.2), Math.cos(a) * R, Math.sin(a) * R);
      bulbs.setMatrixAt(k, m4); bulbs.setColorAt(k, new THREE.Color(1, 1, 1));
    }
    wheel.add(bulbs);
    this.wheelBulbs = bulbs;
    // gondolas
    const gondolas = [];
    const gcol = [0xff5fa2, 0x3fe0e0, 0xffd23f, 0x9f6bff];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const gp = new THREE.Group();
      gp.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.8, 1.8), new THREE.MeshStandardMaterial({ color: gcol[k % 4], roughness: 0.4, metalness: 0.3 }));
      cab.position.y = -1.6; cab.castShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.8, 4), this.mats.metal); roof.position.y = -0.4; roof.rotation.y = Math.PI / 4;
      gp.add(cab, roof); wheel.add(gp); gondolas.push(gp);
    }
    g.add(wheel);
    // A-frame legs
    for (const sx of [-2.4, 2.4]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, cy / Math.cos(0.35), 8), this.mats.trim);
      leg.position.set(sx, -cy / 2, sz * Math.tan(0.35) * cy / 2);
      leg.rotation.x = sz * 0.35; leg.castShadow = true;
      g.add(leg);
    }
    this.scene.add(g);
    this.physics.addBox(x - 3, 0, z - 9, x + 3, 5, z + 9, 'wheel');
    this.ferris = { wheel, gondolas, bulbs };
  }

  buildDocksWaterfront() {
    const y = 0.15;
    // concrete piers
    for (const [x0, x1] of [[-330, -290], [-60, -20], [180, 220]]) {
      PLATFORMS.push({ x0, x1, z0: WORLD.LAND_MAX_Z - 1, z1: 540, y });
      const Bk = this.chunkFor((x0 + x1) / 2, 495);
      Bk.box(x0, -7, WORLD.LAND_MAX_Z, x1, y, 540, { side: 'seawall', top: 'concreteGround', tw: 6, ttw: 8 });
      for (let z = 460; z < 540; z += 12) this.inst.lamps.push({ x: x0 + 1, z, yaw: Math.PI / 2 });
      // bollards
      for (let z = 460; z < 540; z += 10) Bk.box(x1 - 1, y, z, x1 - 0.5, y + 0.7, z + 0.5, { side: 'trimDark', top: 'trimDark' });
    }
    // cranes along the quay
    for (const cx of [-250, -120, 60, 300]) this.buildCrane(cx, 440);
    // moored cargo ship
    this.buildShip(-170, 520);
  }
  buildCrane(x, z) {
    const Bk = this.chunkFor(x, z), red = [0.85, 0.2, 0.15], white = [0.92, 0.92, 0.9];
    const H = 34;
    for (const [ox, oz] of [[-6, -8], [6, -8], [-6, 8], [6, 8]]) {
      Bk.box(x + ox - 0.6, 0.15, z + oz - 0.6, x + ox + 0.6, H, z + oz + 0.6, { side: 'paintVC', col: (ox + oz) % 2 ? red : white });
      this.physics.addBox(x + ox - 0.6, 0, z + oz - 0.6, x + ox + 0.6, H, z + oz + 0.6, 'crane');
    }
    Bk.box(x - 7, H, z - 30, x + 7, H + 2.5, z + 40, { side: 'paintVC', top: 'paintVC', bottom: 'paintVC', col: red });
    Bk.box(x - 3, H + 2.5, z - 4, x + 3, H + 7, z + 4, { side: 'paintVC', top: 'paintVC', col: white });
    for (const oz of [-8, 8]) Bk.box(x - 6, H - 3, z + oz - 0.5, x + 6, H, z + oz + 0.5, { side: 'paintVC', col: red });
    Bk.box(x - 0.5, H + 7, z - 0.5, x + 0.5, H + 8, z + 0.5, { side: 'red', top: 'red' });
  }
  buildShip(x, z) {
    const Bk = this.chunkFor(x, z), L = 150, W = 24;
    const x0 = x - L / 2, x1 = x + L / 2, z0 = z - W / 2, z1 = z + W / 2;
    Bk.box(x0, -5, z0, x1, 2, z1, { side: 'paintVC', col: [0.45, 0.08, 0.08] });
    Bk.box(x0, 2, z0, x1, 7, z1, { side: 'paintVC', top: 'concreteGround', col: [0.12, 0.13, 0.16], ttw: 8 });
    Bk.poly('paintVC', [[x1, 7, z1], [x1, 7, z0], [x1 + 14, 7, z]], [[0, 0], [1, 0], [0.5, 1]], [0.12, 0.13, 0.16], true);
    Bk.poly('paintVC', [[x1, -5, z0], [x1 + 14, 7, z], [x1, 7, z0]], [[0, 0], [1, 1], [0, 1]], [0.3, 0.07, 0.07]);
    Bk.poly('paintVC', [[x1, -5, z1], [x1, 7, z1], [x1 + 14, 7, z]], [[0, 0], [0, 1], [1, 1]], [0.3, 0.07, 0.07]);
    Bk.box(x0 + 4, 7, z0 + 3, x0 + 24, 22, z1 - 3, { side: 'f_hospital', top: 'roof', tw: 12, th: 14, vBase: 7 });
    Bk.box(x0 + 12, 22, z - 2, x0 + 16, 30, z + 2, { side: 'paintVC', col: [0.9, 0.5, 0.1] });
    this.physics.addBox(x0, -5, z0, x1 + 8, 7, z1, 'ship');
    const palette = [[0.75, 0.2, 0.15], [0.15, 0.35, 0.65], [0.2, 0.55, 0.35], [0.85, 0.55, 0.15], [0.55, 0.55, 0.58]];
    const rng = mulberry32(5);
    for (let cx = x0 + 30; cx < x1 - 10; cx += 13) for (let cz = z0 + 2; cz < z1 - 2; cz += 2.8) {
      const st = 1 + Math.floor(rng() * 4);
      for (let s = 0; s < st; s++) this.inst.containers.push({ x: cx, z: cz + 1.3, y: 7 + s * 2.6, yaw: Math.PI / 2, color: palette[Math.floor(rng() * palette.length)] });
    }
  }

  buildDistant() {
    // distant hilly islands on the horizon (smooth, low domes)
    const mat = new THREE.MeshStandardMaterial({ color: 0x2c4a33, roughness: 1 });
    const spots = [[-1500, -900, 420], [-1750, 300, 520], [-900, -1750, 380], [1650, -1350, 320], [300, 1750, 440], [-1300, 1450, 400], [1950, 900, 280]];
    spots.forEach(([x, z, r], idx) => {
      const g = new THREE.SphereGeometry(r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const px = p.getX(k), pz = p.getZ(k), a = Math.atan2(pz, px);
        const bumps = 1 + 0.25 * Math.sin(a * 3 + idx) + 0.12 * Math.sin(a * 7 + idx * 2);
        p.setY(k, p.getY(k) * 0.22 * bumps);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.position.set(x, -6, z); this.scene.add(m);
    });
  }

  // ------------------------------------------------------------------ instancing
  finalize() {
    const gm = this.global.build(this.mats);
    for (const m of gm) { m.castShadow = false; this.scene.add(m); }
    for (const c of this.chunks.values()) {
      for (const m of c.b.build(this.mats)) c.group.add(m);
      this.scene.add(c.group);
      c.b = null;
    }
  }

  buildInstances() {
    const dummy = new THREE.Object3D();
    // Instances are bucketed per chunk so each bucket is frustum culled and distance culled with its chunk.
    // Small props go into a per-chunk "detail" group that is hidden at longer range (LOD).
    const place = (geo, mat, list, o = {}) => {
      const buckets = new Map();
      for (const p of list) {
        const c = this.chunkEntry(p.x, p.z);
        let b = buckets.get(c); if (!b) { b = []; buckets.set(c, b); } b.push(p);
      }
      const meshes = [];
      for (const [c, items] of buckets) {
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((p, k) => {
          dummy.position.set(p.x, p.y !== undefined ? p.y : terrainHeight(p.x, p.z), p.z);
          dummy.rotation.set(0, p.yaw || 0, 0);
          const s = p.s || 1; dummy.scale.set(s, s, s);
          if (o.fn) o.fn(dummy, p);
          dummy.updateMatrix();
          mesh.setMatrixAt(k, dummy.matrix);
          if (p.color) mesh.setColorAt(k, new THREE.Color(p.color[0], p.color[1], p.color[2]));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = !!o.castShadow; mesh.receiveShadow = o.receiveShadow !== false;
        if (o.renderOrder) mesh.renderOrder = o.renderOrder;
        (o.detail ? this.detailGroup(c) : c.group).add(mesh);
        meshes.push(mesh);
      }
      return meshes;
    };
    const bark = TX.makeBark();
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.9 });
    const leafTex = TX.makePalmLeaf();
    const palmLeafMat = new THREE.MeshStandardMaterial({ map: leafTex.map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
    const cluster = TX.makeLeafCluster();
    const treeLeafMat = new THREE.MeshStandardMaterial({ map: cluster.map, normalMap: cluster.normalMap, roughness: 0.85, flatShading: false });

    // vegetation
    place(makePalmGeometry(), [barkMat, palmLeafMat], this.inst.palms, { castShadow: true });
    place(makeTreeGeometry(), [barkMat, treeLeafMat], this.inst.trees, { castShadow: true });
    const bushGeo = new THREE.IcosahedronGeometry(0.9, 1);
    jitter(bushGeo, 0.25, 9); bushGeo.scale(1, 0.7, 1); bushGeo.translate(0, 0.5, 0);
    place(bushGeo, treeLeafMat, this.inst.bushes, { castShadow: true, detail: true });
    // street lamps + fake light pools on the ground
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.7 });
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    place(makeLampGeometry(), [metalDark, this.bulbMat], this.inst.lamps, {});
    const poolGeo = new THREE.PlaneGeometry(13, 13); poolGeo.rotateX(-Math.PI / 2);
    this.poolLightMat = new THREE.MeshBasicMaterial({ map: TX.makeLightPool(), color: 0xffb070, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.lightPoolMeshes = place(poolGeo, this.poolLightMat, this.inst.lamps, {
      receiveShadow: false, renderOrder: 2,
      fn: (d, p) => { d.position.x += Math.sin(p.yaw) * 2.2; d.position.z += Math.cos(p.yaw) * 2.2; d.position.y = 0.2; d.rotation.set(0, 0, 0); },
    });
    // small street furniture (detail LOD)
    const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    place(makeBenchGeometry(), vcMat, this.inst.benches, { castShadow: true, detail: true });
    const binGeo = new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10); binGeo.translate(0, 0.6, 0);
    place(binGeo, new THREE.MeshStandardMaterial({ color: 0x2f5f4a, roughness: 0.5, metalness: 0.5 }), this.inst.bins, { detail: true });
    const hyGeo = mergeGeometries([new THREE.CylinderGeometry(0.15, 0.18, 0.7, 8).translate(0, 0.5, 0), new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.85, 0), new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6).rotateZ(Math.PI / 2).translate(0, 0.6, 0)]);
    place(hyGeo, new THREE.MeshStandardMaterial({ color: 0xd8b21c, roughness: 0.5 }), this.inst.hydrants, { detail: true });
    const umbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
    place(makeUmbrellaGeometry(), umbMat, this.inst.umbrellas, { castShadow: true, detail: true });
    // shipping containers
    const cGeo = new THREE.BoxGeometry(2.6, 2.6, 12.2); cGeo.translate(0, 1.3, 0);
    const corr = TX.makeCorrugated(); corr.map.repeat.set(3, 1);
    const cMat = new THREE.MeshStandardMaterial({ map: corr.map, roughness: 0.6, metalness: 0.35 });
    place(cGeo, cMat, this.inst.containers, { castShadow: true });
  }
  chunkEntry(x, z) {
    const cx = Math.floor((x + 504) / CHUNK), cz = Math.floor((z + 504) / CHUNK), k = cx * 100 + cz;
    let c = this.chunks.get(k);
    if (!c) {
      c = { b: null, group: new THREE.Group(), x: cx * CHUNK - 504 + CHUNK / 2, z: cz * CHUNK - 504 + CHUNK / 2 };
      this.chunks.set(k, c); this.scene.add(c.group);
    }
    return c;
  }
  detailGroup(c) {
    if (!c.detail) { c.detail = new THREE.Group(); c.group.add(c.detail); }
    return c.detail;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, time, env, camPos) {
    this.night = env.night;
    const n = env.night;
    for (const m of this.windowMats) m.emissiveIntensity = n * 1.05;
    this.shopMat.emissiveIntensity = 0.08 + n * 0.55;
    const neonI = 0.9 + n * 2.6;
    for (const m of this.neonMats) m.color.copy(m.userData.base).multiplyScalar(neonI);
    for (const m of this.signMats) m.color.setScalar(0.7 + n * 1.9);
    this.bulbMat.color.setRGB(1, 0.85, 0.62).multiplyScalar(0.4 + n * 4);
    this.poolLightMat.opacity = n * 0.32;
    for (const m of this.lightPoolMeshes) m.visible = n > 0.02;
    this.poolMat.emissiveIntensity = 0.05 + n * 0.8;
    this.blinkMat.emissiveIntensity = (Math.sin(time * 3) > 0.3 ? 4 : 0.2);
    // wet roads
    for (const m of this.roadMats) { m.roughness = 0.88 - env.wet * 0.6; m.color.setScalar(1 - env.wet * 0.35); }
    // water normal scroll
    this.waterNormal.offset.set(time * 0.006, time * 0.004);
    this.waterTime.value = time;
    // ferris wheel
    if (this.ferris) {
      const a = time * 0.05;
      this.ferris.wheel.rotation.x = a;
      for (const g of this.ferris.gondolas) g.rotation.x = -a;
      const c = new THREE.Color();
      for (let k = 0; k < 64; k++) {
        const on = ((k + Math.floor(time * 8)) % 8) < 4;
        c.setHSL(((k / 64) + time * 0.05) % 1, 1, on ? 0.6 : 0.15).multiplyScalar(on ? 1 + n * 3 : 0.5);
        this.ferris.bulbs.setColorAt(k, c);
      }
      this.ferris.bulbs.instanceColor.needsUpdate = true;
    }
    // chunk distance culling
    const dd = (this.drawDistance || 700) + CHUNK * 0.75;
    const detailD = (this.detailDistance || 230) + CHUNK * 0.5;
    for (const c of this.chunks.values()) {
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      c.group.visible = d < dd;
      if (c.detail) c.detail.visible = d < detailD;
    }
  }
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function jitter(geo, amt, seed) {
  const rng = mulberry32(seed), p = geo.attributes.position;
  const map = new Map();
  for (let k = 0; k < p.count; k++) {
    const key = `${p.getX(k).toFixed(3)},${p.getY(k).toFixed(3)},${p.getZ(k).toFixed(3)}`;
    let o = map.get(key);
    if (!o) { o = 1 + (rng() - 0.5) * amt * 2; map.set(key, o); }
    p.setXYZ(k, p.getX(k) * o, p.getY(k) * o, p.getZ(k) * o);
  }
  geo.computeVertexNormals();
}

function makePalmGeometry() {
  const H = 9;
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, H, 8, 10, true);
  trunk.translate(0, H / 2, 0);
  const p = trunk.attributes.position, uv = trunk.attributes.uv;
  for (let k = 0; k < p.count; k++) {
    const y = p.getY(k), t = y / H;
    p.setX(k, p.getX(k) + t * t * 1.4);
    uv.setY(k, y / 2.5);
  }
  trunk.computeVertexNormals();
  trunk.clearGroups(); trunk.addGroup(0, trunk.index.count, 0);
  const top = [1.4, H, 0];
  const leaves = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (i % 2) * 0.2;
    const len = 4.2 + (i % 3) * 0.5, wdt = 1.3;
    const seg = 6;
    const pos = [], uvs = [], idx = [];
    const dx = Math.cos(a), dz = Math.sin(a);
    const rx = -dz, rz = dx;
    const lift = i % 2 ? 0.9 : 0.4;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const along = t * len;
      const yy = lift * t * 2 - t * t * 2.6;
      const cx = top[0] + dx * along, cy = top[1] + yy, cz = top[2] + dz * along;
      const hw = wdt * 0.5 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.9 + 0.1);
      pos.push(cx - rx * hw, cy - 0.12 * t, cz - rz * hw, cx + rx * hw, cy - 0.12 * t, cz + rz * hw);
      uvs.push(0, t, 1, t);
      if (s < seg) { const b = s * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    leaves.push(g);
  }
  // coconuts
  const nut = new THREE.SphereGeometry(0.2, 6, 5);
  for (let k = 0; k < 3; k++) { const n = nut.clone().translate(top[0] + Math.cos(k * 2) * 0.3, H - 0.4, Math.sin(k * 2) * 0.3); n.deleteAttribute('normal'); n.computeVertexNormals(); leaves.push(n.toNonIndexed ? n : n); }
  const leafGeo = mergeGeometries(leaves.map((g) => { const c = g.index ? g : g; if (!c.attributes.normal) c.computeVertexNormals(); return c; }));
  const trunkClean = new THREE.BufferGeometry();
  trunkClean.setAttribute('position', trunk.attributes.position);
  trunkClean.setAttribute('normal', trunk.attributes.normal);
  trunkClean.setAttribute('uv', trunk.attributes.uv);
  trunkClean.setIndex(trunk.index);
  const merged = mergeGeometries([trunkClean, leafGeo], true);
  return merged;
}
function makeTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3.2, 7); trunk.translate(0, 1.6, 0);
  const parts = [];
  const rng = mulberry32(8);
  for (let k = 0; k < 4; k++) {
    const s = new THREE.IcosahedronGeometry(1.4 + rng() * 0.6, 1);
    jitter(s, 0.2, k + 1);
    s.translate((rng() - 0.5) * 1.6, 3.8 + rng() * 1.4, (rng() - 0.5) * 1.6);
    parts.push(s);
  }
  const leaves = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); const n = g.toNonIndexed(); n.computeVertexNormals(); return n; }));
  // spherical uv for foliage
  const p = leaves.attributes.position, uvs = [];
  for (let k = 0; k < p.count; k++) uvs.push(p.getX(k) * 0.35, p.getY(k) * 0.35 + p.getZ(k) * 0.2);
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const tr = trunk.toNonIndexed();
  return mergeGeometries([tr, leaves], true);
}
function makeLampGeometry() {
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 7.5, 8); pole.translate(0, 3.75, 0);
  const arm = new THREE.BoxGeometry(0.1, 0.1, 2.2); arm.translate(0, 7.4, 1.05);
  const head = new THREE.BoxGeometry(0.5, 0.18, 0.9); head.translate(0, 7.35, 2.1);
  const base = new THREE.CylinderGeometry(0.22, 0.25, 0.5, 8); base.translate(0, 0.25, 0);
  const bulb = new THREE.BoxGeometry(0.36, 0.06, 0.7); bulb.translate(0, 7.24, 2.1);
  const metal = mergeGeometries([pole, arm, head, base].map((g) => g.toNonIndexed()));
  return mergeGeometries([metal, bulb.toNonIndexed()], true);
}
function makeBenchGeometry() {
  const parts = [];
  const add = (g, col) => {
    const n = g.toNonIndexed(), c = [];
    for (let k = 0; k < n.attributes.position.count; k++) c.push(...col);
    n.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    parts.push(n);
  };
  const wood = [0.55, 0.35, 0.2], iron = [0.12, 0.12, 0.13];
  add(new THREE.BoxGeometry(1.8, 0.06, 0.5).translate(0, 0.48, 0), wood);
  add(new THREE.BoxGeometry(1.8, 0.4, 0.05).translate(0, 0.78, -0.24).rotateX(0), wood);
  for (const x of [-0.8, 0.8]) add(new THREE.BoxGeometry(0.06, 0.48, 0.5).translate(x, 0.24, 0), iron);
  return mergeGeometries(parts);
}
function makeUmbrellaGeometry() {
  const cone = new THREE.ConeGeometry(1.6, 0.6, 12, 1, true); cone.translate(0, 2.4, 0);
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6); pole.translate(0, 1.2, 0);
  return mergeGeometries([cone.toNonIndexed(), pole.toNonIndexed()]);
}
export { clamp };
