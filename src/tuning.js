// Central AI balancing values (previously scattered through npc.js / police.js).
// Values are identical to the originals; tweak here to rebalance.
export const AI_TUNING = {
  civ: {
    health: 60, cash: [5, 60],
    walkSpeed: [1.2, 1.65], crossSpeedMul: 1.3, crossChance: 0.3,
    fleeSpeed: 5.6, fleeTime: [7, 12], fleeRefresh: 6,
    cowerRadius: 12, cowerChance: 0.25, cowerTime: [3, 6], fleeAfterCower: [5, 8],
    carWaitRadius: 9,
    dodgeMinCarSpeed: 6, dodgeRadius: 10, dodgeAhead: 9, dodgeLateral: 2.2, dodgeSpeed: 6, dodgeHop: 3.5, dodgeFleeTime: 5,
    hurtFleeTime: 10, knockFleeTime: 8,
  },
  gang: { health: 100, accuracy: 1.3, detectRange: 32, damageMul: 0.3, cash: [20, 120], allyAlertRadius: 30, alertTime: 5 },
  police: {
    health: 110, accuracy: 1.0, detectRange: 55, damageMul: 0.34,
    arrestRange: 1.2, arrestTime: 1.3, surrenderArrestTime: 0.6,
    arrestChaseSpeed: 6, arrestApproachSpeed: 3, arrestAimRange: 10, searchSpeed: 5.5, fireGapMul: 0.9,
  },
  combat: {
    fov: 1.3, closeAwareDist: 9, losInterval: 0.25, reactionDelay: [0.7, 1.4],
    prefDist: 14, prefDistShotgun: 7, prefDistMelee: 1.2,
    advanceSpeed: 4.5, meleeAdvanceSpeed: 6, retreatSpeed: 2.5, strafeSpeed: 2.2, chaseSpeed: 5, giveUpTime: 25,
    aimTolerance: 0.5, burst: [3, 7], burstGap: [0.6, 1.4], gangGapMul: 1.1, burstRateMul: 1.2, reloadMul: 1.2, spreadMul: 0.6,
    missBase: 0.25, missPerMeter: 0.018, missPerTargetSpeed: 0.06,
    meleeRange: 1.6, meleeCooldown: 0.9, meleeHitDelay: 0.15,
  },
  wanted: {
    evadeBase: 7, evadePerStar: 3.5, pursuitCars: [0, 1, 2, 3, 4, 5], spawnInterval: 3.5,
    spawnRadius: [110, 170], minSpawnDist: 80, visibleSpawnDist: 130,
    deployDist: 18, deployCooldown: 1, maxOfficersBase: 4, maxOfficersPerStar: 2,
    seeInterval: 0.4, seeRange: 75, heliSeeRange: 90, witnessRange: 60, callDelay: [3, 6],
    patrolCount: 2, patrolInterval: 6, heliStars: 4, heliRespawnAfter: 30,
    surrenderMaxStars: 3,
  },
  heli: {
    health: 900, orbitRadius: 30, orbitSpeed: 0.25, minAltitude: 38, altitudeAbovePlayer: 36, maxSpeed: 26,
    fireRange: 90, burstShots: 6, burstGap: [2, 3.5], shotGap: [0.12, 0.2], missBase: 1.6, missPerMeter: 0.025, damageMul: 0.2,
  },
};
