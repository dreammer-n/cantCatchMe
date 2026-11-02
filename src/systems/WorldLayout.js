import { CHUNKS, COLLISION, MAPS, SCENERY, START, VOID, WORLD } from '../config/tuning.js';
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
// Chunk: { cx, cy, x0, y0, seed, preset, items, paint, voids }
// Item: { kind, name, x, y, heading (radians, 0 = north), model (drawing cache key), params,
//         band: 'objects' | 'raised', collider: null | {type:'circle', r} | {type:'box', hw, hl},
//         breakable, curb }
// A box collider's hw runs along the item's local x (right), hl along its local y (forward).
// Breakable items (cones, lamp posts, wooden crates) all get knocked away the same way.
// Void: { kind: 'void', isVoid: true, x, y, heading, collider, outline: [{x, y}] }: a hole in the
// ground; the outline is what gets drawn.
// Paint: rectangles on the floor { x, y, w, h, alpha, color? } (x, y = top-left corner; color 'lot' =
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
  const chunk = { cx, cy, x0: cx * CHUNKS.size, y0: cy * CHUNKS.size, seed: hash, preset, items: [], paint: [], voids: [] };

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
      chunk.paint.push({ x: cell.x0, y: cell.y0, w: cell.size, h: cell.size, alpha: 1, color: 'lot' });
      if (preset === 'plaza' && isPlazaCell(i, j)) continue;
      // The chunk where a run starts has the gas station, in the block ahead and to the right of the start.
      const hub = hasStart && cell.x0 > START.x && cell.x0 < START.x + WORLD.cell && cell.y1 < START.y && cell.y1 > START.y - WORLD.cell;
      const statue = !hub && hasLandmark && i === landmarkI && j === landmarkJ && addLandmark(cell, word);
      if (hub) {
        BUILDERS.station(cell, chunk.items, chunk.paint, rng);
      } else if (!statue) {
        // One gas station to a chunk at most: the start chunk's is the one above.
        let arrangement = pickWeighted(rng, def.cells);
        if (arrangement === 'station' && (hasStart || hasStation)) arrangement = 'lawn';
        if (arrangement === 'station') hasStation = true;
        BUILDERS[arrangement](cell, chunk.items, chunk.paint, rng);
      }
      if (rng() < WORLD.crosswalkChance) addCrosswalk(cell, chunk.paint, rng, i, j);
    }
  }
  if (preset === 'plaza') addPlaza(chunk);
  addLaneLines(chunk);
  addRoadArrows(chunk, rng);
  if (rng() < def.holeChance) addRoadHoles(chunk, def.roadHoles, rng);
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
  const extras = forMap.extras || [];
  const words = new Set(Object.values(forMap.presets || CHUNKS.presets).flatMap((preset) => preset.landmarks));
  const push = (kind, model, headingDeg, params = {}) => list.push({ kind, model, heading: headingDeg * DEG, params });
  for (const length of WORLD.islandLengths) for (const deg of [0, 90]) push('island', `island${length}`, deg, { length });
  for (const treeKind of forMap.trees) for (const size of WORLD.treeSizes) push('tree', `${treeKind}${size}`, 0, { treeKind, size });
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
  if (extras.includes('mesa')) for (const size of WORLD.mesaSizes) push('mesa', mesaModel(size), 0, { size });
  if (extras.includes('tower')) push('tower', 'tower', 0);
  if (extras.includes('log')) for (const deg of WORLD.logTurnsDeg) push('log', 'log', deg);
  push('booth', 'booth', 0);
  for (const deg of WORLD.benchTurnsDeg) push('bench', 'bench', deg);
  for (const size of WORLD.boulderSizes) push('boulder', boulderModel(size), 0, { size });
  for (const deg of [0, 270]) push('billboard', 'billboard', deg); // its board faces the camera either way
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

function mesaModel(size) {
  return `mesa${size}`;
}

function lawnModel(width, length) {
  return `lawn${width}x${length}`;
}

function boulderModel(size) {
  return `boulder${size}`;
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

function tree(x, y, rng) {
  const treeKind = pick(rng, map.trees);
  const size = pick(rng, WORLD.treeSizes);
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
    model: boulderModel(size),
    params: { size },
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
    items.push(island(cell.midX, cell.y1 - 26, WORLD.islandLengths[0], false));
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
    items.push(island(islandX, cell.midY, length, true));
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
        model: mesaModel(size),
        params: { size },
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

  open() {},
};

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
function addRoadHoles(chunk, [fewest, most], rng) {
  const count = fewest + Math.floor(rng() * (most - fewest + 1));
  const used = new Set();
  for (let n = 0; n < count; n += 1) {
    const northSouth = rng() < 0.5;
    const line = 1 + Math.floor(rng() * (CELLS_PER_CHUNK - 1));
    const segment = Math.floor(rng() * CELLS_PER_CHUNK);
    const key = `${northSouth}:${line}:${segment}`;
    if (used.has(key)) continue;
    used.add(key);
    const across = line * WORLD.cell;
    const along = (segment + 0.5) * WORLD.cell;
    const x = chunk.x0 + (northSouth ? across : along);
    const y = chunk.y0 + (northSouth ? along : across);
    if (Math.hypot(x - START.x, y - START.y) < START.clearRadius + 150) continue;
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
