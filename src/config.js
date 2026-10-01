// City layout constants. The city is a grid of blocks separated by roads,
// sitting on an island. Ocean Drive and the beach run along the east edge.
export const CITY = {
  P: 84,          // block pitch (road centre to road centre)
  RW: 14,         // road width
  NX: 10, NZ: 10, // blocks along x / z
  SIDEWALK: 4,
  LANE: 2.0,      // travel lane centre offset from road centre line
  PARK_LANE: 5.3, // parking lane offset
};
CITY.HALF_RW = CITY.RW / 2;
CITY.X0 = -CITY.P * CITY.NX / 2;
CITY.Z0 = -CITY.P * CITY.NZ / 2;
CITY.X1 = CITY.X0 + CITY.P * CITY.NX;
CITY.Z1 = CITY.Z0 + CITY.P * CITY.NZ;

export const WORLD = {
  WATER_Y: -1.0,
  LAND_MIN_X: -450,
  LAND_MIN_Z: -450,
  LAND_MAX_Z: 450,
  PROMENADE_X: 427,
  BEACH_X: 432,
  BEACH_Z: 450,
};

export const roadX = (i) => CITY.X0 + i * CITY.P;
export const roadZ = (j) => CITY.Z0 + j * CITY.P;

export function blockRect(i, j) {
  const h = CITY.HALF_RW;
  return { x0: roadX(i) + h, x1: roadX(i + 1) - h, z0: roadZ(j) + h, z1: roadZ(j + 1) - h };
}
export function blockCenter(i, j) {
  return { x: (roadX(i) + roadX(i + 1)) / 2, z: (roadZ(j) + roadZ(j + 1)) / 2 };
}
export function blockAt(x, z) {
  const i = Math.floor((x - CITY.X0) / CITY.P), j = Math.floor((z - CITY.Z0) / CITY.P);
  if (i < 0 || j < 0 || i >= CITY.NX || j >= CITY.NZ) return null;
  return { i, j };
}

// Raised flat areas (piers, docks) that extend over water: {x0,x1,z0,z1,y}
export const PLATFORMS = [];

export function isOnRoad(x, z) {
  const { X0, X1, Z0, Z1, P, HALF_RW: h } = CITY;
  if (x < X0 - h || x > X1 + h || z < Z0 - h || z > Z1 + h) return false;
  const mx = (((x - X0) % P) + P) % P, mz = (((z - Z0) % P) + P) % P;
  return Math.min(mx, P - mx) < h || Math.min(mz, P - mz) < h;
}

// Height of the static terrain (not including buildings/props).
export function terrainHeight(x, z) {
  for (let k = 0; k < PLATFORMS.length; k++) {
    const p = PLATFORMS[k];
    if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return p.y;
  }
  if (x > WORLD.PROMENADE_X) {
    if (z < -WORLD.BEACH_Z || z > WORLD.BEACH_Z) return -6;
    if (x < WORLD.BEACH_X) return 0.15;
    return Math.max(0.1 - (x - WORLD.BEACH_X) * 0.035, -6);
  }
  if (x < WORLD.LAND_MIN_X || z < WORLD.LAND_MIN_Z || z > WORLD.LAND_MAX_Z) return -6;
  return isOnRoad(x, z) ? 0 : 0.15;
}

export function isWater(x, z) { return terrainHeight(x, z) < WORLD.WATER_Y - 0.05; }

// District layout
export function districtOf(i, j) {
  if (j >= 8) return 'docks';
  if (i === 9) return 'ocean';
  if (i >= 4 && i <= 7 && j >= 1 && j <= 4) return 'downtown';
  if (i <= 2) return 'residential';
  return 'midtown';
}

// Special blocks
export const LANDMARKS = {
  park: [[5, 5], [1, 2], [8, 7]],
  parking: [[4, 6], [7, 0], [2, 6]],
  hospital: [3, 1],
  police: [6, 6],
  club: [9, 3],
  garage: [3, 8],
  gunshop: [7, 5],
  spray: [[1, 5], [8, 8]],
  hideout: [6, 9],
};
export function isLandmark(list, i, j) {
  if (typeof list[0] === 'number') return list[0] === i && list[1] === j;
  return list.some((p) => p[0] === i && p[1] === j);
}
