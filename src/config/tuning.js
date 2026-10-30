// All tunable numbers live here, not inside scenes or entities.
// [TUNE] = prototype guess to adjust through playtesting, not a measured value.

export const DISPLAY = {
  backgroundColor: '#1b1f24',
  // Very dense phone screens (3x) are rendered at 2x: almost no visible difference, much less GPU work.
  maxPixelRatio: 2,
  // Placeholder textures are drawn at 2x so they stay sharp when the camera zooms in.
  textureScale: 2,
  // Longest frame step the game will simulate (ms). Prevents huge jumps after tab switches or hitches.
  maxFrameDeltaMs: 50,
};

export const VIEW = {
  // [TUNE] How many world units fit across the NARROWER side of the screen.
  // Same value in portrait and landscape, so the car looks the same size on every device
  // and the wider side simply shows more of the world.
  shortSideWorldUnits: 900,
};

export const ARENA = {
  width: 6000,
  height: 6000,
  wallThickness: 80,
};

// Where each run starts (centre of the arena), and the open space kept clear around it.
export const START = {
  x: 3000,
  y: 3000,
  clearRadius: 430,
};

export const CAR_SIZE = {
  // Placeholder car footprint in world units.
  width: 44,
  length: 84,
};

export const INPUT = {
  // Analog stick movement smaller than this is ignored.
  gamepadDeadZone: 0.35,
};

export const UI = {
  // UI is sized for a ~420 CSS px wide phone, then scaled within these limits.
  referenceShortSide: 420,
  minScale: 0.85,
  maxScale: 1.5,
  margin: 12,
  titleSize: 15,
  infoSize: 13,
  hintSize: 14,
  arrowSize: 22,
  zoneAlpha: 0.12,
  arrowIdleAlpha: 0.3,
  arrowActiveAlpha: 0.9,
};

// Interface colors. World colors are in PALETTE below.
export const COLORS = {
  zone: 0xffffff,
  uiText: '#e8edf2',
  uiPanel: 'rgba(10, 12, 15, 0.55)',
};

export const STORAGE_KEYS = {
  handlingPreset: 'devHandlingPreset', // debug tools only
  view: 'devView', // debug tools only
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
  rollMaxDeg: 5, // visual body lean in a full slide
  rollResponse: 8,
  // The extras below are the player's advantage: police keep these at zero (see the presets).
  slideGripLoss: 0, // share of grip lost in a full slide
  counterSteerBonus: 0, // extra turn rate when steering into a full slide (0.5 = 50% faster)
  deepSlideScrub: 0, // extra speed loss (units/s per second) in a deep slide
};

export const HANDLING_PRESETS = {
  grippy: {
    ...SHARED_HANDLING,
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
    steerResponse: 10,
    gripStraight: 9,
    gripTurning: 5.5,
    gripChangeRate: 4,
    slideScrub: 0.45,
    slideGripLoss: 0.12,
    counterSteerBonus: 0.5,
    deepSlideScrub: 40,
  },
  drifty: {
    ...SHARED_HANDLING,
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
  // Speed and turning grow over the run (player top speed = 300).
  speedStart: 1.04,
  speedEnd: 1.14,
  turnStartDeg: 118,
  turnEndDeg: 136,
  rampSeconds: 150,
  steerGain: 2.4, // steering = angle to target x gain (clamped to full lock)
  retargetMin: 0.12, // seconds between target updates (reaction time), random in this range
  retargetMax: 0.32,
  aimJitter: 70, // each car aims a little to one side of the player, so they don't all follow one line
  ramDistance: 220, // closer than this, every car aims straight at the player
  predictMaxSeconds: 1.1, // interceptors aim where the player will be, at most this far ahead
  awareness: 0.6, // chance, at each reaction, that a car checks for a prop in its path
  lookAhead: 60, // how far ahead it checks: this + speed x lookAheadSeconds
  lookAheadSeconds: 0.25,
  swerveAngle: 0.6, // radians: where it looks for a way around
  probeRadius: 26,
  despawnDistance: 2900, // police this far away (and off screen) are recycled; must stay beyond the furthest spawn point
  stuckSpeed: 40,
  stuckSeconds: 2.2,
  maxActive: 28, // performance cap
  maxCars: 48, // police + wrecks on the map
};

export const SPAWN = {
  firstSpawnAt: 1.3, // seconds into the run
  // [time in seconds, police on the map]; values in between are blended.
  table: [
    [0, 2],
    [10, 4],
    [25, 7],
    [45, 12],
    [75, 17],
    [110, 22],
    [160, 26],
  ],
  intervalStart: 0.9, // seconds between spawns, shrinking to intervalEnd
  intervalEnd: 0.4,
  intervalRampSeconds: 90,
  interceptorsFrom: 12, // seconds; before that every car simply chases
  interceptorMaxShare: 0.45,
  interceptorRampSeconds: 90,
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

export const WRECK = {
  lifetime: 9, // seconds a wreck stays on the map (an obstacle for other police)
  fadeSeconds: 1,
  friction: 2.6, // how fast a wreck slides to a stop (per second)
  spinFriction: 3,
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
  respawnSeconds: 25,
  slowdown: 0.97, // a cone barely slows the car down
  lampSlowdown: 0.88, // a lamp post costs a little more
  spin: 18, // how fast a knocked cone can spin (radians per second)
  lampSpin: 5, // a long post tips over rather than whirls
};

// Drive-over curbs (parking islands). The penalty applies once each time a car climbs on.
export const CURB = {
  speedKeep: 0.82, // share of speed kept when climbing on
  bumpDeflect: 0.3, // share of the speed INTO the curb edge removed, so the car is nudged along it
  noseDeflect: 0.12, // how much the bump turns the nose toward "along the edge"
};

// One original power-up: the Shockwave crate. Pick it up, then press the button to wreck
// every police car close around you.
export const POWERUP = {
  firstAt: 14, // seconds into the run
  interval: 17, // seconds between crates (only when the player isn't already holding one)
  minDistance: 520,
  maxDistance: 950,
  aheadAngleDeg: 70,
  clearance: 80,
  collectRadius: 54,
  despawnDistance: 2400,
  pulseRadius: 340,
  pulseSeconds: 0.55, // visual expansion time
  attempts: 14,
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
};

// [TUNE] Screen shake: events add "trauma" (0..1), which drains over time. The shake's size is
// trauma squared, so small knocks stay subtle and big hits feel much bigger.
export const TRAUMA = {
  decayPerSecond: 1.3,
  maxOffset: 36, // screen units of shake at trauma 1
  shakeSpeed: 40, // how fast the shake moves
  scrape: 0.25,
  knock: 0.2, // cones and lamp posts
  curb: 0.3,
  bump: 0.35,
  nearMiss: 0.4,
  explosion: 0.55, // right next to the player; fades with distance
  pulse: 0.6,
  crash: 1,
};

// [TUNE] Skid marks.
export const SKIDS = {
  maxMarks: 500, // hard cap; the oldest mark is reused when full
  slipThreshold: 70, // sideways speed (units/s) above which tyres leave marks
  width: 7,
  minSegmentLength: 6,
  lifetimeMs: 2600,
  alpha: 0.38,
  color: 0x15181c,
  rearAxle: 0.3, // rear wheels sit this share of car length behind the centre
  wheelSpread: 0.36, // ...and this share of car width either side
};

export const DEV_PANEL = {
  // Turntable inspection tool: car parks and spins in place (degrees per second).
  turntableSpinDeg: 30,
  turntableTurnDeg: 90, // while holding left / right
  readoutRefreshMs: 200,
  hintVisibleMs: 9000,
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
  defaultViewId: 'angled',
  // Car drawings made at startup from the 3D model, evenly spaced around the compass.
  directions: 64,
  // Per model: wrecks barely turn, so fewer drawings (less memory) are enough.
  carDirections: { player: 64, police: 64, wreck: 32 },
  // 0 = snap to the nearest drawing, 1 = also rotate by the small leftover angle (smoother turning).
  residualRotation: 1,
  // Pixels per world unit in the drawings baked at startup (cars and props).
  // The screen shows 0.9-2 px per unit on most devices, so 1.5 stays sharp without wasting memory.
  bakeScale: 1.5,
  // Light, in camera terms: u = screen right, v = toward the viewer, z = up. [TUNE]
  // Key light from the right and above, so one side of everything is lit, the other in shade,
  // and shadows fall to the left.
  keyLight: [0.7, 0.05, 0.7],
  keyGain: 0.5,
  fillLight: [-0.3, 0.8, 0.5], // soft light from the camera side so faces in shadow are not flat
  fillGain: 0.15,
  ambient: 0.42,
  skyGain: 0.1, // extra light on upward-facing surfaces (roofs, hoods, tops) so they read apart from the sides
  shadowLength: 0.75, // 1 = shadow length that matches the key light; lower = shorter shadows
  shadowColor: 0x0b0f17,
  shadowAlpha: 0.3,
  // Soft dark patch right under each car (where little light reaches), so it sits on the ground.
  contactShadow: { alpha: 0.22, grow: 3 },
  seamWidth: 0.6, // world units; hides hairline gaps between neighbouring faces
};

// Draw order. Standing objects are sorted inside their band by the screen height of their ground point.
export const DEPTH = {
  ground: 0, // floor, markings, skid marks
  raised: 10, // low curbs and islands (always under cars)
  shadows: 20, // shadows of cars and props
  objects: 1000, // + screen Y (always stays below `effects`)
  effects: 100000,
};

// Placeholder world colours (low-poly, flat shaded). Final palette goes in ART_DIRECTION.md.
export const PALETTE = {
  asphalt: 0x4a515e, // roads
  lot: 0x575f6c, // city blocks (parking lots, plazas): a little lighter than the roads
  asphaltPatchDark: 0x49505c,
  asphaltPatchLight: 0x525a67,
  paintWhite: 0xe4e0d4,
  paintYellow: 0xf0c04a,
  curb: 0xd1c8b6,
  grass: 0x7aa94b,
  concrete: 0xb5aea2,
  barrier: 0xd6d0c2,
  barrierStripe: 0xe8553d,
  trunk: 0x7b5233,
  pine: 0x3f8a46,
  pineDark: 0x2f6e3a,
  leafy: 0x5f9f3f,
  pole: 0x8b909a,
  lamp: 0xfff1bf,
  lampGlow: 0xffb02e,
  cone: 0xf07a2a,
  coneStripe: 0xf4f1ea,
  // Player car
  playerBody: 0xe0473c,
  playerStripe: 0xf4efe6,
  glass: 0x24344a,
  glassShine: 0x3e5878,
  trim: 0x2a2e35,
  hub: 0x9aa1ab,
  tyre: 0x1d2026,
  headlight: 0xfff3c4,
  taillight: 0xff3b30,
  // Police car (original design: white with a blue side stripe and a red / blue light bar)
  policeBody: 0xeef1f4,
  policeStripe: 0x2f6fe0,
  lightRed: 0xff3b30,
  lightBlue: 0x3d8bff,
  // Burnt-out wreck
  wreckBody: 0x3d3833,
  wreckGlass: 0x16181c,
  scorch: 0x0b0d10,
  // Shockwave crate
  crate: 0x2fc4b2,
  crateRibbon: 0xf4efe6,
  crateGlow: 0x5ff5e0,
  pulse: 0x7ff7ff,
  smoke: 0xd9dde3,
  fire: 0xffb02e,
};

// [TUNE] Synthesised sound levels (0..1) and siren behaviour.
export const AUDIO = {
  master: 0.55,
  engine: 0.16,
  skid: 0.12,
  siren: 0.07,
  sirenRange: 950, // world units: the siren fades in as the nearest police car gets closer
  sirenCycle: 1.4, // seconds per wail
  explosionRange: 1500, // explosions further away than this are silent
};

// [TUNE] Visual effects budget (particles are capped so phones stay smooth).
export const EFFECTS = {
  maxSmoke: 140,
  maxFire: 160,
  maxDebris: 90,
  smokeEveryMs: 45, // a puff from each skidding rear tyre this often
  wreckSmokeEveryMs: 160,
  maxScorch: 24,
  scorchSeconds: 14,
  lightFlashMs: 220, // police light bar alternates red / blue this often
};

// Player car shape, in world units. Footprint matches the physics size (CAR_SIZE: 44 x 84).
// Built in height bands so each reads as its own flat-shaded surface: dark lower sills and bumpers,
// body sides, a sloped hood and boot, a glass cabin and a flat roof. [TUNE]
export const CAR_MODEL = {
  wheelHeight: 13,
  wheelLength: 16,
  wheelInner: 19, // tyres sit outside the lower body (x 19..23.5) so they always show
  wheelOuter: 23.5,
  wheelBase: 0.32, // axles sit this share of the length from the centre
  sillBottom: 4, // lower body (narrower, darker)
  sillTop: 9.5,
  sillHalfWidth: 19,
  sillShade: 0.72,
  bumperDepth: 2,
  bodyHalfWidth: 22, // upper body: full width over the wheels
  shoulderInset: 1.5, // top edge of the body sides leans in by this much
  beltHeight: 17, // top of the body sides, where the cabin sits
  noseHeight: 14, // hood slopes down from beltHeight to this at the front
  tailHeight: 16, // boot slopes down slightly toward the back
  cabinFront: 0.11, // cabin base runs between these shares of the length
  cabinBack: -0.3,
  roofFront: 0.0,
  roofBack: -0.21,
  cabinInset: 2.5, // cabin base narrower than the body on each side
  roofInset: 6, // roof narrower than the body on each side
  roofHeight: 30,
};

// Scenery drawing constants. Units are world units; x right, y down the map.
export const SCENERY = {
  // Trees were a bit small next to the car (crown only 1.4x the car's width); 1.25 makes a pine
  // about 4 car-heights tall with a crown about twice the car's width. [TUNE]
  treeScale: 1.25,
  wallHeight: 40,
  wallSegment: 200, // arena walls are built from short barrier pieces
  patchesPerCell: 9, // small asphalt patches per city block (speed reference)
  startMarkRadius: 70,
  stallLength: 92,
  stallSpacing: 56,
  floorChunk: 1000, // the floor is drawn in squares this big; off-screen squares are skipped
  laneDash: 60,
  laneGap: 60,
  laneWidth: 6,
};

// The arena is a grid of city blocks ("cells") separated by open roads. Each block gets one
// arrangement, chosen by a fixed random seed, so the map is the same on every run. [TUNE]
export const WORLD = {
  seed: 1029,
  cell: 600, // block size including half the road on each side
  margin: 95, // empty road strip inside each cell edge (roads are 2 x margin wide)
  // [arrangement, weight]
  mix: [
    ['parking', 34],
    ['blocks', 22],
    ['grove', 14],
    ['barriers', 12],
    ['cones', 9],
    ['open', 9],
  ],
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
  treeSizes: [0.9, 1, 1.1, 1.2],
  crosswalkChance: 0.18,
};
