import { CHUNKS, COLLISION, DESERT_MAP, MAPS, RAMP, SCENERY, START, STREET_PROPS, VOID, WINTER_MAP, WOODS_MAP, WORLD } from '../config/tuning.js';
import { glyphWidth } from '../render/blockFont.js';
import { createRng, lerp } from '../utils/math.js';

// The world's contents as plain data, shared by the drawing (render/Scenery.js) and the
// collisions (systems/CollisionSystem.js). No Phaser here, so it can be tested on its own.
//
// The world is endless and made of square chunks, each a block of city "cells" with open roads
// between them. Roads run along every cell edge in every chunk, so they always line up at chunk
// borders whichever layouts meet there. A chunk is worked out from its coordinates and a fixed
// seed: the same chunk always comes back the same, so nothing has to be stored.
//
// Chunk: { cx, cy, x0, y0, seed, preset, items, paint, voids, surfaces }
// Item: { kind, name, x, y, heading (radians, 0 = north), model (drawing cache key), params,
//         band: 'objects' | 'raised', collider: null | {type:'circle', r} | {type:'box', hw, hl},
//         breakable, curb }
// A box collider's hw runs along the item's local x (right), hl along its local y (forward).
// Breakable items (cones, lamp posts, wooden crates) all get knocked away the same way.
// Void: { kind: 'void', isVoid: true, x, y, heading, collider, outline: [{x, y}] }: a hole in the
// ground; the outline is what gets drawn. A river's voids have water: true (drawn as part of the river).
// Surface: { kind: 'ice' | 'sand' | 'river', surface: 'ice' | 'sand' | null, x, y, heading, collider, outline }: ground
// that changes the driving (SURFACES), or, with no collider, a river's water (drawing only).
// Paint: polygons on the floor { poly: [x, y, x, y ...], color, alpha, shade? } (curbs, pavements, block ground, road
// wear: render/groundPaint.js has their colours), rectangles { x, y, w, h, alpha, color? } (x, y = top-left corner; color 'lot' =
// the lighter surface of a city block, 'plaza' = a paved square, otherwise white paint), or
// rings { ring: true, x, y, r, width, alpha } or road arrows { arrow: true, x, y, heading, alpha }
// (white, drawn with the floor square holding the centre).

const DEG = Math.PI / 180;
const ISLAND_WIDTH = 70; // matches propModels.js
const CELLS_PER_CHUNK = Math.round(CHUNKS.size / WORLD.cell);
const LAMP_FACINGS_DEG = [0, 90, 180, 270];
let map = MAPS[0]; // the map the chunk now being built belongs to
// Letters are turned so a word rises to the right on screen, its face on the sunlit side.
const LETTER_TURN_DEG = 270;

export function buildLayout(seed = WORLD.seed, forMap = MAPS[0]) {
  return { chunkAt: (cx, cy) => buildChunk(cx, cy, seed, forMap) };
}

export function chunkCoord(v) {
  return Math.floor(v / CHUNKS.size);
}

// The nearest point to (x, y) on the centre line of a north-south road, or of an east-west one.
// Written into out, along with out.northSouth.
export function pointOnRoad(x, y, northSouth, out) {
  out.x = northSouth ? Math.round(x / WORLD.cell) * WORLD.cell : x;
  out.y = northSouth ? y : Math.round(y / WORLD.cell) * WORLD.cell;
  out.northSouth = northSouth;
  return out;
}

// The nearest point on any road's centre line.
export function nearestRoadPoint(x, y, out) {
  const toNorthSouth = Math.abs(x - Math.round(x / WORLD.cell) * WORLD.cell);
  const toEastWest = Math.abs(y - Math.round(y / WORLD.cell) * WORLD.cell);
  return pointOnRoad(x, y, toNorthSouth < toEastWest, out);
}

function chunkSeed(cx, cy, seed) {
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(seed, 83492791)) >>> 0;
}

export function buildChunk(cx, cy, seed = WORLD.seed, forMap = MAPS[0]) {
  map = forMap;
  const presetsHere = forMap.presets || CHUNKS.presets;
  const hash = chunkSeed(cx, cy, seed);
  const rng = createRng(hash);
  counter = 0;
  const hasStart = chunkCoord(START.x) === cx && chunkCoord(START.y) === cy;
  const presets = Object.entries(presetsHere);
  const preset = hasStart ? forMap.startPreset : pickWeighted(rng, presets.map(([name, def]) => [name, def.weight]));
  const def = presetsHere[preset];
  const chunk = { cx, cy, x0: cx * CHUNKS.size, y0: cy * CHUNKS.size, seed: hash, preset, items: [], paint: [], voids: [], surfaces: [] };
  // The ground has its own random numbers, so it never moves a prop. So do each map's own features.
  const groundRng = createRng(hash + 7919);
  const streetRng = createRng(hash + 104729);
  const featureRng = createRng(hash + 15485863);
  if (forMap.bare) {
    addBareGround(chunk, groundRng);
    return chunk;
  }
  const river = forMap.rivers && hasRiver(cy);
  let hasThicket = false;

  // At most one word statue per chunk, in a block picked now. Near the start it is skipped.
  const hasLandmark = rng() < WORLD.landmarkChance;
  let landmarkI = Math.floor(rng() * CELLS_PER_CHUNK);
  const landmarkJ = Math.floor(rng() * CELLS_PER_CHUNK);
  if (preset === 'plaza' && isPlazaCell(landmarkI, landmarkJ)) landmarkI = 0;
  const word = pick(rng, def.landmarks);
  let hasStation = false;

  for (let j = 0; j < CELLS_PER_CHUNK; j += 1) {
    for (let i = 0; i < CELLS_PER_CHUNK; i += 1) {
      const cell = makeCell(chunk, i, j);
      const groundAt = chunk.paint.length;
      let arrangement = 'open';
      if (preset === 'plaza' && isPlazaCell(i, j)) {
        chunk.paint.push(...blockGround(cell, groundRng, arrangement));
        continue;
      }
      // The chunk where a run starts has the gas station, in the block ahead and to the right of the start.
      const hub = hasStart && cell.x0 > START.x && cell.x0 < START.x + WORLD.cell && cell.y1 < START.y && cell.y1 > START.y - WORLD.cell;
      const riverHere = river && j === WOODS_MAP.riverBlock;
      const statue = !hub && !riverHere && hasLandmark && i === landmarkI && j === landmarkJ && addLandmark(cell, word);
      if (riverHere) {
        arrangement = 'river';
        riverBanks(cell, chunk.items, featureRng);
      } else if (hub) {
        arrangement = 'station';
        BUILDERS.station(cell, chunk.items, chunk.paint, rng);
      } else if (!statue) {
        // One gas station to a chunk at most: the start chunk's is the one above.
        arrangement = pickWeighted(rng, def.cells);
        if (arrangement === 'station' && (hasStart || hasStation)) arrangement = 'lawn';
        if (arrangement === 'station') hasStation = true;
        // One thicket to a chunk at most: they hold a lot of trees.
        if (arrangement === 'thicket' && hasThicket) arrangement = 'grove';
        if (arrangement === 'thicket') hasThicket = true;
        BUILDERS[arrangement](cell, chunk.items, chunk.paint, rng);
      }
      if (forMap.streets) addStreetFurniture(cell, chunk.items, streetRng);
      if (forMap.ice && !riverHere) addSnowmen(cell, chunk.items, featureRng);
      if (forMap.sand && !riverHere) addTumbleweeds(cell, chunk.items, featureRng);
      // The block's ground goes under everything its arrangement painted.
      chunk.paint.splice(groundAt, 0, ...blockGround(cell, groundRng, arrangement));
      if (rng() < WORLD.crosswalkChance && !forMap.wild) addCrosswalk(cell, chunk.paint, rng, i, j);
    }
  }
  if (forMap.streets) addRoadWear(chunk, groundRng);
  if (forMap.ice) addPatches(chunk, featureRng, 'ice', WINTER_MAP.icePatches, WINTER_MAP.iceRadius, WINTER_MAP.iceOnRoad);
  if (forMap.sand) addPatches(chunk, featureRng, 'sand', DESERT_MAP.sandPatches, DESERT_MAP.sandRadius, DESERT_MAP.sandOnRoad);
  if (river) addRiver(chunk, featureRng);
  if (preset === 'plaza') addPlaza(chunk);
  addLaneLines(chunk);
  addRoadArrows(chunk, rng);
  if (forMap.wild) addWildRoads(chunk);
  if (rng() < def.holeChance) addRoadHoles(chunk, def.roadHoles, rng, river);
  if (forMap.open) {
    // Open ground: no road paint, only paved aprons, and tire tracks where the roads run.
    chunk.paint = chunk.paint.filter((mark) => mark.color === 'plaza');
    addTracks(chunk, rng);
  }
  return chunk;
}

// Every prop drawing the world can ask for, so all of them can be drawn at startup and none has to
// be drawn during play. tests/test_world.mjs checks that chunks use nothing outside this list.
export function propCatalogue(forMap = MAPS[0]) {
  const list = [];
  if (forMap.bare) return list; // nothing stands on it
  const extras = forMap.extras || [];
  const words = new Set(Object.values(forMap.presets || CHUNKS.presets).flatMap((preset) => preset.landmarks));
  const push = (kind, model, headingDeg, params = {}) => list.push({ kind, model, heading: headingDeg * DEG, params });
  for (const length of WORLD.islandLengths) for (const deg of [0, 90]) push('island', `island${length}`, deg, { length });
  for (const treeKind of forMap.trees) for (const size of treeSizesOf(treeKind)) push('tree', `${treeKind}${size}`, 0, { treeKind, size });
  for (const deg of LAMP_FACINGS_DEG) push(forMap.lamp, forMap.lamp, deg);
  for (const type of WORLD.blockTypes) for (const deg of WORLD.blockTurnsDeg) push('block', blockModel(type), deg, type);
  for (const length of WORLD.barrierLengths) for (const deg of WORLD.barrierTurnsDeg) push('barrier', `barrier${length}`, deg, { length });
  for (const type of WORLD.containerTypes) for (const deg of WORLD.containerTurnsDeg) push('container', containerModel(type), deg, type);
  for (const { shape, color } of WORLD.civilians) {
    for (const deg of WORLD.civilianTurnsDeg) push('civilian', civilianModel(shape, color), deg, { shape, color });
  }
  for (const word of words) {
    const color = WORLD.landmarkColors[word];
    for (const letter of word) {
      const model = letterModel(letter, color);
      if (!list.some((entry) => entry.model === model)) push('letter', model, LETTER_TURN_DEG, { letter, color });
    }
  }
  push('cone', 'cone', 0);
  push('woodcrate', 'woodcrate', 0);
  push('monument', 'monument', 0);
  push('pillar', 'pillar', 0);
  push('spikes', 'spikes', 0);
  push('spikes', 'spikes', 90);
  push('roundabout', 'roundabout', 0);
  for (const { width, length } of WORLD.lawnTypes) push('island', lawnModel(width, length), 0, { width, length });
  push('canopy', 'canopy', 0);
  push('pumps', 'pumps', 0);
  for (const deg of WORLD.shopTurnsDeg) {
    push('shop', 'shop', deg);
    if (forMap.shop === 'cabin') push('cabin', 'cabin', deg);
  }
  if (extras.includes('mesa')) for (const size of WORLD.mesaSizes) for (const shape of WORLD.mesaShapes) push('mesa', mesaModel(size, shape), 0, { size, shape });
  if (extras.includes('tower')) push('tower', 'tower', 0);
  if (extras.includes('log')) for (const deg of WORLD.logTurnsDeg) push('log', 'log', deg);
  push('booth', 'booth', 0);
  for (const deg of WORLD.benchTurnsDeg) push('bench', 'bench', deg);
  for (const size of WORLD.boulderSizes) for (const shape of WORLD.boulderShapes) push('boulder', boulderModel(size, shape), 0, { size, shape });
  for (const deg of [0, 270]) push('billboard', 'billboard', deg); // its board faces the camera either way
  if (forMap.streets) {
    push('hydrant', 'hydrant', 0);
    for (const deg of STREET_PROPS.mailboxTurnsDeg) push('mailbox', 'mailbox', deg);
    push('trashcan', 'trashcan', 0);
    for (const size of STREET_PROPS.bushSizes) push('bush', `bush${size}`, 0, { size });
    for (const deg of [0, 90]) push('fence', 'fence', deg);
    if (RAMP.enabled) for (const deg of [0, 180]) push('ramp', 'ramp', deg);
  }
  if (forMap.ice) push('snowman', 'snowman', 0);
  if (forMap.sand) {
    push('tumbleweed', 'tumbleweed', 0);
    for (const deg of [0, 90]) push('pumpjack', 'pumpjack', deg);
    push('barrel', 'barrel', 0);
  }
  if (forMap.rivers) {
    push('bridge', 'bridge', 0);
    push('railing', 'railing', 90);
    for (const deg of [0, 90]) push('lumber', 'lumber', deg);
    if (!extras.includes('log')) for (const deg of WORLD.logTurnsDeg) push('log', 'log', deg);
  }
  return list;
}

function blockModel(type) {
  return `block${type.width}x${type.length}x${type.height}`;
}

function containerModel(type) {
  return `container-${type.color}`;
}

function letterModel(letter, color) {
  return `letter-${letter}-${color}`;
}

function mesaModel(size, shape) {
  return `mesa-${shape}${size}`;
}

// A rock's shape, picked from its place: the same rock always comes back the same, and no other random number is
// used, so nothing else in the world moves.
function shapeAt(x, y, shapes) {
  const h = Math.abs(Math.sin(x * 0.0127 + y * 0.0311) * 43758.5453);
  return shapes[Math.floor((h - Math.floor(h)) * shapes.length) % shapes.length];
}

function lawnModel(width, length) {
  return `lawn${width}x${length}`;
}

function boulderModel(size, shape) {
  return `boulder-${shape}${size}`;
}

function civilianModel(shape, color) {
  return `${shape}-${color}`;
}

function makeCell(chunk, i, j) {
  const x0 = chunk.x0 + i * WORLD.cell + WORLD.margin;
  const y0 = chunk.y0 + j * WORLD.cell + WORLD.margin;
  const size = WORLD.cell - WORLD.margin * 2;
  return {
    chunk,
    x0,
    y0,
    x1: x0 + size,
    y1: y0 + size,
    midX: x0 + size / 2,
    midY: y0 + size / 2,
    size,
    placed: [], // { x, y, r } of things already in this cell
    items: chunk.items,
  };
}

// The middle blocks of a plaza chunk are paved over.
function isPlazaCell(i, j) {
  return i >= 1 && i <= 2 && j >= 1 && j <= 2;
}

// Is a circle of radius r at (x, y) free: inside the block, away from the start, not on top of
// anything else in the same block?
function isFree(cell, x, y, r) {
  if (x - r < cell.x0 || x + r > cell.x1 || y - r < cell.y0 || y + r > cell.y1) return false;
  if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + r) return false;
  return cell.placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r);
}

function randomSpot(cell, r, rng, tries = 12) {
  for (let i = 0; i < tries; i += 1) {
    const x = cell.x0 + r + rng() * (cell.size - r * 2);
    const y = cell.y0 + r + rng() * (cell.size - r * 2);
    if (isFree(cell, x, y, r)) return { x, y };
  }
  return null;
}

function add(cell, item, footprint) {
  cell.items.push(item);
  cell.placed.push({ x: item.x, y: item.y, r: footprint });
  return item;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function pickWeighted(rng, mix) {
  const total = mix.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [name, weight] of mix) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return mix[mix.length - 1][0];
}

let counter = 0;
function named(kind) {
  counter += 1;
  return `${kind}-${counter}`;
}

function treeSizesOf(kind) {
  return WORLD.treeSizesFor[kind] || WORLD.treeSizes;
}

function tree(x, y, rng) {
  const treeKind = pick(rng, map.trees);
  const size = pick(rng, treeSizesOf(treeKind));
  return {
    kind: 'tree',
    name: named('tree'),
    x,
    y,
    heading: 0,
    model: `${treeKind}${size}`,
    params: { treeKind, size },
    band: 'objects',
    collider: { type: 'circle', r: COLLISION.treeRadius * size },
    breakable: false,
  };
}

function lamp(x, y, headingDeg) {
  return {
    kind: map.lamp,
    name: named('lamp'),
    x,
    y,
    heading: headingDeg * DEG,
    model: map.lamp,
    params: {},
    band: 'objects',
    collider: { type: 'circle', r: COLLISION.lampRadius },
    breakable: true,
  };
}

function cone(x, y) {
  return {
    kind: 'cone',
    name: named('cone'),
    x,
    y,
    heading: 0,
    model: 'cone',
    params: {},
    band: 'objects',
    collider: { type: 'circle', r: COLLISION.coneRadius },
    breakable: true,
  };
}

function streetPiece(kind, x, y, headingDeg, collider, params = {}) {
  const model = kind === 'bush' ? `bush${params.size}` : kind;
  return { kind, name: named(kind), x, y, heading: headingDeg * DEG, model, params, band: 'objects', collider, breakable: true };
}

function rampAt(x, y, headingDeg) {
  return {
    kind: 'ramp',
    name: named('ramp'),
    x,
    y,
    heading: headingDeg * DEG,
    model: 'ramp',
    params: {},
    band: 'raised', // drawn under the cars, like a curb: they ride over it
    isRamp: true,
    collider: { type: 'box', hw: RAMP.width / 2, hl: RAMP.length / 2 },
    breakable: false,
  };
}

// Hydrants, mailboxes and trash cans along a block's pavements, clear of its corners and of each other.
function addStreetFurniture(cell, items, rng) {
  const [fewest, most] = STREET_PROPS.perBlock;
  const count = fewest + Math.floor(rng() * (most - fewest + 1));
  const inset = STREET_PROPS.inset;
  const margin = WORLD.street.cornerRadius + 40;
  for (let n = 0; n < count; n += 1) {
    const side = Math.floor(rng() * 4);
    const along = margin + rng() * (cell.size - margin * 2);
    const x = side === 1 ? cell.x1 - inset : side === 3 ? cell.x0 + inset : cell.x0 + along;
    const y = side === 0 ? cell.y0 + inset : side === 2 ? cell.y1 - inset : cell.y0 + along;
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius) continue;
    if (!cell.placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + 16)) continue;
    const kind = pickWeighted(rng, STREET_PROPS.kinds);
    const facing = [180, 90, 0, 270][side]; // a mailbox faces the road
    if (kind === 'hydrant') items.push(streetPiece('hydrant', x, y, 0, { type: 'circle', r: COLLISION.hydrantRadius }));
    else if (kind === 'mailbox') items.push(streetPiece('mailbox', x, y, facing, { type: 'circle', r: COLLISION.mailboxRadius }));
    else items.push(streetPiece('trashcan', x, y, 0, { type: 'circle', r: COLLISION.trashRadius }));
    cell.placed.push({ x, y, r: 16 });
  }
}

// Hedges dotted round a lawn, and sometimes a row of picket fence along one of its sides: all of it can be
// driven through.
function addGarden(cell, items, rng, x, y, width, length) {
  const [fewest, most] = STREET_PROPS.bushes;
  const bushes = fewest + Math.floor(rng() * (most - fewest + 1));
  for (let n = 0; n < bushes; n += 1) {
    const size = pick(rng, STREET_PROPS.bushSizes);
    const spot = randomSpot(cell, 22 * size, rng);
    if (!spot) continue;
    items.push(streetPiece('bush', spot.x, spot.y, 0, { type: 'circle', r: COLLISION.bushRadius * size }, { size }));
    cell.placed.push({ x: spot.x, y: spot.y, r: 22 * size });
  }
  if (rng() >= STREET_PROPS.fenceChance) return;
  const piece = STREET_PROPS.fenceLength;
  const alongX = rng() < 0.5;
  const sideOf = rng() < 0.5 ? -1 : 1;
  const half = (alongX ? width : length) / 2 + 26;
  const pieces = Math.floor(((alongX ? width : length) + 20) / piece);
  for (let k = 0; k < pieces; k += 1) {
    const offset = (k - (pieces - 1) / 2) * piece;
    const fx = alongX ? x + offset : x + sideOf * half;
    const fy = alongX ? y + sideOf * half : y + offset;
    if (fx < cell.x0 + 10 || fx > cell.x1 - 10 || fy < cell.y0 + 10 || fy > cell.y1 - 10) continue;
    if (Math.hypot(fx - START.x, fy - START.y) < START.clearRadius) continue;
    items.push(streetPiece('fence', fx, fy, alongX ? 0 : 90, { type: 'box', hw: piece / 2, hl: 2 }));
  }
}

// A parked car: breakable, so it gets bumped or shoved aside, never a crash.
function parkedCar(x, y, turnDeg, rng) {
  const { shape, color } = pick(rng, WORLD.civilians);
  return {
    kind: 'civilian',
    name: named('civilian'),
    x,
    y,
    heading: turnDeg * DEG,
    model: civilianModel(shape, color),
    params: { shape, color },
    band: 'objects',
    collider: { type: 'box', hw: COLLISION.civilianHalfWidth, hl: COLLISION.civilianHalfLength },
    breakable: true,
  };
}

function island(x, y, length, northSouth) {
  return {
    kind: 'island',
    name: named('island'),
    x,
    y,
    heading: northSouth ? 0 : 90 * DEG,
    model: `island${length}`,
    params: { length },
    band: 'raised',
    collider: { type: 'box', hw: ISLAND_WIDTH / 2, hl: length / 2 },
    breakable: false,
    curb: true,
  };
}

// A giant word on a long plinth, in the middle of a block. One prop per letter: each is compact, so
// draw order stays right when a car passes behind part of a word. Returns false if it doesn't fit.
function addLandmark(cell, word) {
  const { letterUnit, letterGap, letterThickness } = WORLD;
  let total = letterGap * (word.length - 1);
  for (const letter of word) total += glyphWidth(letter) * letterUnit;
  const length = WORLD.islandLengths.find((l) => l >= total + 24) || WORLD.islandLengths[WORLD.islandLengths.length - 1];
  const reach = Math.hypot(length / 2, ISLAND_WIDTH / 2);
  if (Math.hypot(cell.midX - START.x, cell.midY - START.y) < START.clearRadius + reach) return false;
  add(cell, island(cell.midX, cell.midY, length, true), length / 2);
  const color = WORLD.landmarkColors[word];
  // The word reads from south to north: rising to the right on screen.
  let y = cell.midY + total / 2;
  for (const letter of word) {
    const width = glyphWidth(letter) * letterUnit;
    cell.items.push({
      kind: 'letter',
      name: named('letter'),
      x: cell.midX,
      y: y - width / 2,
      heading: LETTER_TURN_DEG * DEG,
      model: letterModel(letter, color),
      params: { letter, color },
      band: 'objects',
      collider: { type: 'box', hw: width / 2, hl: letterThickness / 2 },
      breakable: false,
    });
    y -= width + letterGap;
  }
  return true;
}

// A wide grass plot with a curb round it, built like an island.
function lawn(x, y, width, length) {
  return {
    kind: 'island',
    name: named('lawn'),
    x,
    y,
    heading: 0,
    model: lawnModel(width, length),
    params: { width, length },
    band: 'raised',
    collider: { type: 'box', hw: width / 2, hl: length / 2 },
    breakable: false,
    curb: true,
  };
}

function boulderAt(x, y, size) {
  return {
    kind: 'boulder',
    name: named('boulder'),
    x,
    y,
    heading: 0,
    model: boulderModel(size, shapeAt(x, y, WORLD.boulderShapes)),
    params: { size, shape: shapeAt(x, y, WORLD.boulderShapes) },
    band: 'objects',
    collider: { type: 'circle', r: WORLD.boulderRadius * size },
    breakable: false,
  };
}

// A bench: knocked flying when hit, like a cone.
function benchAt(x, y, turnDeg) {
  return {
    kind: 'bench',
    name: named('bench'),
    x,
    y,
    heading: turnDeg * DEG,
    model: 'bench',
    params: {},
    band: 'objects',
    collider: { type: 'box', hw: 24, hl: 8 },
    breakable: true,
  };
}

function billboardAt(x, y, turnDeg = 0) {
  return {
    kind: 'billboard',
    name: named('billboard'),
    x,
    y,
    heading: turnDeg * DEG,
    model: 'billboard',
    params: {},
    band: 'objects',
    collider: { type: 'box', hw: 62, hl: 6 },
    breakable: false,
  };
}

function shopAt(x, y, turnDeg, kind = map.shop) {
  const { shopHalfWidth: hw, shopHalfLength: hl } = WORLD.station;
  return {
    kind,
    name: named('shop'),
    x,
    y,
    heading: turnDeg * DEG,
    model: kind,
    params: {},
    band: 'objects',
    collider: { type: 'box', hw, hl },
    breakable: false,
  };
}

function boothAt(x, y) {
  return {
    kind: 'booth',
    name: named('booth'),
    x,
    y,
    heading: 0,
    model: 'booth',
    params: {},
    band: 'objects',
    collider: { type: 'box', hw: 22, hl: 22 },
    breakable: false,
  };
}

// White lines for stalls in a row along x, from x0, with their fronts at y, reaching down to y + depth.
function stalls(paint, x0, y, count, depth = SCENERY.stallLength) {
  for (let i = 0; i <= count; i += 1) paint.push({ x: x0 + i * SCENERY.stallSpacing - 2, y, w: 4, h: depth, alpha: SCENERY.stallAlpha });
}

function woodCrate(x, y) {
  return {
    kind: 'woodcrate',
    name: named('woodcrate'),
    x,
    y,
    heading: 0,
    model: 'woodcrate',
    params: {},
    band: 'objects',
    collider: { type: 'circle', r: COLLISION.woodCrateRadius },
    breakable: true,
  };
}

function barrier(x, y, length, turnDeg) {
  // A barrier mesh lies along local x; heading turns it.
  return {
    kind: 'barrier',
    name: named('barrier'),
    x,
    y,
    heading: turnDeg * DEG,
    model: `barrier${length}`,
    params: { length },
    band: 'objects',
    collider: { type: 'box', hw: length / 2, hl: 13 },
    breakable: false,
  };
}

// A round hole. The drawn edge wanders a little, always outside the part that swallows cars.
function roundVoid(x, y, r, rng) {
  const outline = [];
  const sides = 13;
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    const reach = r + VOID.outlineGrow * lerp(0.4, 1.5, rng());
    outline.push({ x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach });
  }
  return { kind: 'void', isVoid: true, name: named('void'), x, y, heading: 0, collider: { type: 'circle', r }, breakable: false, outline };
}

// A missing section of road: a box across the road with a broken edge. Runs along local y.
function gapVoid(x, y, hw, hl, headingDeg, rng) {
  const heading = headingDeg * DEG;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const local = [];
  const steps = 4;
  const jag = () => VOID.outlineGrow * lerp(0.2, 1.5, rng());
  for (let i = 0; i < steps; i += 1) local.push([lerp(-hw, hw, i / steps), -hl - jag()]);
  for (let i = 0; i < steps; i += 1) local.push([hw, lerp(-hl, hl, i / steps)]);
  for (let i = 0; i < steps; i += 1) local.push([lerp(hw, -hw, i / steps), hl + jag()]);
  for (let i = 0; i < steps; i += 1) local.push([-hw, lerp(hl, -hl, i / steps)]);
  const outline = local.map(([lx, ly]) => ({ x: x + lx * cos + ly * sin, y: y + lx * sin - ly * cos }));
  return { kind: 'void', isVoid: true, name: named('void'), x, y, heading, collider: { type: 'box', hw, hl }, breakable: false, outline };
}

const BUILDERS = {
  // A raised island with painted stalls on both sides, trees and a street lamp on it.
  parking(cell, items, paint, rng) {
    const ns = rng() < 0.5;
    const length = pick(rng, WORLD.islandLengths);
    const jitter = (rng() - 0.5) * 60;
    const x = ns ? cell.midX + jitter : cell.midX;
    const y = ns ? cell.midY : cell.midY + jitter;
    const halfL = length / 2;
    // The whole row must stay clear of the start area.
    const reach = Math.hypot(halfL, ISLAND_WIDTH / 2 + SCENERY.stallLength);
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + reach) return;

    add(cell, island(x, y, length, ns), halfL);
    const along = (offset) => (ns ? [x, y + offset] : [x + offset, y]);
    const treeCount = 1 + Math.floor(rng() * 2);
    const slots = treeCount === 1 ? [0] : [-halfL * 0.55, halfL * 0.55];
    for (const offset of slots) {
      const [tx, ty] = along(offset + (rng() - 0.5) * 30);
      items.push(tree(tx, ty, rng));
    }
    const lampOffset = treeCount === 1 ? halfL * 0.6 * (rng() < 0.5 ? -1 : 1) : 0;
    const [lx, ly] = along(lampOffset);
    const facing = ns ? (rng() < 0.5 ? 90 : 270) : rng() < 0.5 ? 0 : 180;
    items.push(lamp(lx, ly, facing));
    if (rng() < 0.45) {
      // A rock or a bench on the grass, clear of the lamp and the trees.
      const [dx, dy] = along(lampOffset + (lampOffset > 0 ? -55 : 55));
      if (rng() < 0.5) items.push(boulderAt(dx, dy, WORLD.boulderSizes[0]));
      else items.push(benchAt(dx, dy, ns ? 90 : 0));
    }

    // Stalls: short white lines across both sides of the island.
    const edge = ISLAND_WIDTH / 2 + 6;
    const stall = SCENERY.stallLength;
    for (const side of [-1, 1]) {
      const near = side < 0 ? -edge - stall : edge;
      for (let s = -halfL + 12; s <= halfL - 12; s += SCENERY.stallSpacing) {
        if (ns) paint.push({ x: x + near, y: y + s - 2, w: stall, h: 4, alpha: SCENERY.stallAlpha });
        else paint.push({ x: x + s - 2, y: y + near, w: 4, h: stall, alpha: SCENERY.stallAlpha });
      }
      // Parked cars, nose in or nose out, in the spaces between the lines.
      for (let s = -halfL + 12; s + SCENERY.stallSpacing <= halfL - 12; s += SCENERY.stallSpacing) {
        if (rng() >= WORLD.parkedCarChance) continue;
        const across = near + stall / 2;
        const middle = s + SCENERY.stallSpacing / 2;
        const px = ns ? x + across : x + middle;
        const py = ns ? y + middle : y + across;
        const noseIn = rng() < 0.5;
        const turn = ns ? (side < 0 === noseIn ? 90 : 270) : side < 0 === noseIn ? 180 : 0;
        const r = COLLISION.civilianHalfWidth;
        const inBlock = px - r >= cell.x0 && px + r <= cell.x1 && py - r >= cell.y0 && py + r <= cell.y1;
        if (inBlock) items.push(parkedCar(px, py, turn, rng));
      }
    }
  },

  // An L of planted medians, with a row of pines along each arm.
  garden(cell, items, paint, rng) {
    const length = WORLD.islandLengths[0];
    const inset = ISLAND_WIDTH / 2 + 5;
    const signX = rng() < 0.5 ? -1 : 1;
    const signY = rng() < 0.5 ? -1 : 1;
    const cornerX = signX < 0 ? cell.x0 + inset : cell.x1 - inset;
    const cornerY = signY < 0 ? cell.y0 + inset : cell.y1 - inset;
    const armX = cornerX - signX * (length / 2 - ISLAND_WIDTH / 2);
    const armY = cornerY - signY * (length / 2 - ISLAND_WIDTH / 2);
    const reach = Math.hypot(cell.size, cell.size) / 2;
    if (Math.hypot(cell.midX - START.x, cell.midY - START.y) < START.clearRadius + reach) return;
    items.push(island(cornerX, armY, length, true));
    items.push(island(armX, cornerY, length, false));
    const trees = 2 + Math.floor(rng() * 2);
    for (let i = 1; i <= trees; i += 1) {
      const step = (i * (length - ISLAND_WIDTH)) / (trees + 0.5);
      items.push(tree(cornerX, cornerY - signY * step, rng));
      items.push(tree(cornerX - signX * step, cornerY, rng));
    }
    items.push(lamp(cornerX, cornerY, pick(rng, LAMP_FACINGS_DEG)));
    cell.placed.push({ x: cell.midX, y: cell.midY, r: cell.size });
  },

  // Two or three concrete blocks.
  blocks(cell, items, paint, rng) {
    const count = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i += 1) {
      const type = pick(rng, WORLD.blockTypes);
      const r = Math.hypot(type.width, type.length) / 2 + 30;
      const spot = randomSpot(cell, r, rng);
      if (!spot) continue;
      const turn = pick(rng, WORLD.blockTurnsDeg);
      add(
        cell,
        {
          kind: 'block',
          name: named('block'),
          x: spot.x,
          y: spot.y,
          heading: turn * DEG,
          model: blockModel(type),
          params: type,
          band: 'objects',
          collider: { type: 'box', hw: type.width / 2, hl: type.length / 2 },
          breakable: false,
        },
        r,
      );
    }
  },

  // A wide lawn with trees, a bench or two, rocks, and sometimes a billboard.
  lawn(cell, items, paint, rng) {
    const { width, length } = pick(rng, WORLD.lawnTypes);
    const x = cell.midX;
    const y = cell.midY;
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + Math.hypot(width, length) / 2) return;
    add(cell, lawn(x, y, width, length), Math.max(width, length) / 2);
    const inW = width / 2 - 34;
    const inL = length / 2 - 34;
    const spots = [[-0.8, -0.7], [0.75, -0.8], [-0.75, 0.75], [0.8, 0.7], [0.1, -0.15]];
    const trees = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < trees; i += 1) {
      const [u, v] = spots[i];
      items.push(tree(x + u * inW, y + v * inL, rng));
    }
    items.push(benchAt(x + (rng() < 0.5 ? -0.35 : 0.35) * inW, y + 0.35 * inL, pick(rng, WORLD.benchTurnsDeg)));
    items.push(boulderAt(x + 0.45 * inW, y - 0.3 * inL, pick(rng, WORLD.boulderSizes)));
    if (rng() < 0.5) items.push(boulderAt(x - 0.45 * inW, y + 0.05 * inL, pick(rng, WORLD.boulderSizes)));
    if (rng() < 0.3) items.push(billboardAt(x, y - 0.7 * inL));
    if (map.streets) addGarden(cell, items, rng, x, y, width, length);
  },

  // A repair shop facing a row of stalls, with a tree island beside it.
  shop(cell, items, paint, rng) {
    const { shopHalfLength: hl } = WORLD.station;
    const x = cell.midX;
    const y = cell.y0 + hl + 14;
    if (Math.hypot(cell.midX - START.x, cell.midY - START.y) < START.clearRadius + cell.size / 2) return;
    add(cell, shopAt(x, y, 180), 130);
    paint.push({ x: cell.x0 + 20, y: y + hl, w: cell.size - 40, h: 110, alpha: 1, color: 'plaza' });
    const rowY = y + hl + 130;
    const count = 5;
    const rowX = cell.midX - (count * SCENERY.stallSpacing) / 2;
    stalls(paint, rowX, rowY, count);
    for (let i = 0; i < count; i += 1) {
      if (rng() < 0.5) items.push(parkedCar(rowX + (i + 0.5) * SCENERY.stallSpacing, rowY + SCENERY.stallLength / 2, rng() < 0.5 ? 0 : 180, rng));
    }
    if (!map.noPlanters) items.push(island(cell.midX, cell.y1 - 26, WORLD.islandLengths[0], false));
    items.push(tree(cell.midX - 90, cell.y1 - 26, rng));
    items.push(tree(cell.midX + 90, cell.y1 - 26, rng));
    items.push(lamp(cell.midX, cell.y1 - 26, pick(rng, LAMP_FACINGS_DEG)));
    cell.placed.push({ x: cell.midX, y: cell.midY, r: cell.size });
  },

  // A parking lot with a guard booth and a barrier by its way in.
  booth(cell, items, paint, rng) {
    BUILDERS.parking(cell, items, paint, rng);
    const spot = randomSpot(cell, 36, rng, 24);
    if (!spot) return;
    add(cell, boothAt(spot.x, spot.y), 36);
    const barrierSpot = randomSpot(cell, 100, rng);
    if (barrierSpot) add(cell, barrier(barrierSpot.x, barrierSpot.y, WORLD.barrierLengths[0], pick(rng, [0, 90])), 100);
  },

  // The gas station: a roof over two fuel islands, on a paved forecourt in front of a repair shop, with a
  // row of stalls and a small planted island. The roof has no collider: cars can drive under it.
  station(cell, items, paint, rng) {
    const { roofHalfLength, pumpSpacing, pumpHalfWidth, pumpHalfLength, shopHalfLength } = WORLD.station;
    const x = cell.midX;
    const shopY = cell.y0 + shopHalfLength + 6;
    const roofY = shopY + shopHalfLength + 30 + roofHalfLength;
    paint.push({ x: cell.x0 + 8, y: shopY + shopHalfLength, w: cell.size - 16, h: cell.y1 - shopY - shopHalfLength - 8, alpha: 1, color: 'plaza' });
    items.push(shopAt(x, shopY, 180, 'shop'));
    for (const side of [-1, 1]) {
      items.push({
        kind: 'pumps',
        name: named('pumps'),
        x: x + side * pumpSpacing,
        y: roofY,
        heading: 0,
        model: 'pumps',
        params: {},
        band: 'objects',
        collider: { type: 'box', hw: pumpHalfWidth, hl: pumpHalfLength },
        breakable: false,
      });
    }
    items.push({ kind: 'canopy', name: named('canopy'), x, y: roofY, heading: 0, model: 'canopy', params: {}, band: 'overhead', collider: null, breakable: false });
    // Stalls down the side with a car or two in them, and a planted island with a billboard on the far side.
    const stallX = cell.x0 + 8;
    const stallY = shopY - 20;
    for (let i = 0; i <= 2; i += 1) paint.push({ x: stallX, y: stallY + i * SCENERY.stallSpacing - 2, w: SCENERY.stallLength - 16, h: 4, alpha: SCENERY.stallAlpha });
    items.push(parkedCar(stallX + 38, stallY + SCENERY.stallSpacing / 2, 90, rng));
    if (rng() < 0.7) items.push(parkedCar(stallX + 38, stallY + SCENERY.stallSpacing * 1.5, 270, rng));
    const islandX = cell.x1 - 36;
    const length = WORLD.islandLengths[0];
    if (!map.noPlanters) items.push(island(islandX, cell.midY, length, true));
    items.push(tree(islandX, cell.midY - length * 0.36, rng));
    items.push(tree(islandX, cell.midY + length * 0.38, rng));
    items.push(billboardAt(islandX, cell.midY, 270));
    cell.placed.push({ x: cell.midX, y: cell.midY, r: cell.size });
  },

  // A great rock or two.
  mesa(cell, items, paint, rng) {
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i += 1) {
      const size = pick(rng, WORLD.mesaSizes);
      const radius = WORLD.mesaRadius * size;
      const spot = randomSpot(cell, radius * 1.3, rng);
      if (!spot) continue;
      add(cell, {
        kind: 'mesa',
        name: named('mesa'),
        x: spot.x,
        y: spot.y,
        heading: 0,
        model: mesaModel(size, shapeAt(spot.x, spot.y, WORLD.mesaShapes)),
        params: { size, shape: shapeAt(spot.x, spot.y, WORLD.mesaShapes) },
        band: 'objects',
        collider: { type: 'circle', r: radius },
        breakable: false,
      }, radius * 1.3);
    }
  },

  // A water tower, with a tree or two near it.
  tower(cell, items, paint, rng) {
    const spot = randomSpot(cell, 60, rng);
    if (spot) {
      add(cell, { kind: 'tower', name: named('tower'), x: spot.x, y: spot.y, heading: 0, model: 'tower', params: {}, band: 'objects', collider: { type: 'circle', r: 26 }, breakable: false }, 60);
    }
    BUILDERS.grove(cell, items, paint, rng);
  },

  // Felled logs lying about: knocked aside when hit.
  logs(cell, items, paint, rng) {
    const count = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i += 1) {
      const spot = randomSpot(cell, 50, rng);
      if (!spot) continue;
      add(cell, { kind: 'log', name: named('log'), x: spot.x, y: spot.y, heading: pick(rng, WORLD.logTurnsDeg) * DEG, model: 'log', params: {}, band: 'objects', collider: { type: 'box', hw: 9, hl: 34 }, breakable: true }, 50);
    }
    const spot = randomSpot(cell, 34, rng);
    if (spot) add(cell, boulderAt(spot.x, spot.y, pick(rng, WORLD.boulderSizes)), 34);
  },

  // A small group of trees.
  grove(cell, items, paint, rng) {
    const count = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const spot = randomSpot(cell, 48, rng);
      if (spot) add(cell, tree(spot.x, spot.y, rng), 48);
    }
  },

  // One or two jersey barriers.
  barriers(cell, items, paint, rng) {
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i += 1) {
      const length = pick(rng, WORLD.barrierLengths);
      const r = length / 2 + 25;
      const spot = randomSpot(cell, r, rng);
      if (!spot) continue;
      add(cell, barrier(spot.x, spot.y, length, pick(rng, WORLD.barrierTurnsDeg)), r);
    }
  },

  // A building site: barriers and cones in the block, and a ramp on the road beside it.
  site(cell, items, paint, rng) {
    const spot = randomSpot(cell, 120, rng);
    if (spot) {
      items.push(barrier(spot.x, spot.y, pick(rng, WORLD.barrierLengths), pick(rng, [0, 90])));
      for (let i = 0; i < 4; i += 1) items.push(cone(spot.x + (i - 1.5) * 34, spot.y + 60));
      cell.placed.push({ x: spot.x, y: spot.y, r: 120 });
    }
    // The road on the side of the block that is inside the chunk (never a border road).
    const i = Math.round((cell.x0 - WORLD.margin - cell.chunk.x0) / WORLD.cell);
    const roadX = i < CELLS_PER_CHUNK - 1 ? cell.x1 + WORLD.margin : cell.x0 - WORLD.margin;
    const lane = rng() < 0.5 ? -1 : 1;
    const along = (rng() < 0.5 ? -1 : 1) * RAMP.along;
    const x = roadX + lane * RAMP.laneOffset;
    const y = cell.midY + along;
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + 200) return;
    if (RAMP.enabled) items.push(rampAt(x, y, lane < 0 ? 180 : 0));
  },
  // A line of traffic cones: knocked flying when hit, never a crash.
  cones(cell, items, paint, rng) {
    const spot = randomSpot(cell, 110, rng);
    if (!spot) return;
    const angle = rng() * Math.PI;
    const count = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const k = i - (count - 1) / 2;
      const x = spot.x + Math.cos(angle) * k * 34;
      const y = spot.y + Math.sin(angle) * k * 34;
      if (Math.hypot(x - START.x, y - START.y) > START.clearRadius) items.push(cone(x, y));
    }
    cell.placed.push({ x: spot.x, y: spot.y, r: 110 });
  },

  // A works yard: shipping containers, a line of barriers and a stack of breakable crates.
  yard(cell, items, paint, rng) {
    const containers = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < containers; i += 1) {
      const type = pick(rng, WORLD.containerTypes);
      const r = Math.hypot(type.width, type.length) / 2 + 25;
      const spot = randomSpot(cell, r, rng);
      if (!spot) continue;
      add(
        cell,
        {
          kind: 'container',
          name: named('container'),
          x: spot.x,
          y: spot.y,
          heading: pick(rng, WORLD.containerTurnsDeg) * DEG,
          model: containerModel(type),
          params: type,
          band: 'objects',
          collider: { type: 'box', hw: type.width / 2, hl: type.length / 2 },
          breakable: false,
        },
        r,
      );
    }
    const line = randomSpot(cell, 105, rng);
    if (line) {
      const turn = rng() < 0.5 ? 0 : 90;
      const length = WORLD.barrierLengths[0];
      for (const side of [-1, 1]) {
        const shift = side * (length / 2 + 6);
        items.push(barrier(line.x + (turn === 0 ? shift : 0), line.y + (turn === 0 ? 0 : shift), length, turn));
      }
      cell.placed.push({ x: line.x, y: line.y, r: 105 });
    }
    const stack = randomSpot(cell, 60, rng);
    if (stack) {
      const count = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < count; i += 1) {
        items.push(woodCrate(stack.x + ((i % 3) - 1) * 36, stack.y + (Math.floor(i / 3) - 0.5) * 36));
      }
      cell.placed.push({ x: stack.x, y: stack.y, r: 60 });
    }
  },

  // The block has collapsed: a big hole in the middle.
  sinkhole(cell, items, paint, rng) {
    const r = lerp(VOID.sinkholeRadius[0], VOID.sinkholeRadius[1], rng());
    const spot = randomSpot(cell, r + VOID.outlineGrow * 1.5, rng);
    if (!spot) return;
    cell.chunk.voids.push(roundVoid(spot.x, spot.y, r, rng));
    cell.placed.push({ x: spot.x, y: spot.y, r: r + VOID.outlineGrow * 1.5 });
  },

  // Winter: a frozen pond filling the middle of the block, pines at its corners.
  pond(cell, items, paint, rng) {
    const r = lerp(WINTER_MAP.pondRadius[0], WINTER_MAP.pondRadius[1], rng());
    if (Math.hypot(cell.midX - START.x, cell.midY - START.y) < START.clearRadius + r) return;
    cell.chunk.surfaces.push(patchAt('ice', cell.midX, cell.midY, r, rng, true));
    cell.placed.push({ x: cell.midX, y: cell.midY, r: r + 12 });
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (rng() < 0.35) continue;
      items.push(tree(cell.midX + u * cell.size * 0.41, cell.midY + v * cell.size * 0.41, rng));
    }
  },

  // Desert: nodding oil pumps, with a few oil barrels lying about.
  oilfield(cell, items, paint, rng) {
    const [fewest, most] = DESERT_MAP.pumps;
    const pumps = fewest + Math.floor(rng() * (most - fewest + 1));
    for (let i = 0; i < pumps; i += 1) {
      const spot = randomSpot(cell, 62, rng);
      if (!spot) continue;
      const turn = rng() < 0.5 ? 0 : 90;
      add(cell, { kind: 'pumpjack', name: named('pumpjack'), x: spot.x, y: spot.y, heading: turn * DEG, model: 'pumpjack', params: {}, band: 'objects', collider: { type: 'box', hw: 16, hl: 40 }, breakable: false }, 62);
    }
    const spot = randomSpot(cell, 50, rng);
    if (!spot) return;
    const [few, many] = DESERT_MAP.barrels;
    const barrels = few + Math.floor(rng() * (many - few + 1));
    for (let i = 0; i < barrels; i += 1) {
      const x = spot.x + ((i % 3) - 1) * 25 + (rng() - 0.5) * 6;
      const y = spot.y + (Math.floor(i / 3) - 0.5) * 25 + (rng() - 0.5) * 6;
      items.push({ kind: 'barrel', name: named('barrel'), x, y, heading: 0, model: 'barrel', params: {}, band: 'objects', collider: { type: 'circle', r: COLLISION.barrelRadius }, breakable: true });
    }
    cell.placed.push({ x: spot.x, y: spot.y, r: 50 });
  },

  // Wild ground, no curb: the map's own trees (cacti in the desert) and rocks straight on the ground, and in the
  // woods sometimes a fallen log. Where a town would have a lawn, the desert and the woods have this.
  scrub(cell, items, paint, rng) {
    const trees = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < trees; i += 1) {
      const spot = randomSpot(cell, 40, rng);
      if (spot) add(cell, tree(spot.x, spot.y, rng), 40);
    }
    const rocks = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < rocks; i += 1) {
      const spot = randomSpot(cell, 30, rng);
      if (spot) add(cell, boulderAt(spot.x, spot.y, pick(rng, WORLD.boulderSizes)), 30);
    }
    if ((map.extras || []).includes('log') && rng() < 0.4) {
      const spot = randomSpot(cell, 50, rng);
      if (spot) add(cell, { kind: 'log', name: named('log'), x: spot.x, y: spot.y, heading: pick(rng, WORLD.logTurnsDeg) * DEG, model: 'log', params: {}, band: 'objects', collider: { type: 'box', hw: 9, hl: 34 }, breakable: true }, 50);
    }
  },

  // Woods: stacks of sawn lumber (solid) and a loose log or two.
  lumber(cell, items, paint, rng) {
    const [fewest, most] = WOODS_MAP.lumberStacks;
    const stacks = fewest + Math.floor(rng() * (most - fewest + 1));
    for (let i = 0; i < stacks; i += 1) {
      const spot = randomSpot(cell, 66, rng);
      if (!spot) continue;
      const turn = rng() < 0.5 ? 0 : 90;
      add(cell, { kind: 'lumber', name: named('lumber'), x: spot.x, y: spot.y, heading: turn * DEG, model: 'lumber', params: {}, band: 'objects', collider: { type: 'box', hw: 30, hl: 48 }, breakable: false }, 66);
    }
    const logs = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < logs; i += 1) {
      const spot = randomSpot(cell, 50, rng);
      if (spot) add(cell, { kind: 'log', name: named('log'), x: spot.x, y: spot.y, heading: pick(rng, WORLD.logTurnsDeg) * DEG, model: 'log', params: {}, band: 'objects', collider: { type: 'box', hw: 9, hl: 34 }, breakable: true }, 50);
    }
  },

  // Woods: the block is thick with trees, and one narrow dirt path wanders through from road to road.
  thicket(cell, items, paint, rng) {
    if (Math.hypot(cell.midX - START.x, cell.midY - START.y) < START.clearRadius + cell.size * 0.75) {
      BUILDERS.grove(cell, items, paint, rng);
      return;
    }
    const { thicketSpacing: step, thicketJitter: jitter, pathWidth, pathWander } = WOODS_MAP;
    const northSouth = rng() < 0.5;
    const phase = rng() * Math.PI * 2;
    // The path's middle, across the block, at a point along it.
    const middleAt = (along) => pathWander * Math.sin(((along - (northSouth ? cell.y0 : cell.x0)) / cell.size) * Math.PI * 1.5 + phase);
    const across0 = northSouth ? cell.midX : cell.midY;
    for (let a = cell.x0 + 22; a <= cell.x1 - 22; a += step) {
      for (let b = cell.y0 + 22; b <= cell.y1 - 22; b += step) {
        const x = a + (rng() - 0.5) * 2 * jitter;
        const y = b + (rng() - 0.5) * 2 * jitter;
        const along = northSouth ? y : x;
        const across = northSouth ? x : y;
        if (Math.abs(across - (across0 + middleAt(along))) < pathWidth / 2 + 18) continue;
        if (x < cell.x0 + 14 || x > cell.x1 - 14 || y < cell.y0 + 14 || y > cell.y1 - 14) continue;
        items.push(tree(x, y, rng));
      }
    }
    // The dirt of the path, a little narrower than the gap in the trees.
    const half = pathWidth * 0.36;
    const edge = (side) => Array.from({ length: 13 }, (_, k) => {
      const along = (northSouth ? cell.y0 : cell.x0) + (k / 12) * cell.size;
      const across = across0 + middleAt(along) + side * half;
      return northSouth ? [round1(across), round1(along)] : [round1(along), round1(across)];
    });
    const poly = [...edge(-1), ...edge(1).reverse()].flat();
    paint.push({ poly, color: 'dirt', alpha: 0.9 });
    cell.placed.push({ x: cell.midX, y: cell.midY, r: cell.size });
  },

  open() {},
};

// ---- Winter, Desert and Woods (Step D) ----

// A patch of ice or soft sand: a rounded shape with a wandering edge. The part that changes the driving is a
// circle a little inside the drawn edge. A pond is a big one.
function patchAt(kind, x, y, r, rng, pond = false) {
  const outline = [];
  const sides = pond ? 18 : 12;
  const spin = rng() * Math.PI * 2;
  for (let i = 0; i < sides; i += 1) {
    const angle = spin + (i / sides) * Math.PI * 2;
    const reach = r * lerp(1.02, 1.22, rng());
    outline.push({ x: round1(x + Math.cos(angle) * reach), y: round1(y + Math.sin(angle) * reach) });
  }
  return { kind, surface: kind, pond, name: named(kind), x, y, heading: 0, collider: { type: 'circle', r }, outline };
}

// Ice or soft sand dotted over a chunk: most on the roads, where the cars are, the rest in the blocks.
function addPatches(chunk, rng, kind, [fewest, most], [small, big], onRoadShare) {
  const count = fewest + Math.floor(rng() * (most - fewest + 1));
  for (let n = 0; n < count; n += 1) {
    const r = lerp(small, big, rng());
    let x;
    let y;
    if (rng() < onRoadShare) {
      // On one of the chunk's inner roads, anywhere along it.
      const northSouth = rng() < 0.5;
      const across = (1 + Math.floor(rng() * (CELLS_PER_CHUNK - 1))) * WORLD.cell;
      const along = r + 40 + rng() * (CHUNKS.size - (r + 40) * 2);
      x = chunk.x0 + (northSouth ? across : along);
      y = chunk.y0 + (northSouth ? along : across);
    } else {
      x = chunk.x0 + r + 60 + rng() * (CHUNKS.size - (r + 60) * 2);
      y = chunk.y0 + r + 60 + rng() * (CHUNKS.size - (r + 60) * 2);
    }
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + r) continue;
    if (chunk.surfaces.some((s) => s.collider && Math.hypot(s.x - x, s.y - y) < s.collider.r + r + 30)) continue;
    chunk.surfaces.push(patchAt(kind, x, y, r, rng));
  }
}

// Snowmen standing about in a block: they burst into snow when hit.
function addSnowmen(cell, items, rng) {
  const [fewest, most] = WINTER_MAP.snowmen;
  const count = fewest + Math.floor(rng() * (most - fewest + 1));
  for (let n = 0; n < count; n += 1) {
    const spot = randomSpot(cell, 24, rng, 6);
    if (!spot) continue;
    items.push({ kind: 'snowman', name: named('snowman'), x: spot.x, y: spot.y, heading: 0, model: 'snowman', params: {}, band: 'objects', collider: { type: 'circle', r: COLLISION.snowmanRadius }, breakable: true });
    cell.placed.push({ x: spot.x, y: spot.y, r: 24 });
  }
}

// Now and then a tumbleweed caught in a block, waiting for a car.
function addTumbleweeds(cell, items, rng) {
  if (rng() >= DESERT_MAP.tumbleweedChance) return;
  const spot = randomSpot(cell, 22, rng, 6);
  if (!spot) return;
  items.push({ kind: 'tumbleweed', name: named('tumbleweed'), x: spot.x, y: spot.y, heading: 0, model: 'tumbleweed', params: {}, band: 'objects', collider: { type: 'circle', r: COLLISION.tumbleweedRadius }, breakable: true });
  cell.placed.push({ x: spot.x, y: spot.y, r: 22 });
}

// Does this row of chunks have a river (Woods)?
export function hasRiver(cy) {
  const { riverEvery, riverRowOffset } = WOODS_MAP;
  return (((cy - riverRowOffset) % riverEvery) + riverEvery) % riverEvery === 0;
}

// The middle line of the river in a row of chunks, and how far its drawn banks reach at a point along it: they
// wander with the world x, so a river runs on unbroken from one chunk into the next.
export function riverMiddle(cy) {
  return cy * CHUNKS.size + WOODS_MAP.riverBlock * WORLD.cell + WORLD.cell / 2;
}
function bankReach(x, cy, side) {
  const phase = cy * 1.7 + side * 2.3;
  const wobble = 0.5 + 0.3 * Math.sin(x * 0.0061 + phase) + 0.2 * Math.sin(x * 0.0173 + phase * 2);
  return WOODS_MAP.riverHalfWidth + WOODS_MAP.bankWobble * wobble;
}
function riverOutline(cy, x0, x1) {
  const middle = riverMiddle(cy);
  const steps = Math.max(2, Math.round((x1 - x0) / 40));
  const outline = [];
  for (let k = 0; k <= steps; k += 1) {
    const x = x0 + ((x1 - x0) * k) / steps;
    outline.push({ x: round1(x), y: round1(middle - bankReach(x, cy, -1)) });
  }
  for (let k = steps; k >= 0; k -= 1) {
    const x = x0 + ((x1 - x0) * k) / steps;
    outline.push({ x: round1(x), y: round1(middle + bankReach(x, cy, 1)) });
  }
  return outline;
}

// A tree or two on each bank of the river.
function riverBanks(cell, items, rng) {
  const middle = riverMiddle(cell.chunk.cy);
  // Halfway between the furthest the water reaches and the edge of the block.
  const reach = (WOODS_MAP.riverHalfWidth + WOODS_MAP.bankWobble + cell.size / 2) / 2;
  for (const side of [-1, 1]) {
    const y = middle + side * reach;
    const count = 1 + Math.floor(rng() * 2);
    for (let n = 0; n < count; n += 1) {
      const x = cell.x0 + 30 + rng() * (cell.size - 60);
      if (Math.hypot(x - START.x, y - START.y) > START.clearRadius) items.push(tree(x, y, rng));
    }
  }
}

// The river across the whole chunk: its water (drawing), a hole the length of each block it runs through, and a
// bridge with railings over every road it crosses. The railings on a border road are shared: each chunk puts up
// the one on its own side.
function addRiver(chunk, rng) {
  const middle = riverMiddle(chunk.cy);
  chunk.surfaces.push({ kind: 'river', surface: null, name: named('river'), x: chunk.x0 + CHUNKS.size / 2, y: middle, heading: 0, collider: null, outline: riverOutline(chunk.cy, chunk.x0, chunk.x0 + CHUNKS.size), seed: Math.floor(rng() * 1e6) });
  const half = WORLD.cell / 2 - WORLD.margin;
  for (let i = 0; i < CELLS_PER_CHUNK; i += 1) {
    const x = chunk.x0 + i * WORLD.cell + WORLD.cell / 2;
    chunk.voids.push({
      kind: 'void',
      isVoid: true,
      water: true,
      name: named('void'),
      x,
      y: middle,
      heading: 90 * DEG,
      collider: { type: 'box', hw: WOODS_MAP.riverHalfWidth, hl: half },
      breakable: false,
      outline: riverOutline(chunk.cy, x - half, x + half),
    });
  }
  const length = WOODS_MAP.deckLength;
  for (let k = 0; k <= CELLS_PER_CHUNK; k += 1) {
    const x = chunk.x0 + k * WORLD.cell;
    if (k < CELLS_PER_CHUNK) chunk.items.push({ kind: 'bridge', name: named('bridge'), x, y: middle, heading: 0, model: 'bridge', params: {}, band: 'raised', collider: null, breakable: false });
    for (const side of [-1, 1]) {
      if ((k === 0 && side < 0) || (k === CELLS_PER_CHUNK && side > 0)) continue;
      chunk.items.push({ kind: 'railing', name: named('railing'), x: x + side * WOODS_MAP.railInset, y: middle, heading: 90 * DEG, model: 'railing', params: {}, band: 'objects', collider: { type: 'box', hw: length / 2, hl: 4 }, breakable: false });
    }
  }
}

// The paved square in the middle of a plaza chunk: a roundabout with a monument and trees, on the
// crossing of the chunk's two middle roads. Traffic can still ride over the roundabout's curb.
function addPlaza(chunk) {
  const x = chunk.x0 + CHUNKS.size / 2;
  const y = chunk.y0 + CHUNKS.size / 2;
  const half = WORLD.plazaHalfSize;
  chunk.paint.push({ x: x - half, y: y - half, w: half * 2, h: half * 2, alpha: 1, color: 'plaza' });
  chunk.paint.push({ ring: true, x, y, r: COLLISION.roundaboutRadius + 150, width: 6, alpha: 0.5 });
  chunk.items.push({
    kind: 'roundabout',
    name: named('roundabout'),
    x,
    y,
    heading: 0,
    model: 'roundabout',
    params: {},
    band: 'raised',
    collider: { type: 'circle', r: COLLISION.roundaboutRadius },
    breakable: false,
    curb: true,
  });
  chunk.items.push({
    kind: 'monument',
    name: named('monument'),
    x,
    y,
    heading: 0,
    model: 'monument',
    params: {},
    band: 'objects',
    collider: { type: 'circle', r: COLLISION.monumentRadius },
    breakable: false,
  });
  const rng = createRng(chunk.seed + 1);
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    chunk.items.push(tree(x + Math.cos(angle) * 96, y + Math.sin(angle) * 96, rng));
    chunk.items.push(lamp(x + Math.cos(angle) * 560, y + Math.sin(angle) * 560, LAMP_FACINGS_DEG[i]));
  }
}

// Holes in the roads inside the chunk, midway between crossings. The chunk's border roads stay
// whole, so there is always a way around every chunk and the road network never breaks.
function addRoadHoles(chunk, [fewest, most], rng, river = false) {
  const count = fewest + Math.floor(rng() * (most - fewest + 1));
  const used = new Set();
  for (let n = 0; n < count; n += 1) {
    const northSouth = rng() < 0.5;
    const line = 1 + Math.floor(rng() * (CELLS_PER_CHUNK - 1));
    const segment = Math.floor(rng() * CELLS_PER_CHUNK);
    const key = `${northSouth}:${line}:${segment}`;
    if (used.has(key)) continue;
    if (river && northSouth && segment === WOODS_MAP.riverBlock) continue; // that stretch is a bridge
    used.add(key);
    const across = line * WORLD.cell;
    const along = (segment + 0.5) * WORLD.cell;
    const x = chunk.x0 + (northSouth ? across : along);
    const y = chunk.y0 + (northSouth ? along : across);
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + 150) continue;
    if (chunk.items.some((item) => item.isRamp && Math.hypot(item.x - x, item.y - y) < RAMP.holeClearance)) continue;
    if (rng() < VOID.gapChance) {
      const hl = lerp(VOID.gapHalfLength[0], VOID.gapHalfLength[1], rng());
      chunk.voids.push(gapVoid(x, y, VOID.gapHalfWidth, hl, northSouth ? 0 : 90, rng));
    } else {
      const r = lerp(VOID.holeRadius[0], VOID.holeRadius[1], rng());
      const shift = (rng() < 0.5 ? -1 : 1) * VOID.holeSideShift;
      chunk.voids.push(roundVoid(x + (northSouth ? shift : 0), y + (northSouth ? 0 : shift), r, rng));
    }
  }
}

// Painted arrows on some stretches of road, in the lane on the right of the way they point. Kept
// clear of floor-square borders, because an arrow is drawn whole by one square.
function addRoadArrows(chunk, rng) {
  const { cell } = WORLD;
  const clear = WORLD.arrowLength / 2 + SCENERY.laneWidth;
  const nearBorder = (v) => {
    const f = ((v % SCENERY.floorChunk) + SCENERY.floorChunk) % SCENERY.floorChunk;
    return f < clear || f > SCENERY.floorChunk - clear;
  };
  const offset = 45;
  const middle = chunk.x0 + CHUNKS.size / 2;
  const middleY = chunk.y0 + CHUNKS.size / 2;
  const onPlaza = (x, y) => chunk.preset === 'plaza' && Math.abs(x - middle) < WORLD.plazaHalfSize && Math.abs(y - middleY) < WORLD.plazaHalfSize;
  for (let k = 0; k <= CELLS_PER_CHUNK; k += 1) {
    for (let s = 0; s < CELLS_PER_CHUNK; s += 1) {
      for (const northSouth of [true, false]) {
        if (rng() >= WORLD.arrowChance) continue;
        // On a chunk's border roads, stay on this chunk's side of the line.
        const side = k === 0 ? 1 : k === CELLS_PER_CHUNK ? -1 : rng() < 0.5 ? 1 : -1;
        const along = (s + 0.25 + rng() * 0.5) * cell;
        const across = k * cell + side * offset;
        const x = chunk.x0 + (northSouth ? across : along);
        const y = chunk.y0 + (northSouth ? along : across);
        if (nearBorder(x) || nearBorder(y) || onPlaza(x, y)) continue;
        const heading = northSouth ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
        chunk.paint.push({ arrow: true, x, y, heading, alpha: SCENERY.stallAlpha });
      }
    }
  }
}

// A pair of wandering tire tracks along some of the roads of an open map, so the eye has something to follow.
// Their wander comes from world position, so a track lines up with its neighbour across a chunk border. Each
// chunk draws only the roads along its top and left edges and inside it: its neighbours have the others.
function addTracks(chunk, rng) {
  const { cell } = WORLD;
  const { trackStep, trackGauge, trackWidth, trackAlpha, trackChance } = SCENERY;
  const wander = (along, line) => 20 * Math.sin(along / 190 + line * 1.7) + 9 * Math.sin(along / 67 + line * 0.6);
  for (const northSouth of [true, false]) {
    for (let k = 0; k < CELLS_PER_CHUNK; k += 1) {
      const line = (northSouth ? chunk.x0 : chunk.y0) + k * cell;
      const start = northSouth ? chunk.y0 : chunk.x0;
      for (let s = 0; s < CELLS_PER_CHUNK; s += 1) {
        if (rng() >= trackChance) continue;
        const steps = Math.round(cell / trackStep);
        for (let i = 0; i < steps; i += 1) {
          const a = start + s * cell + i * trackStep;
          const b = a + trackStep;
          // Fades in and out at the ends of a stretch.
          const alpha = trackAlpha * Math.min(1, (Math.min(i, steps - 1 - i) + 0.5) / 2);
          for (const side of [-1, 1]) {
            const offsetA = wander(a, line) + side * trackGauge;
            const offsetB = wander(b, line) + side * trackGauge;
            const point = (along, across) => (northSouth ? [line + across, along] : [along, line + across]);
            const [ax0, ay0] = point(a, offsetA - trackWidth / 2);
            const [ax1, ay1] = point(a, offsetA + trackWidth / 2);
            const [bx1, by1] = point(b, offsetB + trackWidth / 2);
            const [bx0, by0] = point(b, offsetB - trackWidth / 2);
            const middle = point((a + b) / 2, (offsetA + offsetB) / 2);
            chunk.paint.push({ track: true, x: middle[0], y: middle[1], alpha, pts: [ax0, ay0, ax1, ay1, bx1, by1, bx0, by0] });
          }
        }
      }
    }
  }
}

// Zebra crossing on the road along one edge of the block. Not on the chunk's own border roads:
// half of it would belong to the neighbouring chunk.
// ---- Streets ----

const round1 = (v) => Math.round(v * 10) / 10;

// A rectangle with rounded corners, as a polygon, pulled in from the cell's edge by inset.
function roundedRect(cell, inset, radius) {
  const x0 = cell.x0 + inset;
  const y0 = cell.y0 + inset;
  const x1 = cell.x1 - inset;
  const y1 = cell.y1 - inset;
  const r = Math.max(2, radius);
  const points = [];
  const corner = (cx, cy, start) => {
    for (let s = 0; s <= 4; s += 1) {
      const a = start + (s / 4) * (Math.PI / 2);
      points.push(round1(cx + Math.cos(a) * r), round1(cy + Math.sin(a) * r));
    }
  };
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  corner(x1 - r, y0 + r, Math.PI * 1.5);
  return points;
}

// A rectangle centred on (x, y), along and across, turned by angle (radians), as a polygon.
function turnedRect(x, y, along, across, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const points = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = (u * along) / 2;
    const b = (v * across) / 2;
    points.push(round1(x + a * c - b * s), round1(y + a * s + b * c));
  }
  return points;
}

// A crack: a few short wandering pieces from (x, y).
function crack(paint, rng, x, y, angle) {
  const width = WORLD.street.crackWidth;
  const pieces = 3 + Math.floor(rng() * 3);
  for (let p = 0; p < pieces; p += 1) {
    const length = 12 + rng() * 18;
    angle += (rng() * 2 - 1) * 0.9;
    const nx = x + Math.cos(angle) * length;
    const ny = y + Math.sin(angle) * length;
    paint.push({ poly: turnedRect((x + nx) / 2, (y + ny) / 2, length + width, width, angle), color: 'crack', alpha: 0.75 });
    x = nx;
    y = ny;
  }
}

// A block's ground: a curb, a pavement inside it and the block itself, all with rounded corners. An asphalt block
// has driveways through its curb, and sometimes a crack. Maps without streets keep a plain square.
function blockGround(cell, rng, arrangement) {
  if (map.wild) return wildGround(cell, rng);
  if (!map.streets) return [{ x: cell.x0, y: cell.y0, w: cell.size, h: cell.size, alpha: 1, color: 'lot' }];
  const st = WORLD.street;
  const edge = st.curb + st.sidewalk;
  const grass = st.grassBlocks.includes(arrangement);
  const shade = round1(1000 * (1 + (rng() * 2 - 1) * st.lotShade)) / 1000;
  const marks = [
    { poly: roundedRect(cell, 0, st.cornerRadius), color: 'curb', alpha: 1 },
    { poly: roundedRect(cell, st.curb, st.cornerRadius - st.curb), color: 'sidewalk', alpha: 1 },
    { poly: roundedRect(cell, edge, st.cornerRadius - edge), color: grass ? 'grass' : 'lot', alpha: 1, ...(grass ? {} : { shade }) },
  ];
  if (grass) {
    // Mowing stripes, every other one darker. The first and last are left plain, which keeps them off the corners.
    const inner = { x0: cell.x0 + edge, y0: cell.y0 + edge, size: cell.size - edge * 2 };
    const band = inner.size / st.mowStripes;
    const across = rng() < 0.5;
    for (let k = 1; k < st.mowStripes - 1; k += 2) {
      const middle = inner.size / 2;
      const at = band * (k + 0.5);
      const poly = across ? turnedRect(inner.x0 + middle, inner.y0 + at, inner.size, band, 0) : turnedRect(inner.x0 + at, inner.y0 + middle, band, inner.size, 0);
      marks.push({ poly, color: 'grass', alpha: 1, shade: 0.93 });
    }
    return marks;
  }
  const count = st.driveways[0] + Math.floor(rng() * (st.driveways[1] - st.driveways[0] + 1));
  const sides = [0, 1, 2, 3].sort(() => rng() - 0.5).slice(0, count);
  for (const side of sides) {
    const width = lerp(st.drivewayWidth[0], st.drivewayWidth[1], rng());
    const from = st.cornerRadius + 40;
    const along = from + rng() * (cell.size - from * 2 - width) + width / 2;
    const depth = edge + 2;
    const x = side === 1 ? cell.x1 - depth / 2 : side === 3 ? cell.x0 + depth / 2 : cell.x0 + along;
    const y = side === 0 ? cell.y0 + depth / 2 : side === 2 ? cell.y1 - depth / 2 : cell.y0 + along;
    const poly = side % 2 === 0 ? turnedRect(x, y, width, depth, 0) : turnedRect(x, y, depth, width, 0);
    marks.push({ poly, color: 'lot', alpha: 1, shade });
  }
  if (rng() < 0.5) crack(marks, rng, cell.x0 + edge + 40 + rng() * (cell.size - edge * 2 - 80), cell.y0 + edge + 40 + rng() * (cell.size - edge * 2 - 80), rng() * Math.PI * 2);
  return marks;
}

// Wear on the chunk's roads: patches where the road was mended, cracks, and manholes in the lanes.
// The challenge map's ground: faint mended patches and cracks in the asphalt, nothing else.
function addBareGround(chunk, rng) {
  const g = map.bareGround;
  const anywhere = (margin) => [chunk.x0 + margin + rng() * (CHUNKS.size - margin * 2), chunk.y0 + margin + rng() * (CHUNKS.size - margin * 2)];
  for (let n = 0; n < g.patches; n += 1) {
    const [x, y] = anywhere(120);
    const along = lerp(g.patchSize[0][0], g.patchSize[0][1], rng());
    const across = lerp(g.patchSize[1][0], g.patchSize[1][1], rng());
    chunk.paint.push({ poly: turnedRect(x, y, along, across, rng() * Math.PI), color: 'patch', alpha: g.patchAlpha });
  }
  for (let n = 0; n < g.cracks; n += 1) {
    const [x, y] = anywhere(60);
    crack(chunk.paint, rng, x, y, rng() * Math.PI * 2);
  }
}

// ---- Woods ground (drawing only) ----

// A small lumpy shape, as a flat polygon.
function lump(rng, x, y, r, sides = 7, squash = 1) {
  const spin = rng() * Math.PI * 2;
  const poly = [];
  for (let i = 0; i < sides; i += 1) {
    const a = spin + (i / sides) * Math.PI * 2;
    const reach = r * (0.7 + rng() * 0.6);
    poly.push(round1(x + Math.cos(a) * reach), round1(y + Math.sin(a) * reach * squash));
  }
  return poly;
}

// A block of wild grass: darker and lighter patches, a bare spot now and then, and tufts.
function wildGround(cell, rng) {
  const marks = [];
  const spot = (r) => ({ x: cell.x0 + r + rng() * (cell.size - r * 2), y: cell.y0 + r + rng() * (cell.size - r * 2) });
  for (let k = 0; k < WOODS_MAP.grassPatches; k += 1) {
    const r = 35 + rng() * 55;
    const p = spot(r);
    marks.push({ poly: lump(rng, p.x, p.y, r, 9, 0.75), color: k % 2 ? 'grassLight' : 'grassDark', alpha: 0.45 });
  }
  if (rng() < 0.5) {
    const p = spot(40);
    marks.push({ poly: lump(rng, p.x, p.y, 22 + rng() * 18, 8, 0.7), color: 'mud', alpha: 0.55 });
  }
  for (let k = 0; k < WOODS_MAP.tufts; k += 1) {
    const p = spot(12);
    const s = 5 + rng() * 4;
    // Three blades: a little W.
    marks.push({ poly: [p.x - s, p.y, p.x - s * 0.55, p.y - s * 1.3, p.x - s * 0.2, p.y - s * 0.2, p.x, p.y - s * 1.6, p.x + s * 0.2, p.y - s * 0.2, p.x + s * 0.55, p.y - s * 1.3, p.x + s, p.y].map(round1), color: 'grassDark', alpha: 0.9 });
  }
  return marks;
}

// What a stretch of Woods road is made of, from its place in the world (northSouth, the line it runs along and
// which stretch of it), so the chunks on both sides of a border agree. Its shapes come from the same numbers.
function stretchRng(northSouth, line, stretch) {
  return createRng((Math.imul(line, 73856093) ^ Math.imul(stretch, 19349663) ^ (northSouth ? 0x5bd1e995 : 0x27d4eb2f)) >>> 0);
}
function wildRoadType(northSouth, line, stretch) {
  // The roads out of the crossing where a run starts are always asphalt: a clean start.
  const startLine = Math.round((northSouth ? START.x : START.y) / WORLD.cell);
  const startAlong = Math.round((northSouth ? START.y : START.x) / WORLD.cell);
  if (line === startLine && (stretch === startAlong || stretch === startAlong - 1)) return 'asphalt';
  return pickWeighted(stretchRng(northSouth, line, stretch), WOODS_MAP.roads);
}

// The Woods roads, drawn over grass laid across the whole chunk. Each stretch from one crossing to the next is a
// worn track that curves gently from side to side, its width changing and its edges uneven, never a ruled strip:
//   asphalt: old road with its lane lines, potholes, and grass at its edges;
//   mud:     a muddy track with ruts and puddles;
//   grass:   no road at all, just two worn ruts through the grass.
// The curve is an S that comes back to the middle at both crossings and halfway along, so roads meet at the
// crossings and line up with the river's bridges. The shapes come from each stretch's place in the world, so the
// chunks on both sides of a border draw the same. The driving is the same everywhere.
function addWildRoads(chunk) {
  const { cell, margin } = WORLD;
  const W = WOODS_MAP;
  const typeAt = (northSouth, k, j) => wildRoadType(northSouth, (northSouth ? chunk.cx : chunk.cy) * CELLS_PER_CHUNK + k, (northSouth ? chunk.cy : chunk.cx) * CELLS_PER_CHUNK + j);
  // Lane lines and arrows only on the asphalt; they are put back on top at the end.
  const lines = chunk.paint.filter((mark) => {
    if (mark.color || mark.poly || mark.ring) return false;
    const x = mark.arrow ? mark.x : mark.x + mark.w / 2;
    const y = mark.arrow ? mark.y : mark.y + mark.h / 2;
    const northSouth = Math.abs(x - Math.round(x / cell) * cell) < Math.abs(y - Math.round(y / cell) * cell);
    const k = Math.round((northSouth ? x - chunk.x0 : y - chunk.y0) / cell);
    const j = Math.floor((northSouth ? y - chunk.y0 : x - chunk.x0) / cell);
    return typeAt(northSouth, k, Math.max(0, Math.min(CELLS_PER_CHUNK - 1, j))) === 'asphalt';
  });
  // Grass under everything, then the blocks' own patches (already painted), then the roads.
  chunk.paint = chunk.paint.filter((mark) => mark.color || mark.poly || mark.ring);
  chunk.paint.unshift({ x: chunk.x0, y: chunk.y0, w: CHUNKS.size, h: CHUNKS.size, alpha: 1, color: 'lot' });
  const paint = (poly, color, alpha = 1) => chunk.paint.push({ poly, color, alpha });
  for (const northSouth of [true, false]) {
    for (let k = 0; k <= CELLS_PER_CHUNK; k += 1) {
      for (let j = 0; j < CELLS_PER_CHUNK; j += 1) {
        const lineId = (northSouth ? chunk.cx : chunk.cy) * CELLS_PER_CHUNK + k;
        const stretchId = (northSouth ? chunk.cy : chunk.cx) * CELLS_PER_CHUNK + j;
        const rng = stretchRng(northSouth, lineId, stretchId);
        const type = wildRoadType(northSouth, lineId, stretchId);
        const across = (northSouth ? chunk.x0 : chunk.y0) + k * cell;
        const from = (northSouth ? chunk.y0 : chunk.x0) + j * cell;
        const style = W.roadStyle[type];
        const bend = (rng() < 0.5 ? -1 : 1) * style.bend * (0.5 + rng() * 0.5);
        const ripple = (rng() - 0.5) * style.bend * 0.5;
        const swell = rng() * Math.PI * 2;
        // The middle line across the road at a point t (0..1) along the stretch, and the road's half-width there.
        const middle = (t) => bend * Math.sin(Math.PI * 2 * t) + ripple * Math.sin(Math.PI * 4 * t);
        const halfWidth = (t) => style.half * (1 + 0.14 * Math.sin(t * 7 + swell));
        const steps = 14;
        const point = (t, off) => {
          const along = from + cell * t;
          return northSouth ? [across + off, along] : [along, across + off];
        };
        if (type === 'grass') {
          for (const side of [-1, 1]) paint(trackPoly(rng, steps, (t) => point(t, middle(t) + side * W.ruts), 12, 3), 'mud', 0.4);
          continue;
        }
        // The road itself, its two edges ragged.
        const left = [];
        const right = [];
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const end = i === 0 || i === steps;
          const ragL = end ? 0 : (rng() - 0.5) * 2 * style.ragged;
          const ragR = end ? 0 : (rng() - 0.5) * 2 * style.ragged;
          left.push(...point(t, middle(t) - halfWidth(t) - ragL));
          right.unshift(...point(t, middle(t) + halfWidth(t) + ragR).reverse());
        }
        // right was put in back to front, each pair reversed by unshift: turn the pairs the right way round.
        const back = [];
        for (let i = 0; i < right.length; i += 2) back.push(right[i + 1], right[i]);
        paint([...left, ...back].map(round1), type === 'mud' ? 'mud' : 'asphalt');
        if (type === 'mud') {
          for (const side of [-1, 1]) paint(trackPoly(rng, steps, (t) => point(t, middle(t) + side * W.ruts * 0.8), 9, 2), 'mudDark', 0.55);
          for (let n = 1 + Math.floor(rng() * 2); n > 0; n -= 1) {
            const t = 0.15 + rng() * 0.7;
            const [x, y] = point(t, middle(t) + (rng() - 0.5) * style.half);
            paint(lump(rng, x, y, 13 + rng() * 14, 9, 0.6), 'puddle', 0.85);
          }
        } else {
          for (let n = Math.floor(rng() * 3); n > 0; n -= 1) {
            const t = 0.1 + rng() * 0.8;
            const [x, y] = point(t, middle(t) + (rng() - 0.5) * style.half);
            paint(lump(rng, x, y, 7 + rng() * 9, 7, 0.75), 'puddle', 0.7);
          }
        }
      }
    }
  }
  // Crossings: one patch of whichever surface the roads meeting there have most of.
  for (let i = 0; i <= CELLS_PER_CHUNK; i += 1) {
    for (let j = 0; j <= CELLS_PER_CHUNK; j += 1) {
      const meeting = [];
      if (j > 0) meeting.push(typeAt(true, i, j - 1));
      if (j < CELLS_PER_CHUNK) meeting.push(typeAt(true, i, j));
      if (i > 0) meeting.push(typeAt(false, j, i - 1));
      if (i < CELLS_PER_CHUNK) meeting.push(typeAt(false, j, i));
      const asphalt = meeting.filter((t) => t === 'asphalt').length;
      const mud = meeting.filter((t) => t === 'mud').length;
      if (asphalt === 0 && mud === 0) continue; // tracks crossing on grass
      const x = chunk.x0 + i * cell;
      const y = chunk.y0 + j * cell;
      const rng = createRng((Math.imul(chunk.cx * CELLS_PER_CHUNK + i, 2654435761) ^ Math.imul(chunk.cy * CELLS_PER_CHUNK + j, 40503)) >>> 0);
      paint(lump(rng, x, y, margin * 1.05, 12, 1), asphalt >= mud ? 'asphalt' : 'mud');
    }
  }
  chunk.paint.push(...lines);
}

// A thin, wobbling band along a line: at(t) gives the point on the line at t (0..1).
function trackPoly(rng, steps, at, width, wobble) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const [x, y] = at(i / steps);
    points.push({ x, y });
  }
  return stripPoly(points.map((p) => ({ x: p.x + (rng() - 0.5) * wobble, y: p.y + (rng() - 0.5) * wobble })), width);
}

// A band along a line of points, `width` wide, as a flat polygon.
function stripPoly(points, width) {
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / length) * (width / 2);
    const ny = ((b.x - a.x) / length) * (width / 2);
    left.push(round1(points[i].x + nx), round1(points[i].y + ny));
    right.unshift(round1(points[i].x - nx), round1(points[i].y - ny));
  }
  return [...left, ...right];
}

function addRoadWear(chunk, rng) {
  const st = WORLD.street;
  const { cell, margin } = WORLD;
  // A point on one of the chunk's roads (its north and west edges, and the roads between its blocks).
  const onRoad = (across) => {
    const vertical = rng() < 0.5;
    const line = Math.floor(rng() * CELLS_PER_CHUNK) * cell;
    const along = rng() * CHUNKS.size;
    const offset = (rng() * 2 - 1) * across;
    return vertical ? { x: chunk.x0 + line + offset, y: chunk.y0 + along, vertical } : { x: chunk.x0 + along, y: chunk.y0 + line + offset, vertical };
  };
  for (let i = 0; i < st.patches; i += 1) {
    const along = lerp(st.patchSize[0][0], st.patchSize[0][1], rng());
    const across = lerp(st.patchSize[1][0], st.patchSize[1][1], rng());
    const at = onRoad(margin - across / 2 - 8);
    const angle = (at.vertical ? Math.PI / 2 : 0) + (rng() * 2 - 1) * 0.06;
    chunk.paint.push({ poly: turnedRect(at.x, at.y, along, across, angle), color: 'patch', alpha: st.patchAlpha });
  }
  for (let i = 0; i < st.cracks; i += 1) {
    const at = onRoad(margin - 40);
    crack(chunk.paint, rng, at.x, at.y, rng() * Math.PI * 2);
  }
  for (let i = 0; i < st.manholes; i += 1) {
    const at = onRoad(0);
    const side = (rng() < 0.5 ? -1 : 1) * margin * 0.5; // in a lane, not on the centre line
    const x = at.vertical ? at.x + side : at.x;
    const y = at.vertical ? at.y : at.y + side;
    const disc = (r) => Array.from({ length: 10 }, (_, k) => [round1(x + Math.cos((k / 10) * Math.PI * 2) * r), round1(y + Math.sin((k / 10) * Math.PI * 2) * r)]).flat();
    chunk.paint.push({ poly: disc(14), color: 'crack', alpha: 0.9 }, { poly: disc(10.5), color: 'manhole', alpha: 1 });
  }
}

function addCrosswalk(cell, paint, rng, i, j) {
  const horizontal = rng() < 0.5;
  const width = 150;
  const stripe = 18;
  if (horizontal) {
    // Across the road above the block: stripes run north-south.
    if (j === 0) return;
    const y = cell.y0 - WORLD.margin - 35;
    for (let s = -width / 2; s < width / 2; s += stripe * 2) paint.push({ x: cell.midX + s, y, w: stripe, h: 70, alpha: SCENERY.crosswalkAlpha });
  } else {
    if (i === 0) return;
    const x = cell.x0 - WORLD.margin - 35;
    for (let s = -width / 2; s < width / 2; s += stripe * 2) paint.push({ x, y: cell.midY + s, w: 70, h: stripe, alpha: SCENERY.crosswalkAlpha });
  }
}

// Dashed centre lines along every road, broken at the crossings. Lines on the chunk's border stick
// out by half their width: the floor drawing cuts each chunk to its own square, and the
// neighbouring chunk draws the same dash from its side, so the two halves always meet.
function addLaneLines(chunk) {
  const { cell, margin } = WORLD;
  const { laneDash, laneGap, laneWidth } = SCENERY;
  const step = laneDash + laneGap;
  const middleX = chunk.x0 + CHUNKS.size / 2;
  const middleY = chunk.y0 + CHUNKS.size / 2;
  const onPlaza = (x, y) => chunk.preset === 'plaza' && Math.abs(x - middleX) < WORLD.plazaHalfSize && Math.abs(y - middleY) < WORLD.plazaHalfSize;
  for (let k = 0; k <= CELLS_PER_CHUNK; k += 1) {
    const line = k * cell;
    for (let j = 0; j < CELLS_PER_CHUNK; j += 1) {
      for (let along = j * cell + margin; along + laneDash <= (j + 1) * cell - margin; along += step) {
        const vx = chunk.x0 + line;
        const vy = chunk.y0 + along;
        if (!onPlaza(vx, vy + laneDash / 2)) chunk.paint.push({ x: vx - laneWidth / 2, y: vy, w: laneWidth, h: laneDash, alpha: SCENERY.laneAlpha });
        const hx = chunk.x0 + along;
        const hy = chunk.y0 + line;
        if (!onPlaza(hx + laneDash / 2, hy)) chunk.paint.push({ x: hx, y: hy - laneWidth / 2, w: laneDash, h: laneWidth, alpha: SCENERY.laneAlpha });
      }
    }
  }
}
