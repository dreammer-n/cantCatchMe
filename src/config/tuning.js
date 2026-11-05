// All tunable numbers live here, not inside scenes or entities.
// [TUNE] = prototype guess to adjust through playtesting, not a measured value.

export const DISPLAY = {
  backgroundColor: '#1b1f24',
  // Very dense phone screens (3x) are rendered at 2x: almost no visible difference, much less GPU work.
  maxPixelRatio: 2,
  // Longest frame step the game will simulate (ms). Prevents huge jumps after tab switches or hitches.
  maxFrameDeltaMs: 50,
};

export const VIEW = {
  // [TUNE] How many world units fit across the NARROWER side of the screen.
  // Same value in portrait and landscape, so the car looks the same size on every device
  // and the wider side simply shows more of the world.
  shortSideWorldUnits: 900,
};

// The world has no edge: chunks are generated around the player and recycled behind them.
export const CHUNKS = {
  // World units per chunk, a whole number of city cells (WORLD.cell). The active grid only reaches
  // this far ahead of the player, so it must exceed what the camera can show: about 2030 units on
  // the tallest phones (checked by tests/test_world.mjs).
  size: 2400,
  activeRadius: 1, // chunks kept on each side of the player's: 1 = a 3 x 3 grid
  propPool: 1200, // images prepared at startup (checked against the fullest chunks by the tests)
  // weight: how often this layout appears. cells: [arrangement, weight] for each city block in it.
  // holeChance: how often this kind of chunk has holes in its inside roads (never on its border roads);
  // roadHoles: [fewest, most] when it does. Holes should be a surprise, not the landscape.
  presets: {
    // landmarks: the word statues this kind of chunk can have.
    suburb: { weight: 40, holeChance: 0.05, roadHoles: [1, 1], landmarks: ['GAS', 'PARK', 'MALL'], cells: [['parking', 34], ['lawn', 28], ['shop', 14], ['booth', 10], ['station', 8], ['open', 6]] },
    city: { weight: 12, holeChance: 0.12, roadHoles: [1, 1], landmarks: ['STOP', 'MALL', 'HOTEL'], cells: [['blocks', 35], ['garden', 20], ['grove', 15], ['barriers', 10], ['cones', 10], ['open', 10]] },
    parking: { weight: 24, holeChance: 0, roadHoles: [0, 0], landmarks: ['MALL', 'PARK'], cells: [['parking', 65], ['garden', 25], ['grove', 5], ['open', 5]] },
    plaza: { weight: 8, holeChance: 0, roadHoles: [0, 0], landmarks: ['GAMES', 'DINER'], cells: [['garden', 30], ['grove', 30], ['open', 20], ['cones', 20]] },
    industrial: { weight: 12, holeChance: 0.12, roadHoles: [1, 1], landmarks: ['GAS', 'DEPOT'], cells: [['yard', 60], ['barriers', 25], ['cones', 15]] },
    ruins: { weight: 4, holeChance: 1, roadHoles: [1, 2], landmarks: ['STOP', 'GAS'], cells: [['sinkhole', 15], ['open', 50], ['barriers', 20], ['cones', 15]] },
  },
};

// [TUNE] Sinkholes and missing road sections. A car falls when its centre is over the hole, so
// clipping the edge is safe. The drawn hole is a little bigger than the part that swallows cars.
export const VOID = {
  holeRadius: [55, 80], // round holes in a road ...
  holeSideShift: 35, // ... pushed this far to one side, leaving a lane open
  gapChance: 0.35, // share of road holes that are a whole missing section instead
  gapHalfLength: [55, 85],
  gapHalfWidth: 92, // roads are 190 wide
  sinkholeRadius: [95, 150], // big holes inside city blocks
  outlineGrow: 16,
  fallSeconds: 1,
  fallFriction: 1.2, // it carries most of its speed over the edge ...
  fallInset: 8, // ... until the far wall of the hole stops it, this far short of the edge
  fallScale: 0.85, // drawn size at the bottom of the fall: the camera has no perspective, so only a little
  fallDrop: 280, // screen units it drops, faster and faster, hidden by the near lip of the hole as it goes
  fallTiltDeg: 24, // it tips nose first
  fallTipShare: 0.35, // over this share of the fall
  resultsDelay: 0.7, // real seconds between the end of the fall and the results screen
};

// Where each run starts (on a road crossing, inside its chunk), and the open space kept clear around it.
export const START = {
  x: 3000,
  y: 3000,
  clearRadius: 400,
};

// [TUNE] Stars on the results screen: one for each of these survival times.
export const STARS = [10, 20, 35, 50, 75];

// How far the distance read-outs count a world unit to be. A car is 84 units long, about 4.2 metres.
export const UNITS_PER_METER = 20;

export const CAR_SIZE = {
  // Placeholder car footprint in world units.
  width: 44,
  length: 84,
};

export const INPUT = {
  // Analog stick movement smaller than this is ignored.
  gamepadDeadZone: 0.35,
  // A double tap (touch screens): two short taps close together, in about the same place. Holding to
  // steer never counts, and neither do quick taps left then right.
  tapMaxMs: 220, // a touch longer than this is steering, not a tap
  doubleTapMs: 320, // the second tap must start this soon after the first ended
  doubleTapDistance: 110, // CSS pixels between the two taps
};

export const UI = {
  // UI is sized for a ~420 CSS px wide phone, then scaled within these limits.
  referenceShortSide: 420,
  minScale: 0.85,
  maxScale: 1.5,
  margin: 12,
};

// Interface colors. World colors are in PALETTE below.
export const COLORS = {
  warning: 0xff3b30,
  warningBack: 0x14080a,
};

export const STORAGE_KEYS = {
  handlingPreset: 'devHandling', // debug tools only
  view: 'devView', // debug tools only
  mapBest: 'mapBest', // { map id: best time }
  selectedMap: 'selectedMap', // map id
  totalCoins: 'totalCoins', // a whole number
  unlockedCars: 'unlockedCars', // [car id, ...]
  selectedCar: 'selectedCar', // car id
  best: 'bestRun', // { time, wrecks, nearMisses, combo }
  totals: 'totals', // { runs, wrecks, seconds }
  settings: 'settings', // { sound }
};

// Physics is advanced in equal steps no longer than this, whatever the screen's refresh rate.
export const PHYSICS = {
  maxStepSeconds: 1 / 120,
};

// [TUNE] Handling. Units: world units, seconds, degrees.
// grip* and *Rate values are "per second" rates: higher = snappier.
// Temporary presets for playtesting (Milestone 1). After testing we keep one and delete the rest.
const SHARED_HANDLING = {
  topSpeed: 300, // design doc starting point
  acceleration: 420, // reaches top speed in ~0.7 s from a standstill
  fullTurnSpeed: 140, // below this speed steering is weaker (no spinning on the spot)
  overspeedDrag: 2,
  curbEngineShare: 0.15, // share of the acceleration available while on a curb (above 0, so a car can't stall on one)
  slideFullSlip: 170, // sideways speed (units/s) that counts as a full slide for the settings below
  deepSlideStartDeg: 30, // slip angle where the extra speed loss of a deep slide starts ...
  deepSlideRangeDeg: 20, // ... and how many degrees later it is at full strength
  // How the body moves on its springs. Drawing only: nothing in the physics reads these.
  rollMaxDeg: 8, // body lean toward the outside of a hard turn ...
  rollFullAccel: 800, // ... reached at this much sideways force (speed x turn rate)
  rollSpring: 130, // stiffness: how quickly the weight shifts
  rollDamping: 10, // low enough to overshoot and settle, like real suspension
  pitchMaxDeg: 4, // the nose dipping when slowing or turning in, and lifting when accelerating ...
  pitchFullAccel: 420, // ... reached at this much acceleration or braking
  pitchTurnShare: 0.4, // a hard turn dips the nose this share of the way
  selfAlign: 0, // radians per second per radian of slide: with no steering, the nose swings back toward the way the car is going
  slideEngineLoss: 0, // share of engine power lost in a full slide (the tires are busy going sideways)
  slideCountsAsSpeed: true, // top speed covers forward and sideways together, so turning can't add speed
  // The extras below are the player's advantage: police keep these at zero (see the presets).
  slideGripLoss: 0, // share of grip lost in a full slide
  counterSteerBonus: 0, // extra turn rate when steering into a full slide (0.5 = 50% faster)
  deepSlideScrub: 0, // extra speed loss (units/s per second) in a deep slide
};

export const HANDLING_PRESETS = {
  grippy: {
    ...SHARED_HANDLING,
    slideCountsAsSpeed: false, // kept as it was, to compare with
    label: 'Grippy',
    maxTurnRateDeg: 170,
    steerResponse: 14, // how fast the nose reaches full turn rate
    gripStraight: 14, // sideways grip when not steering
    gripTurning: 11, // sideways grip while steering (lower = more slide)
    gripChangeRate: 10, // how fast grip switches between the two
    slideScrub: 0.3, // forward speed lost while sliding
    slideGripLoss: 0.1,
    counterSteerBonus: 0.3,
    deepSlideScrub: 30,
  },
  balanced: {
    ...SHARED_HANDLING,
    label: 'Balanced',
    maxTurnRateDeg: 180,
    steerResponse: 7.5,
    gripStraight: 9,
    gripTurning: 4.8,
    gripChangeRate: 3,
    slideScrub: 0.5,
    slideGripLoss: 0.15,
    counterSteerBonus: 0.5,
    deepSlideScrub: 40,
    selfAlign: 6,
  },
  drifty: {
    ...SHARED_HANDLING,
    slideCountsAsSpeed: false, // kept as it was, to compare with
    label: 'Drifty',
    maxTurnRateDeg: 185,
    steerResponse: 8,
    gripStraight: 6.5,
    gripTurning: 3.8,
    gripChangeRate: 3,
    slideScrub: 0.35,
    slideGripLoss: 0.05,
    counterSteerBonus: 0.7,
    deepSlideScrub: 20,
  },
};

export const HANDLING_PRESET_ORDER = ['grippy', 'balanced', 'drifty'];
export const DEFAULT_HANDLING_PRESET = 'balanced';

// [TUNE] What a run earns.
export const COINS = {
  perSecond: 2,
  perWreck: 5,
  perCombo: 10, // for each step of the run's best combo
  tallyMs: 700, // the count-up on the results screen (drawing only)
};

// [TUNE] The cars, cheapest first, bought with coins. handling: changes from Balanced. scale: its size in play, collisions
// included. mass: a share of the normal car's, which also sets how much harder a hit it survives (see below),
// so a bigger car is always a tougher one. plows: light props and curbs don't slow it. The models are in render/playerCars.js.
export const CARS = [
  { id: 'coupe', name: 'Classic Coupe', price: 0, scale: 1, mass: 1, plows: false,
    handling: { topSpeed: 320, maxTurnRateDeg: 195, gripTurning: 4.2 } },
  { id: 'hatchback', name: 'Pocket Hatchback', price: 500, scale: 0.92, mass: 0.8, plows: false,
    handling: { topSpeed: 310, maxTurnRateDeg: 230, gripTurning: 5.5, acceleration: 470 } },
  { id: 'tuktuk', name: 'Tuk-Tuk', price: 1000, scale: 0.85, mass: 0.7, plows: false,
    handling: { topSpeed: 285, maxTurnRateDeg: 240, gripTurning: 5, acceleration: 450 } },
  { id: 'van', name: 'Drift Van', price: 1500, scale: 1.06, mass: 1.3, plows: false,
    handling: { topSpeed: 330, maxTurnRateDeg: 180, gripTurning: 3.2, gripStraight: 5, gripChangeRate: 1.8, selfAlign: 2.5 } }, // its slides last
  { id: 'pickup', name: 'Pickup', price: 2000, scale: 1.02, mass: 1.25, plows: false,
    handling: { topSpeed: 325, maxTurnRateDeg: 185, gripTurning: 3.8 } },
  { id: 'highway', name: 'Highway Interceptor', price: 3000, scale: 1, mass: 1, plows: false,
    handling: { topSpeed: 375, maxTurnRateDeg: 180, gripTurning: 3.8 } },
  { id: 'muscle', name: 'Muscle Car', price: 4000, scale: 1.02, mass: 1.15, plows: false,
    handling: { topSpeed: 370, maxTurnRateDeg: 168, gripTurning: 3.4, acceleration: 460 } },
  { id: 'ram', name: 'Battering Ram', price: 5000, scale: 1.12, mass: 2.2, plows: true,
    handling: { topSpeed: 295, maxTurnRateDeg: 160, gripTurning: 4.4, acceleration: 340 } },
  { id: 'bus', name: 'Flower Bus', price: 6500, scale: 1.06, mass: 1.4, plows: false,
    handling: { topSpeed: 300, maxTurnRateDeg: 170, gripTurning: 3.4, acceleration: 360 } },
  { id: 'suv', name: 'Trail SUV', price: 8000, scale: 1.06, mass: 1.5, plows: false,
    handling: { topSpeed: 315, maxTurnRateDeg: 185, gripTurning: 4.6 } },
  { id: 'tailfin', name: 'Tailfin Cruiser', price: 10000, scale: 1.04, mass: 1.3, plows: false,
    handling: { topSpeed: 355, maxTurnRateDeg: 175, gripTurning: 3.4 } },
  { id: 'hearse', name: 'Night Hearse', price: 12500, scale: 1.02, mass: 1.3, plows: false,
    handling: { topSpeed: 360, maxTurnRateDeg: 165, gripTurning: 3.3 } },
  { id: 'rally', name: 'Rally Wing', price: 15000, scale: 0.98, mass: 0.9, plows: false,
    handling: { topSpeed: 375, maxTurnRateDeg: 218, gripTurning: 4.6, acceleration: 480 } },
  { id: 'camper', name: 'Camper', price: 18000, scale: 1.12, mass: 1.6, plows: true,
    handling: { topSpeed: 300, maxTurnRateDeg: 160, gripTurning: 3, acceleration: 340 } },
  { id: 'hypercar', name: 'Hypercar', price: 25000, scale: 0.98, mass: 0.9, plows: false,
    handling: { topSpeed: 420, maxTurnRateDeg: 192, gripTurning: 4.2, acceleration: 520 } },
  { id: 'firetruck', name: 'Fire Engine', price: 35000, scale: 1.16, mass: 2.4, plows: true,
    handling: { topSpeed: 315, maxTurnRateDeg: 165, gripTurning: 3.8, acceleration: 350 } },
  { id: 'bulldozer', name: 'Bulldozer', price: 50000, scale: 1.2, mass: 3.2, plows: true, armor: 2,
    handling: { topSpeed: 280, maxTurnRateDeg: 155, gripTurning: 5, acceleration: 300 } },
  { id: 'monster', name: 'Monster Truck', price: 75000, scale: 1.2, mass: 2.8, plows: true, armor: 2,
    handling: { topSpeed: 325, maxTurnRateDeg: 175, gripTurning: 4.2, acceleration: 400 } },
  { id: 'tank', name: 'Tank', price: 100000, scale: 1.2, mass: 4.5, plows: true, armor: 3,
    handling: { topSpeed: 265, maxTurnRateDeg: 150, gripTurning: 6, acceleration: 260 } },
];

// How much harder a hit than normal each car survives. Worked out from its mass, never set by hand.
for (const car of CARS) car.durability = Math.sqrt(car.mass);

// What the garage shows: each car's real numbers, as a share (0 to 1) of the way from the worst car to the best.
// Worked out, never set by hand, so the screen can't drift from how the car really drives.
const SPEC_READINGS = {
  speed: (car) => handlingFor(car).topSpeed,
  acceleration: (car) => handlingFor(car).acceleration,
  handling: (car) => handlingFor(car).maxTurnRateDeg + handlingFor(car).gripTurning * 8, // how fast it turns, and how well it holds that turn
  durability: (car) => car.durability,
};

export function carSpecs(car) {
  const specs = {};
  for (const [name, read] of Object.entries(SPEC_READINGS)) {
    const values = CARS.map(read);
    const low = Math.min(...values);
    specs[name] = (read(car) - low) / (Math.max(...values) - low);
  }
  return specs;
}

// [TUNE] The maps. stars: how many stars, added up across every map's best run, unlock it. palette: what it
// changes from the colours in PALETTE. trees: what grows on it. marks: soft patches on its ground; patch: tufts.
// open: no roads are painted, only open ground with faint tire tracks where the roads run. The driving is the same.
export const MAPS = [
  {
    id: 'suburb',
    name: 'SUBURBS',
    stars: 0,
    palette: {},
    streets: true, // real streets: curbs, pavements, rounded corners and worn asphalt (WORLD.street)
    trees: ['leafy', 'leafyDark'],
    lamp: 'lamp',
    shop: 'shop',
    marks: { perCell: 1.5, colors: ['asphaltPatchDark', 'asphaltPatchLight'], alpha: 0.6, size: [30, 85], stretch: 1.8 },
    startPreset: 'suburb',
    presets: null, // CHUNKS.presets
  },
  {
    id: 'winter',
    name: 'WINTER',
    stars: 3,
    palette: {
      asphalt: 0xd3dde9, // the snow itself
      uiGround: 0x59627a,
      track: 0x7f90a8,
      lot: 0xd3dde9,
      plaza: 0xb4c0d0,
      curb: 0x9fafc3,
      median: 0xf4f7fa,
      medianTuft: 0xdde6f0,
      boulder: 0x8f98a6,
      pine: 0x2f7a4a,
      pineDark: 0x24603c,
      asphaltPatchDark: 0xbecbdc,
      asphaltPatchLight: 0xf1f5f9,
      barrier: 0xf4f7fa,
    },
    trees: ['snowpine'],
    lamp: 'lamp',
    shop: 'cabin',
    open: true,
    marks: { perCell: 3, colors: ['asphaltPatchDark', 'asphaltPatchLight'], alpha: 0.8, size: [110, 300], stretch: 2.2, drifts: 0.6 },
    startPreset: 'snow',
    presets: {
      snow: { weight: 1, holeChance: 0.05, roadHoles: [1, 1], landmarks: ['WINTER', 'PARK'], cells: [['parking', 30], ['lawn', 34], ['shop', 12], ['booth', 8], ['station', 6], ['barriers', 6], ['open', 4]] },
    },
  },
  {
    id: 'desert',
    name: 'DESERT',
    stars: 6,
    palette: {
      asphalt: 0xdcb077, // the sand itself
      uiGround: 0x56545c,
      track: 0x9c7445,
      lot: 0xdcb077,
      plaza: 0xcfa469,
      curb: 0xc98f55,
      median: 0xedc98a,
      medianTuft: 0xd8ad6e,
      boulder: 0xb5653f,
      asphaltPatchDark: 0xcf9f62,
      asphaltPatchLight: 0xeecb94,
      paintWhite: 0xf4e9d4,
      trunk: 0x6b4a2c,
    },
    trees: ['cactus'],
    lamp: 'pole',
    shop: 'shop',
    extras: ['mesa', 'tower'],
    open: true,
    marks: { perCell: 3, colors: ['asphaltPatchDark', 'asphaltPatchLight'], alpha: 0.75, size: [110, 300], stretch: 2.2, drifts: 0.75 },
    startPreset: 'dunes',
    presets: {
      dunes: { weight: 1, holeChance: 0.08, roadHoles: [1, 1], landmarks: ['DESERT', 'GAS'], cells: [['lawn', 22], ['mesa', 26], ['grove', 20], ['shop', 10], ['tower', 10], ['barriers', 7], ['station', 5]] },
    },
  },
  {
    id: 'woods',
    name: 'WOODS',
    stars: 9,
    palette: {
      asphalt: 0x5d5a4a,
      lot: 0x8f9040,
      plaza: 0x7f8038,
      curb: 0x6f7030,
      median: 0xa6a84c,
      medianTuft: 0x7f8234,
      boulder: 0x9d9d92,
      pine: 0x5e7a34,
      pineDark: 0x4a6530,
      asphaltPatchDark: 0x6f7030,
      asphaltPatchLight: 0x7c7e36,
    },
    trees: ['pine', 'dead'],
    lamp: 'pole',
    shop: 'cabin',
    extras: ['log'],
    marks: { perCell: 1.5, colors: ['asphaltPatchDark', 'asphaltPatchLight'], alpha: 0.7, size: [50, 140], stretch: 1.8, lotOnly: true },
    patch: { perCell: 12, colors: ['asphaltPatchDark', 'asphaltPatchLight'], alpha: 0.9, size: [10, 20], lotOnly: true, tuft: true },
    startPreset: 'forest',
    presets: {
      forest: { weight: 1, holeChance: 0.04, roadHoles: [1, 1], landmarks: ['WOODS'], cells: [['grove', 38], ['logs', 28], ['lawn', 14], ['open', 8], ['shop', 7], ['station', 5]] },
    },
  },
];

export function mapById(id) {
  return MAPS.find((map) => map.id === id) || MAPS[0];
}

export function carById(id) {
  return CARS.find((car) => car.id === id) || CARS[0];
}

export function handlingFor(car) {
  return { ...HANDLING_PRESETS.balanced, label: car.name, ...car.handling };
}

// ---------------------------------------------------------------------------------------------
// Survival loop. Everything below is [TUNE]: first guesses checked with the simulation tests
// (scratchpad bot runs), to be adjusted after real playtests. See TUNING_LOG.md.
// ---------------------------------------------------------------------------------------------

// Police handling: same driving model as the player, less grip and slower turning, a little faster.
export const POLICE_HANDLING = {
  ...SHARED_HANDLING,
  label: 'Police',
  maxTurnRateDeg: 122, // ~68% of the player's: the player escapes by turning
  steerResponse: 7,
  gripStraight: 8,
  gripTurning: 5,
  gripChangeRate: 4,
  slideScrub: 0.4,
};

export const POLICE = {
  // Speed and turning grow over the run: see HEAT.
  steerGain: 2.4, // steering = angle to target x gain (clamped to full lock)
  retargetMin: 0.12, // seconds between target updates (reaction time), random in this range
  retargetMax: 0.32,
  aimJitter: 70, // each car aims a little to one side of the player, so they don't all follow one line
  ramDistance: 220, // closer than this, chasers stop aiming to one side and interceptors stop manoeuvring
  awareness: 0.6, // chance, at each reaction, that a car checks for a prop in its path
  lookAhead: 60, // how far ahead it checks: this + speed x lookAheadSeconds
  lookAheadSeconds: 0.25,
  swerveAngle: 0.6, // radians: where it looks for a way around
  probeRadius: 26,
  stuckSpeed: 40,
  stuckSeconds: 2.2,
  maxActive: 28, // performance cap
  maxCars: 48, // police + wrecks on the map
};

// [TUNE] Interceptors: black-and-white cruisers that aim at where the player is going to be.
export const INTERCEPTOR = {
  leadMin: 0.45, // lead time (seconds) up close ...
  leadMax: 1.6, // ... and far away: lead time = time for this car to reach the player, within these limits
  speedBonus: 0.07, // added to HEAT.speedFactor: they are the fast ones
  turnBonusDeg: 8, // added to HEAT.turnDeg
  crossingSnap: 170, // when the predicted point is this close to a crossing, aim at the crossing itself
  ambushDistance: 420, // ... but only while further than this from the player
  flankDistance: 650, // closer than this and behind the player, swing out to the side ...
  flankOffset: 170, // ... by this much, rather than tailgating
  spawnAngleDeg: [50, 115], // arrive from this far round from the direction of travel (the side streets)
};

// [TUNE] Roadblocks: parked cruisers across a crossing ahead. They don't chase and don't count
// toward HEAT.police. Hit one hard and the run is over; lure police into one and they pile up.
export const ROADBLOCK = {
  firstAt: 40, // seconds into the run
  everyMin: 12, // seconds between roadblocks, random in this range
  everyMax: 18,
  retrySeconds: 1, // no suitable crossing right now: look again this soon
  cars: 2,
  maxParked: 6,
  spacing: 150, // between the cars, with the spike strip in the gap
  angleDeg: 28, // the cars are angled in, like a V across the road
  spikeHalfLength: 42, // the strip, across the road ...
  spikeHalfDepth: 13, // ... and along it
  spikeSeconds: 30, // it is taken away after this long, once out of sight
  maxSpikes: 3,
  mass: 2.2, // shoved less than a moving car
  distances: [900, 1200, 1500, 1800, 2100, 2300], // how far ahead to look for a crossing, nearest first
  screenMargin: 90, // screen units: only placed this far outside the view
  clearance: 130,
};

// [TUNE] Warning arrows at the screen edge for police arriving from out of sight.
export const WARNING = {
  closingInterceptor: 60, // interceptors count when approaching faster than this (units/s)
  closingFast: 200, // other police need this: tailing cars close far slower, so they never count
  maxSeconds: 5, // not until this close to arriving
  fadeInside: 130, // screen units inside the view over which the arrow fades away
  fadeRate: 8, // how quickly an arrow fades in and out (per second)
  minLevel: 0.03,
  maxShown: 5,
  size: 7.5, // at the UI's reference size
  pulse: 0.6, // how much it swells and shrinks
  pulseMs: 130,
  alpha: 0.55, // subtle: a hint at the edge of the screen, not an alarm
  // The siren light that sweeps across the road ahead of an arriving car.
  beamReach: 0.8, // share of the way from the car to the player
  beamMaxLength: 1500,
  beamWidth: 300, // at its far end
  beamAlpha: 0.38,
};

// [TUNE] How the pressure builds. Each table is [seconds survived, value]; in between, values blend.
//   0-15 s   2 to 4 basic chasers, to ease the player in
//   15-30 s  interceptors arrive
//   30-45 s  top speed climbs, SWAT Bearcats arrive, roadblocks start at 35 s (ROADBLOCK)
//   45 s +   full tactical pursuit: the helicopter (HELICOPTER), more cars, more of them interceptors
//            and Bearcats, and interceptors react faster
export const HEAT = {
  police: [[0, 2], [15, 4], [30, 7], [45, 10], [75, 16], [110, 22], [160, 26]],
  interceptorShare: [[14.99, 0], [15, 0.3], [30, 0.35], [45, 0.5], [90, 0.6]],
  bearcatShare: [[44.99, 0], [45, 0.14], [70, 0.2], [110, 0.26]], // share of new cars that are Bearcats
  speedFactor: [[0, 1.04], [30, 1.05], [70, 1.1], [150, 1.14]], // x the player's top speed of 300
  turnDeg: [[0, 118], [150, 136]],
  reaction: [[70, 1], [110, 0.65]], // interceptors' reaction time, x normal
};

// [TUNE] SWAT Bearcat: a heavy armoured truck. Slow to turn, hard to stop.
export const BEARCAT = {
  scale: 1.22, // bigger than a cruiser, in collisions as well as on screen
  mass: 7, // the player's car is 1.25: it barely notices a nudge
  speedShare: 0.98, // of HEAT.speedFactor: heavy, but nothing like slow on a straight
  turnDeg: 82,
  acceleration: 200,
  steerResponse: 4.5,
  gripStraight: 5.5, // it slides wide round corners
  gripTurning: 3.4,
  aimAheadSeconds: 0.35, // it can't turn fast enough to catch anything by tailing it
  fatalImpact: 40, // any contact harder than this wrecks the player; only a light brush is survivable
  obstacleImpact: 270, // it only wrecks itself on solid props at nearly full speed, head on
  carImpact: 500, // other police just bounce off it, or wreck on it
  maxActive: 4,
};

// [TUNE] Flat tires, from driving over a spike strip.
export const FLAT_TIRE = {
  seconds: 3,
  attackSeconds: 0.15, // how fast the tire goes ...
  releaseSeconds: 0.8, // ... and the end of the 3 s, while the car comes back to normal
  jolt: 1.1, // radians per second: the sudden swerve toward the flat corner as it blows
  pull: 0.42, // the flat corner drags the car its way, as a share of full steering lock ...
  steerShare: 0.55, // ... and the steering answers this much, so it can just be held straight
  shimmy: 0.12, // the wheel shaking in the driver's hands
  shimmyRate: 26, // radians per second
  accelShare: 0.2, // of normal acceleration
  topSpeedShare: 0.6, // the drag slows the car down to this, over about a second
  gripShare: 0.45,
  smokeEveryMs: 70,
  leanDeg: 3.5, // drawing only: the car sits down on the flat corner ...
  rattle: 1.6, // ... and rattles, by this many screen units ...
  rattleRate: 0.055, // ... this fast (radians per millisecond)
};

// [TUNE] The police helicopter. It can't be stopped; it arrives at 45 s.
export const HELICOPTER = {
  bladeWidth: 4.5, // half a rotor blade's width at the hub
  rotorBlurAlpha: 0.42,
  shadowWidth: 78, // its soft shadow on the road
  shadowLength: 190,
  shadowAlpha: 0.55,
  firstAt: 70,
  arriveDistance: 1500,
  height: 250,
  swoopHeight: 120,
  swoopSeconds: 0.7,
  leadSeconds: 0.7, // it flies this far ahead of the car
  followSharpness: 1.3,
  turnSharpness: 2.5,
  sway: 110,
  swaySpeed: 0.8,
  spotSharpness: 4,
  rotorSpeed: 34, // radians per second (drawing only)
  spotRadius: 150, // the searchlight on the road (drawing only)
  spotAlpha: 0.5,
  spotOverAlpha: 0.14,
  beamWidth: 170,
  beamAlpha: 0.17,
  // Dropping things on the road.
  firstDropAfter: 4,
  dropEveryMin: 6,
  dropEveryMax: 10,
  dropAheadSeconds: 1.7, // aims this far ahead of the car, along its path ...
  warningSeconds: 1.2, // ... and a flare marks the spot for this long before the block lands
  fallSeconds: 0.4, // the end of that warning, while the block is falling into view
  fallHeight: 320,
  minTargetSpeed: 120,
  safeDistance: 95, // a block never lands this close to the car
  blockHalfSize: 30,
  blockHeight: 52,
  blockSeconds: 7,
  sinkSeconds: 0.6,
  maxDrops: 3,
};

export const SPAWN = {
  firstSpawnAt: 1.3, // seconds into the run
  speedMin: 0.8, // police arrive already moving: this share of their top speed ...
  speedMax: 1, // ... up to this, at random
  laneOffset: 45, // how far from the road's centre line they drive in
  intervalStart: 0.9, // seconds between spawns, shrinking to intervalEnd
  intervalEnd: 0.4,
  intervalRampSeconds: 90,
  aheadShare: 0.35, // share of spawns placed ahead of the player (they come at you)
  screenMargin: 130, // spawn this far outside the screen edge (screen units)
  minDistance: 700, // never closer to the player than this
  minAheadDistance: 820, // ... and further still when coming from ahead (reaction time)
  clearance: 70, // free space needed around a spawn point
  attempts: 10,
};

// Collisions. Cars are two circles each; props are circles or rotated boxes.
export const COLLISION = {
  carCircleRadius: 21,
  carCircleOffset: 21, // circle centres sit this far ahead of / behind the car centre
  obstacleBounce: 0.25, // share of speed into an obstacle that bounces back
  carBounce: 0.35,
  scrape: 0.92, // share of speed along the surface kept when scraping
  noseDeflect: 0.35, // after a hit the nose is turned this much beyond "along the surface"
  deflectFullAt: 120, // impact speed at which the nose deflection is complete
  spin: 0.0006, // how much an off-centre car-to-car hit spins the cars
  wreckMass: 2.2, // wrecks are pushed less than driving cars
  playerMass: 1.25,
  treeRadius: 13,
  lampRadius: 7,
  coneRadius: 11,
  civilianHalfWidth: 22, // parked cars are boxes the size of a car
  civilianHalfLength: 42,
  woodCrateRadius: 15,
  monumentRadius: 36,
  roundaboutRadius: 150,
  gridCell: 300,
};

// [TUNE] Impact = speed along the collision direction (units/s). Glancing scrapes stay low.
export const CRASH = {
  playerImpact: 215, // the player's car is wrecked above this (police, wrecks, walls, props)
  policeObstacleImpact: 150, // police wreck against props / walls above this
  policeCarImpact: 145, // police wreck against other police / wrecks / the player above this
  scrapeImpact: 20, // a touch above this (and too small to be a bump) is reported as a scrape
  pinnedSpeed: 45, // the player is "busted" when held below this speed ...
  pinnedSeconds: 1.4, // ... for this long (boxed in by police)
  pinnedGrace: 2, // not during the first seconds of a run (the car starts from a standstill)
  slowMotion: 0.3, // game speed right after the crash
  gameOverDelay: 1.4, // real seconds between the crash and the results screen
};

// [TUNE] Phone vibration (milliseconds, or a pattern of on / off). Phones that can't vibrate, and iPhones, ignore it.
export const HAPTICS = {
  crash: [70, 40, 140],
  shield: 45,
};

// [TUNE] Armour: the heaviest cars (armor in CARS) shrug off a crash at the cost of a shield. A fall into a hole
// still ends the run.
export const ARMOR = {
  hitSafeSeconds: 1, // after losing a shield, a moment in which the same pile-up can't take another
};

// [TUNE] A second chance, once a run: after a crash the player can pay coins, or watch an ad, to carry on.
export const REVIVE = {
  cost: 150, // coins
  offerSeconds: 5, // how long the offer waits before the results
  clearRadius: 520, // police this close are blown away
  safeSeconds: 2, // nothing can wreck the car straight after
  speedShare: 0.6, // it starts again at this share of its top speed, along the road
  ringSeconds: 0.6, // the ring that blows the police away (drawing only)
  searchStep: 90, // how far along the road it looks for a clear spot ...
  searchSteps: 14, // ... and how many times each way
};

export const WRECK = {
  lifetime: 3.5, // seconds a wreck stays on the map (an obstacle for other police)
  fadeSeconds: 0.6,
  friction: 2.6, // how fast a wreck slides to a stop (per second)
  spinFriction: 3,
  kick: 130, // a wrecked car is shoved this hard in a random direction (units/s), so it never just stops
  spinKick: 9, // and spun, up to this fast either way (radians per second)
};

// [TUNE] How a wreck is thrown about on screen. Drawing only: see render/Tumble.js.
export const TUMBLE = {
  hopMin: 34, // how high the blast lifts it (world units)
  hopMax: 58,
  airSeconds: 0.38,
  bounceShare: 0.22, // the bounce after landing, as a share of the first height
  bounceSeconds: 0.16,
  spin: 0.9, // how far it turns while in the air, up to this much either way (radians)
  tiltDeg: 7, // it leans over a little while in the air
  overFlamesHeight: 12, // above this height it is drawn in front of the fireball
  playerTimeScale: 0.6, // the player's crash runs in slow motion, so its tumble uses this share of real time
};

// [TUNE] What fire does to a car's colours (0 = untouched, 1 = all soot). See burntOut in render/carModels.js.
export const BURNT = {
  burntMin: 0.7,
  burntMax: 0.95,
  shadowAlpha: 0.72,
  shadowGrow: 1.5, // the soft shadow's size against the car's
  shadowLift: 14, // how far the sun throws it, as if the car stood this tall
};

export const EXPLOSION = {
  radius: 125, // nearby police are pushed away ...
  chainRadius: 58, // ... and the very closest are wrecked too (pile-ups)
  push: 360,
  playerPush: 0.3, // share of the push the player feels (explosions never wreck the player)
  shakeDistance: 750,
};

export const NEAR_MISS = {
  distance: 76, // centre-to-centre distance that counts as a close call (gap of about 30)
  minRelativeSpeed: 170,
  cooldown: 2.5, // seconds before the same police car can give another one
};

export const COMBO = {
  window: 1.6, // police wrecked within this many seconds of each other form a combo
};

export const CONES = {
  knockSpeed: 0.85, // share of the hitting car's speed given to the cone
  flySeconds: 1.1,
  hop: 26,
  respawnSeconds: 25,
  slowdown: 0.97, // a cone barely slows the car down
  spin: 18, // how fast a knocked cone can spin (radians per second)
  // Other breakable props: how they differ from a cone (a wooden crate behaves like one).
  // 'crushed' is for solid props flattened by the Giant car.
  kinds: {
    crushed: { knockSpeed: 0.9, slowdown: 1, spin: 3, sideKick: 240, flySeconds: 1.6, hop: 60 },
    lamp: { knockSpeed: 0.85, slowdown: 0.88, spin: 5 }, // a long post tips over rather than whirls
    pole: { knockSpeed: 0.85, slowdown: 0.88, spin: 5 },
    log: { knockSpeed: 0.8, slowdown: 0.92, spin: 6 },
    civilian: { knockSpeed: 0.8, slowdown: 0.82, spin: 2.5, sideKick: 190, flySeconds: 2.2, hop: 46 }, // a parked car bounces aside, and costs real speed
  },
};

// [TUNE] Hit-stop: the action freezes for a moment on big hits. Real milliseconds, not frames.
export const HITSTOP = {
  scrapeMs: 36, // a glancing hit
  bumpMs: 40,
  smashMs: 40, // the player smashing a parked car
  wreckMs: 40, // a police car wrecked close to the player ...
  wreckRange: 520, // ... this close (world units)
  crashMs: 45, // the player's own crash, before the slow motion
  comboMs: 45, // a double wreck or bigger pile-up
  crushMs: 40, // the Giant car flattening a police car
  cooldownMs: 320, // no second freeze this soon, so swarms don't turn into stutter
};

// Drive-over curbs (parking islands). The penalty applies once each time a car climbs on.
export const CURB = {
  speedKeep: 0.82, // share of speed kept when climbing on
  bumpDeflect: 0.3, // share of the speed INTO the curb edge removed, so the car is nudged along it
  noseDeflect: 0.12, // how much the bump turns the nose toward "along the edge"
};

// [TUNE] The lucky die: it bounces after the car from the moment it appears, and gives a random item.
export const POWERUP = {
  // How often each item comes up, compared with the others.
  kinds: { shockwave: 1, giant: 1, freeze: 1, pillars: 1, flamer: 1, turbo: 1, slick: 1, decoy: 1, blackout: 1, phantom: 1 },
  // What the player sees.
  names: { shockwave: 'KABOOM', giant: 'TITAN', freeze: 'COLD SNAP', pillars: 'STONEWALL', flamer: 'SCORCHER', turbo: 'TURBO', slick: 'SLICK', decoy: 'DECOY', blackout: 'BLACKOUT', phantom: 'PHANTOM' },
  // See AUDIO.files. The five newer items are silent until their files arrive: nothing is made up in code.
  sounds: { shockwave: ['shockwave', 'kaboom'], giant: ['titan'], freeze: ['cold_snap'], pillars: ['stone_wall'], flamer: ['scorcher'], turbo: [], slick: [], decoy: [], blackout: [], phantom: [] },
  autoSeconds: 2.5, // a held item fires by itself after this long, unless double tapped first
  homingSpeed: 150, // it goes this much faster than the car, so it always catches up
  hopMs: 400, // each bounce (drawing only)
  hopHeight: 52, // world units (drawing only)
  absorbSeconds: 0.32, // the die sinking into the car (drawing only)
  firstAt: 14, // seconds into the run
  interval: 17, // seconds between dice (only when the player isn't already holding an item)
  minDistance: 520,
  maxDistance: 950,
  aheadAngleDeg: 70,
  clearance: 80,
  collectRadius: 54,
  pulseRadius: 340,
  pulseSeconds: 0.55, // visual expansion time
  attempts: 14,
};

// [TUNE] GIANT: the car grows, and nothing can stop it.
export const GIANT = {
  scale: 3.2,
  seconds: 7,
  stiffness: 70, // the spring that sizes the car: higher = snappier
  damping: 7, // lower = more elastic bounce on the way up (the way down has no bounce)
  endScale: 1.15, // it stays unstoppable until it has shrunk to this
  mass: 8, // shoves everything aside
  crushFling: 260, // how hard a flattened police car is thrown
};

// [TUNE] FREEZE: a blast of frost stops every police car close by.
export const FREEZE = {
  radius: 400,
  seconds: 4.5,
  ringSeconds: 0.6, // the ring sweeping out over the ground (drawing only)
  mass: 4, // a frozen car is hard to shove
  shatterImpact: 60, // the player hitting one harder than this smashes it to bits ...
  shatterKeep: 0.85, // ... and drives on through, keeping this share of its speed
};

// [TUNE] PILLARS: a row of stone blocks erupts behind the car.
export const PILLARS = {
  count: 3,
  distance: 190, // behind the car
  spacing: 62, // between pillars: too narrow to drive through
  halfSize: 23,
  height: 96,
  seconds: 6, // how long they stand
  riseSeconds: 0.22, // drawing only
  sinkSeconds: 0.6, // drawing only: they stop being solid when they start to sink
  lethalImpact: 30, // police wreck on any hit harder than this
  pool: 9,
};

// [TUNE] FLAMER: the car leaves a trail of fire. Police that drive through it burn.
export const FLAMER = {
  seconds: 5,
  spacing: 26, // a patch every this many units driven
  behind: 42, // how far behind the car's centre they appear
  patchSeconds: 2.6, // how long a patch burns
  patchRadius: 26,
  tireReach: 16, // added to the patch radius: how near a car's centre must come for its tires to touch
  burnSeconds: 1, // from catching fire to exploding
  flamesPerSecond: 9, // flame clouds from each patch (drawing only)
  maxPatches: 45, // enough for all the fire burning at once: see tests/test_power.mjs
};

// [TUNE] TURBO: a burst of speed, far past the car's own top speed, with flames from the exhaust.
export const TURBO = {
  seconds: 3,
  speedShare: 1.45, // of the car's own top speed
  accelShare: 2.6, // of its acceleration: it surges, it doesn't creep
};

// [TUNE] SLICK: oil spilled behind the car. A police car that drives into it spins out.
export const SLICK = {
  puddles: 4, // laid one after another behind the car
  spacing: 70, // units driven between them
  behind: 60, // how far behind the car's centre
  radius: 46,
  seconds: 7, // how long a puddle stays
  spinSeconds: 1.4, // a police car spins this long, out of control
  spinRate: 7, // radians per second, the kick it gets
  grip: 0.6, // its grip while spinning (normal is about 5)
  maxPuddles: 12,
};

// [TUNE] DECOY: a copy of the car drives off, and police close by chase it instead.
export const DECOY = {
  seconds: 5,
  lureRadius: 1100, // police this close follow the decoy
  turnAway: 0.55, // radians: it peels off this much from the car's way
  minSpeed: 240,
};

// [TUNE] BLACKOUT: a pulse that kills police engines and lights close by. They coast to a stop.
export const BLACKOUT = {
  radius: 700,
  seconds: 3,
  coastFriction: 2.4, // how fast a dead car slows (per second)
  ringSeconds: 0.5, // drawing only
};

// [TUNE] PHANTOM: the car turns ghostly and passes through cars and walls. Holes still swallow it.
export const PHANTOM = {
  seconds: 3.5,
  extraSeconds: 2, // it stays a ghost a little longer if it would come back inside something solid
  alpha: 0.42, // drawing only
};

// [TUNE] Camera.
export const CAMERA = {
  followSharpness: 8, // how quickly the camera catches up (per second)
  leadSeconds: 2.2, // camera aims where the car will be this far ahead ...
  leadViewFraction: 0.21, // ... limited to this share of the view, so at speed the car sits in the rear third
  leadSharpness: 1.6, // how quickly the aim point swings round: low, so hard turns don't whip the view
  zoomOut: 0.9, // zoom at top speed, compared with the zoom at low speed
  zoomStartSpeed: 150, // the view starts widening above this speed ...
  zoomFullSpeed: 300, // ... and is fully widened here
  zoomSharpness: 1.5,
  giantZoom: 0.9, // extra widening at full Giant size. Limited by CHUNKS.size: see tests/test_power.mjs
};

// [TUNE] Screen shake: events add "trauma" (0..1), which drains over time. The shake's size is
// trauma squared, so small knocks stay subtle and big hits feel much bigger.
export const TRAUMA = {
  decayPerSecond: 1.3,
  maxOffset: 36, // screen units of shake at trauma 1
  shakeSpeed: 40, // how fast the shake moves
  scrape: 0.25,
  knock: 0.2, // cones and lamp posts
  smash: 0.45, // parked cars
  curb: 0.3,
  fall: 0.35,
  bump: 0.35,
  nearMiss: 0.4,
  explosion: 0.55, // right next to the player; fades with distance
  pulse: 0.6,
  crash: 1,
  flat: 0.5,
  shatter: 0.4,
  dropLand: 0.55, // a concrete block hitting the road, at full strength close by
  giant: 0.5, // growing
  giantRumble: 0.22, // held all the time the car is Giant: the ground shakes
  crush: 0.5, // flattening a police car
  freeze: 0.45,
  pillars: 0.4,
  ignite: 0.15,
};

// [TUNE] Skid marks.
// [TUNE] How the car's body is drawn moving on its suspension (the amounts of lean are in the handling above).
export const BODY_LEAN = {
  rollShift: 4.5, // world units the body moves over its wheels at full lean ...
  pitchShift: 2.5, // ... and forward or back at full pitch
  yawLeadSeconds: 0.035, // the nose is drawn this far ahead of the turn ...
  yawMaxDeg: 6, // ... up to this much
  shadowShare: 0.6, // how much of that movement the shadow follows
  wheelsFollow: 0.55, // the wheels share this much of the body's movement, so the car stays in one piece
  hopSpeed: 130, // knocks and curbs bounce the car (drawing only): upward speed from a hit this hard ...
  hopFullImpact: 150, // ... or harder
  hopGravity: 900,
  hopBounce: 0.4, // it comes back up this share of the speed it landed with
  hopTilt: 0.006, // radians of tilt per unit of height
};

export const SKIDS = {
  maxMarks: 900, // hard cap; the oldest mark is reused when full
  slipThreshold: 70, // sideways speed (units/s) above which tires leave marks
  width: 7,
  minSegmentLength: 10,
  lifetimeMs: 7000,
  alpha: 0.6,
  color: 0x0c0e12,
  rearAxle: 0.3, // rear wheels sit this share of car length behind the centre
  wheelSpread: 0.36, // ...and this share of car width either side
};

export const DEV_PANEL = {
  // Turntable inspection tool: car parks and spins in place (degrees per second).
  turntableSpinDeg: 30,
  turntableTurnDeg: 90, // while holding left / right
  readoutRefreshMs: 200,
};

// ---------------------------------------------------------------------------------------------
// 2.5D low-poly presentation. Physics NEVER reads anything below: it only changes how the flat
// world is drawn. See RENDERING.md and ART_DIRECTION.md.
// ---------------------------------------------------------------------------------------------

export const RENDER = {
  // Fixed camera. azimuth = how far the map is turned on screen (0 = north straight up);
  // elevation = how steeply the camera looks down (90 = straight down).
  // The View button cycles through these so you can compare. [TUNE]
  views: [
    { id: 'angled', label: 'Angled', azimuthDeg: 40, elevationDeg: 48 },
    { id: 'angled-high', label: 'Angled high', azimuthDeg: 40, elevationDeg: 58 },
    { id: 'angled-low', label: 'Angled low', azimuthDeg: 35, elevationDeg: 40 },
    { id: 'north-up', label: 'North-up', azimuthDeg: 0, elevationDeg: 55 },
  ],
  defaultViewId: 'angled-low',
  // Car drawings made at startup from the 3D model, evenly spaced around the compass.
  directions: 64,
  // Per model: wrecks barely turn, so fewer drawings (less memory) are enough.
  carDirections: { playerBody: 64, playerWheels: 32, police: 64, interceptor: 64, bearcat: 32, helicopter: 16, playerWreck: 16, policeWreck: 16, interceptorWreck: 16, bearcatWreck: 16 },
  // 0 = snap to the nearest drawing, 1 = also rotate by the small leftover angle (smoother turning).
  residualRotation: 1,
  // Pixels per world unit in the drawings baked at startup (cars and props).
  // The screen shows 0.9-2 px per unit on most devices, so 1.5 stays sharp without wasting memory.
  bakeScale: 1.5,
  // Two things cost a lot of graphics memory for little visible gain, so they are drawn coarser: shadows,
  // and low flat props (islands, roundabouts), which are big but have no fine detail.
  shadowBakeScale: 0.75,
  shadowSoftness: 2.2, // world units of soft edge on prop shadows
  flatBakeScale: 1,
  // Light, in camera terms: u = screen right, v = toward the viewer, z = up. [TUNE]
  // A low sun from the right and a little toward the viewer, so one side of everything is lit, the
  // other in shade, and long shadows fall to the upper left (about 1.2 x the object's height).
  keyLight: [0.72, 0.2, 0.62],
  keyGain: 0.58,
  fillLight: [-0.3, 0.8, 0.5], // soft light from the camera side so faces in shadow are not flat
  fillGain: 0.15,
  ambient: 0.38,
  skyGain: 0.1, // extra light on upward-facing surfaces (roofs, hoods, tops) so they read apart from the sides
  shadowLength: 1, // 1 = shadow length that matches the key light; lower = shorter shadows
  shadowColor: 0x0a0c1a,
  shadowAlpha: 0.42,
  // Soft dark patch right under each car (where little light reaches), so it sits on the ground.
  contactShadow: { alpha: 0.3, grow: 3 },
  seamWidth: 0.6, // world units; hides hairline gaps between neighbouring faces
};

// Draw order. Standing objects are sorted inside their band by the screen height of their ground point.
export const DEPTH = {
  ground: 0, // floor, markings, skid marks
  raised: 10, // low curbs and islands (always under cars)
  shadows: 20, // shadows of cars and props
  // Endless world: screen Y can be any size, so these bands are wide enough for days of driving.
  objects: 1e9, // + screen Y (always stays below `effects`)
  effects: 4e9,
};

// World colours: the comic-arcade palette (low-poly, flat shaded). See ART_DIRECTION.md.
export const PALETTE = {
  asphalt: 0x3e444f, // roads: slate grey
  uiGround: 0x3e444f, // behind the garage: always dark enough for the lettering
  track: 0x2f343d, // tire tracks on open ground
  lot: 0x484f5b, // city blocks (parking lots, forecourts): a little lighter than the roads
  asphaltPatchDark: 0x373d47,
  asphaltPatchLight: 0x464c58,
  paintWhite: 0xf8f6ef,
  sidewalk: 0x6c7381, // concrete pavements round the blocks
  crack: 0x2b3038, // cracks in the road, and the rims of manholes
  manhole: 0x4c535f,
  lawn: 0x7ea53b, // block lawns: a little deeper than the lime of the islands, so they don't glare
  curb: 0xece5d8, // warm cream rim of islands and roundabouts ...
  median: 0x98c43d, // ... around fresh lime grass
  medianTuft: 0x7fa932, // darker patches in the grass
  concrete: 0xb5aea2,
  plaza: 0x565d69,
  void: 0x06070b,
  voidWall: 0x171a21,
  voidRim: 0x8791a1,
  civilianBlue: 0x2f6fd0,
  civilianYellow: 0xf2bf1d,
  civilianWhite: 0xeef0ee,
  civilianRed: 0xc23a2e,
  log: 0xd9822b,
  logEnd: 0xf0b56a,
  snow: 0xf4f7fa,
  cactus: 0x5f9a3f,
  mesa: 0xb5653f,
  towerWood: 0x6b4a2c,
  towerTank: 0x7c5a3a,
  cabinWall: 0x9a6a3f,
  cabinRoof: 0x3a3e46,
  statueOrange: 0xe0641c,
  shopWall: 0xa4a8ad,
  shopRoof: 0x3a3e46,
  shopDoor: 0x2b2f36,
  shopDoorLine: 0x41464f,
  canopyRed: 0xe8352a,
  canopyRim: 0xf5f3ee,
  pumpBody: 0xf0efe9,
  boothWall: 0xd8d4ca,
  bench: 0xa06b3c,
  boulder: 0x8c9096,
  billboard: 0x2c3038,
  crownGold: 0xf2c230,
  monument: 0xc9c1b1,
  woodCrate: 0xa9794a,
  woodStrap: 0x75522f,
  containerBlue: 0x3f6f9e,
  containerRust: 0xa8573a,
  barrier: 0xf0ede6, // white concrete ...
  barrierStripe: 0xe84118, // ... with red safety stripes
  trunk: 0x7b5233,
  pine: 0x3f8a46,
  pineDark: 0x2f6e3a,
  leafy: 0x82b83c, // lime
  leafyDark: 0x4a8f3c, // forest
  pole: 0x8b909a,
  lamp: 0xfff1bf,
  lampGlow: 0xffb02e,
  cone: 0xf07a2a,
  coneStripe: 0xf4f1ea,
  // Player car
  playerBody: 0xd7142f,
  playerStripe: 0xfdf3dc,
  glass: 0x24344a,
  glassShine: 0x3e5878,
  trim: 0x2a2e35,
  hub: 0x9aa1ab,
  tire: 0x1d2026,
  headlight: 0xfff3c4,
  taillight: 0xff3b30,
  // Police car (original design: white with a blue side stripe and a red / blue light bar)
  policeBody: 0xf5f7fa,
  policeStripe: 0x1b2a6b,
  swatBody: 0x6a727e, // dark grey, but clearly lighter than the road
  swatDark: 0x272b32,
  swatStripe: 0xe8b93c,
  heliBody: 0x2f62d6,
  heliBand: 0xf0f2f5,
  rotorBlade: 0x14171c,
  rotorBlur: 0xdfe6ee,
  searchlight: 0xfff4c9,
  flare: 0xff2d1f,
  spikeBase: 0x1a1c20,
  spikeTeeth: 0xd9dde3,
  interceptorDark: 0x24272e, // black-and-white interceptor: dark hood and boot
  lightRed: 0xff3b30,
  lightBlue: 0x3d8bff,
  // Burnt-out wreck
  soot: 0x18181b,
  scorch: 0x0b0d10,
  // The lucky die
  crate: 0xb8800f, // dark amber, the game's main colour ...
  cratePip: 0x2c1c06, // ... with dark brown spots
  crateGlow: 0xffb02e,
  ice: 0x9fdcff, // frozen police cars
  frost: 0x7fe9ff,
  fireGlow: 0xff7a18,
  pillar: 0xa39c8e,
  pillarCap: 0xc2bbab,
  crateArrow: 0xf2b632, // amber, like the die: orange would look like the red warnings
  chunkTire: 0x17191e,
  chunkTireWall: 0x33363e,
  chunkHub: 0x5a5e66,
  chunkMetal: 0x2a2826,
  statueRed: 0xd7142f,
  statueNavy: 0x25408f,
  statueCream: 0xf6efdf,
  pulse: 0xffc64a,
  oil: 0x121318, // SLICK puddles ...
  oilShine: 0x34405a, // ... and the sheen on them
  emp: 0x6fc6ff, // BLACKOUT's ring and sparks
  stalled: 0x8a90a0, // a police car with a dead engine
  decoy: 0x9fe8ff, // the DECOY's hologram tint
  smoke: 0xf4efe0,
  fire: 0xffb02e,
};

const DEFAULT_PALETTE = {};
for (const map of MAPS) for (const key of Object.keys(map.palette)) DEFAULT_PALETTE[key] = PALETTE[key];

// Puts a map's colours in place. Drawings made after this use them.
export function applyMapPalette(map) {
  Object.assign(PALETTE, DEFAULT_PALETTE, map.palette);
}

// One of a map's colours, whichever map is in place.
export function mapColor(map, key) {
  return map.palette[key] ?? DEFAULT_PALETTE[key] ?? PALETTE[key];
}

// [TUNE] Synthesised sound levels (0..1) and siren behaviour.
export const AUDIO = {
  master: 0.55,
  skid: 0.5,
  engine: { volume: 0.32, pitch: [0.75, 1.45] }, // quiet under the music; its pitch rises with speed
  siren: 0.5,
  helicopter: 0.6,
  sirenRange: 950, // world units: the siren fades in as the nearest police car gets closer
  explosionRange: 1500, // crashes further away than this are silent
  menuMusic: 0.8,
  chaseMusic: 0.65, // under the effects
  musicFade: 0.3, // seconds: how quickly one track gives way to the other (a time constant: about 5 x this in all)
  musicDim: 0.65, // share of its volume the music keeps on the pause menu and the results
  menuOverlap: 1.2, // seconds the menu track overlaps itself where it repeats
  musicLookAhead: 2, // seconds ahead that its next pass is prepared
  loopTrim: 0.06, // seconds skipped at each end of a looping effect: the silence an MP3 adds
  // Files in public/assets: every sound in the game. None is made in code.
  music: { menu: 'bg_audios/bgm_menu.mp3', chase: 'bg_audios/bgm_chase.mp3' },
  // volume; cooldown: minimum seconds apart; vary: pitch change each time.
  files: {
    carCrash: { path: 'sound_effects/car_crash.mp3', volume: 1, cooldown: 0.25, vary: 0.08 },
    bump: { path: 'sound_effects/bump.mp3', volume: 0.7, cooldown: 0.15, vary: 0.1 },
    cone: { path: 'sound_effects/cone.mp3', volume: 0.7, cooldown: 0.06, vary: 0.12 },
    click: { path: 'sound_effects/ui_click.mp3', volume: 0.6 },
    freeze_shatter: { path: 'sound_effects/freeze_shatter.mp3', volume: 1, cooldown: 0.1 },
    shockwave: { path: 'sound_effects/shockwave.mp3', volume: 1 },
    kaboom: { path: 'sound_effects/kaboom.mp3', volume: 1 },
    titan: { path: 'sound_effects/titan.mp3', volume: 1 },
    cold_snap: { path: 'sound_effects/cold_snap.mp3', volume: 1 },
    stone_wall: { path: 'sound_effects/stone_wall.mp3', volume: 1 },
    scorcher: { path: 'sound_effects/scorcher.mp3', volume: 1 },
    police_radio: { path: 'sound_effects/police_radio.mp3', volume: 0.8, cooldown: 30 },
    engine_loop: { path: 'sound_effects/engine_loop.mp3' }, // these four loop: see AudioSystem
    tire_squeal: { path: 'sound_effects/tire_squeal.mp3' },
    siren: { path: 'sound_effects/siren.mp3' },
    helicopter_loop: { path: 'sound_effects/helicopter_loop.mp3' },
  },
};

// [TUNE] Visual effects budget (particles are capped so phones stay smooth).
export const EFFECTS = {
  maxSmoke: 140,
  maxFire: 160,
  maxFireball: 120, // flame clouds on screen at once
  maxChunks: 24, // big flying pieces (tires, bumpers, panels)
  maxRings: 6, // ground shockwave rings
  chunksSmall: 5, // pieces thrown out by a police wreck ...
  chunksBig: 7, // ... and by the player's crash
  chunkGravity: 2600, // they have weight: up and straight back down, not floating
  chunkLift: [380, 620], // how hard the blast throws them upward (units/s)
  chunkSpeed: [170, 360], // and outward
  chunkBounce: 0.38, // bumpers and panels thud and stop nearly where they land ...
  chunkGrip: 0.3, // friction with the road
  chunkSeconds: 1.8,
  tireBounce: 0.64, // ... tires bounce and roll on
  tireGrip: 0.045,
  tireSeconds: 2.6,
  chunkShadowRadius: 15,
  chunkShadowAlpha: 0.42,
  ringRadius: 170, // world units a wreck's ground ring reaches
  ringRadiusBig: 240,
  ringMs: 360,
  scorchRadius: 62, // world units
  sirenGlowOverAlpha: 0.15, // the faint colour cast over nearby props and cars
  maxFrost: 60, // frost sparkles at once
  maxSparks: 70, // BLACKOUT's electric sparks at once
  maxRocks: 40, // STONEWALL's flying rocks at once
  maxIce: 14, // COLD SNAP's ice on the road
  exhaustEveryMs: 30, // TURBO's flames: one puff this often
  maxTrailFire: 150, // flames on the Flamer's trail at once
  frozenGlowAlpha: 0.5, // the pool of cold light under a frozen car
  firePatchAlpha: 0.75,
  maxBursts: 16, // balls of fire on screen at once
  burstPopMs: 110, // how fast one swells ...
  burstHoldMs: 50, // ... stays ...
  burstFadeMs: 150, // ... and goes, on a small hit
  coreFadeMs: 260, // in an explosion it burns out more slowly
  coresAround: 4, // smaller balls of fire round the main one ...
  coreOuterTint: 0xffc48a, // ... tinted, so their middles aren't white and they don't look like separate orbs
  blastGlowMs: 520, // how long the ground stays lit
  chunkTrailSeconds: 0.7, // flying wreckage trails smoke this long
  chunkTrailEvery: 0.06,
  maxChunkSmoke: 60,
  // Sizes of a ball of fire (1 = 160 screen units across).
  burstBig: 1.25, // the player's crash
  burstWreck: 0.85, // a police car wrecked
  burstSmash: 0.6, // a parked car hit
  burstBump: 0.42,
  burstScrape: 0.24,
  sirenPoolRadius: 150, // world units: the red / blue light on the ground under a cruiser, fading away
  sirenPoolAlpha: 0.8,
  lampPoolRadius: 190, // world units: the light on the ground under a street lamp, fading away
  lampPoolAlpha: 0.34,
  maxDebris: 90,
  smokeEveryMs: 45, // a puff from each skidding rear tire this often
  wreckSmokeEveryMs: 160,
  maxScorch: 30,
  scorchSeconds: 45, // the road keeps the marks long after the wreck has gone
  lightFlashMs: 220, // police light bar alternates red / blue this often
};

// Player car shape, in world units. Footprint matches the physics size (CAR_SIZE: 44 x 84).
// Scenery drawing constants. Units are world units; x right, y down the map.
export const SCENERY = {
  // Trees were a bit small next to the car (crown only 1.4x the car's width); 1.25 makes a pine
  // about 4 car-heights tall with a crown about twice the car's width. [TUNE]
  treeScale: 1.25,
  stallLength: 92,
  // Tire tracks on open ground.
  trackStep: 90, // length of one piece
  trackGauge: 22, // half the gap between the two ruts
  trackWidth: 8,
  trackAlpha: 0.3,
  trackChance: 0.65, // share of road stretches that have them
  stallSpacing: 56,
  floorChunk: 800, // the floor is drawn in squares this big (must divide CHUNKS.size); off-screen squares are skipped
  laneDash: 60,
  laneGap: 60,
  laneWidth: 6,
  laneAlpha: 0.6,
  stallAlpha: 0.95,
  crosswalkAlpha: 0.95,
};

// The world is a grid of city blocks ("cells") separated by open roads. Each chunk picks a layout
// (CHUNKS.presets) and each block in it an arrangement, from a fixed seed, so the map is the same
// on every run. [TUNE]
export const WORLD = {
  seed: 1029,
  cell: 600, // block size including half the road on each side
  margin: 95, // empty road strip inside each cell edge (roads are 2 x margin wide)
  // Streets on a map with `streets`: every block has a cream curb and a pavement round it, with rounded corners, and
  // its own ground (asphalt in a slightly different shade, or a lawn). The roads are worn: repaired patches,
  // cracks and manholes. All of it is ground paint only: the driving and the collisions are the same. [TUNE]
  street: {
    curb: 5,
    sidewalk: 20,
    cornerRadius: 46,
    lotShade: 0.07, // a block's asphalt is up to this much lighter or darker than PALETTE.lot
    grassBlocks: ['lawn', 'garden', 'grove'], // arrangements whose block is a lawn
    driveways: [1, 2], // gaps in the curb into an asphalt block
    drivewayWidth: [70, 110],
    patches: 6, // per chunk, on the roads
    patchSize: [[60, 150], [40, 90]], // along and across the road
    patchAlpha: 0.45, // mended road is only a little darker
    mowStripes: 8, // a lawn is mown in stripes, every other one a little darker
    cracks: 12, // per chunk, on the roads; and one in half the asphalt blocks
    crackWidth: 2.5,
    manholes: 7,
  },
  islandLengths: [360, 400, 440],
  // Concrete block shapes (a few shapes and turns, so few drawings are needed).
  blockTypes: [
    { width: 60, length: 60, height: 46 },
    { width: 90, length: 50, height: 38 },
    { width: 70, length: 70, height: 64 },
    { width: 120, length: 60, height: 30 },
    { width: 80, length: 80, height: 56 },
  ],
  blockTurnsDeg: [0, 20, 45, 90],
  barrierLengths: [140, 180],
  barrierTurnsDeg: [0, 90, 30, 150],
  containerTypes: [
    { width: 60, length: 130, height: 52, color: 'containerBlue' },
    { width: 60, length: 130, height: 52, color: 'containerRust' },
  ],
  containerTurnsDeg: [0, 90],
  parkedCarChance: 0.13, // chance that a parking stall has a car in it
  civilians: [
    { shape: 'sedan', color: 'civilianBlue' },
    { shape: 'compact', color: 'civilianYellow' },
    { shape: 'wagon', color: 'civilianWhite' },
    { shape: 'coupe', color: 'civilianRed' },
  ],
  lawnTypes: [
    { width: 300, length: 200 },
    { width: 220, length: 280 },
  ],
  mesaSizes: [1, 1.4],
  mesaRadius: 42, // at size 1
  logTurnsDeg: [20, 100, 160],
  boulderSizes: [0.8, 1.15],
  boulderRadius: 15, // at size 1
  benchTurnsDeg: [0, 90],
  shopTurnsDeg: [180, 90], // the doors face the camera either way
  // The gas station, laid out around its canopy.
  station: {
    roofHalfWidth: 120,
    roofHalfLength: 58,
    pumpSpacing: 60, // from the middle to each pump island
    pumpHalfWidth: 12,
    pumpHalfLength: 42,
    shopHalfWidth: 120,
    shopHalfLength: 44,
  },
  civilianTurnsDeg: [0, 90, 180, 270],
  // Word statues: giant block letters on a low plinth, one per chunk at most.
  landmarkChance: 0.75,
  landmarkColors: { STOP: 'statueRed', MALL: 'statueNavy', HOTEL: 'statueCream', PARK: 'statueCream', GAMES: 'statueRed', DINER: 'statueNavy', GAS: 'statueRed', DEPOT: 'statueCream', WINTER: 'statueRed', DESERT: 'statueOrange', WOODS: 'statueOrange' },
  letterUnit: 17, // world units per grid square of the block font: letters are 85 tall
  letterThickness: 20,
  letterGap: 10,
  arrowChance: 0.3, // chance that a stretch of road has a painted arrow
  arrowLength: 64,
  arrowWidth: 28,
  plazaHalfSize: 695, // half the width of the paved square in the middle of a plaza chunk
  treeSizes: [0.9, 1, 1.1, 1.2],
  crosswalkChance: 0.18,
};
