import { ARENA, COLLISION, SCENERY, START, WORLD } from '../config/tuning.js';
import { createRng } from '../utils/math.js';

// The arena's contents as plain data, shared by the drawing (render/Scenery.js) and the
// collisions (systems/CollisionSystem.js). No Phaser here, so it can be tested on its own.
//
// The arena is a grid of city blocks ("cells") with open roads between them. Each block gets
// one arrangement (parking row, concrete blocks, trees ...), picked with a fixed seed, so the
// map is identical on every run and on every device.
//
// Item: { kind, name, x, y, heading (radians, 0 = north), model (drawing cache key), params,
//         band: 'objects' | 'raised' | 'wall', collider: null | {type:'circle', r} | {type:'box', hw, hl},
//         breakable, curb }
// layout.cones lists every breakable item (cones and lamp posts): they all get knocked away the same way.
// A box collider's hw runs along the item's local x (right), hl along its local y (forward).
// Paint: axis-aligned rectangles on the floor { x, y, w, h, alpha, color? } (x, y = top-left
// corner; color 'lot' = the lighter surface of a city block, otherwise white paint).

const DEG = Math.PI / 180;
const ISLAND_WIDTH = 70; // matches propModels.js

export function buildLayout(seed = WORLD.seed) {
  const rng = createRng(seed);
  counter = 0;
  const items = [];
  const paint = [];
  const cones = [];
  addWalls(items);

  const cols = Math.round(ARENA.width / WORLD.cell);
  const rows = Math.round(ARENA.height / WORLD.cell);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const cell = makeCell(cx, cy, rng, items);
      paint.push({ x: cell.x0, y: cell.y0, w: cell.size, h: cell.size, alpha: 1, color: 'lot' });
      const kind = pickWeighted(rng, WORLD.mix);
      BUILDERS[kind](cell, items, paint, rng);
      if (rng() < WORLD.crosswalkChance) addCrosswalk(cell, paint, rng);
    }
  }
  addLaneLines(paint, cols, rows);
  for (const item of items) if (item.breakable) cones.push(item);
  return { items, paint, cones };
}

function makeCell(cx, cy, rng, items) {
  const x0 = cx * WORLD.cell + WORLD.margin;
  const y0 = cy * WORLD.cell + WORLD.margin;
  const size = WORLD.cell - WORLD.margin * 2;
  return {
    cx,
    cy,
    x0,
    y0,
    x1: x0 + size,
    y1: y0 + size,
    midX: x0 + size / 2,
    midY: y0 + size / 2,
    size,
    placed: [], // { x, y, r } of things already in this cell
    items,
  };
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
  const treeKind = rng() < 0.55 ? 'pine' : 'leafy';
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
    kind: 'lamp',
    name: named('lamp'),
    x,
    y,
    heading: headingDeg * DEG,
    model: 'lamp',
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

    add(
      cell,
      {
        kind: 'island',
        name: named('island'),
        x,
        y,
        heading: ns ? 0 : 90 * DEG,
        model: `island${length}`,
        params: { length },
        band: 'raised',
        collider: { type: 'box', hw: ISLAND_WIDTH / 2, hl: halfL },
        breakable: false,
        curb: true,
      },
      halfL,
    );
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

    // Stalls: short white lines across both sides of the island.
    const edge = ISLAND_WIDTH / 2 + 6;
    const stall = SCENERY.stallLength;
    for (const side of [-1, 1]) {
      const near = side < 0 ? -edge - stall : edge;
      for (let s = -halfL + 12; s <= halfL - 12; s += SCENERY.stallSpacing) {
        if (ns) paint.push({ x: x + near, y: y + s - 2, w: stall, h: 4, alpha: 0.85 });
        else paint.push({ x: x + s - 2, y: y + near, w: 4, h: stall, alpha: 0.85 });
      }
    }
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
          model: `block${type.width}x${type.length}x${type.height}`,
          params: type,
          band: 'objects',
          collider: { type: 'box', hw: type.width / 2, hl: type.length / 2 },
          breakable: false,
        },
        r,
      );
    }
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
      const turn = pick(rng, WORLD.barrierTurnsDeg);
      // A barrier mesh lies along local x; heading turns it.
      add(
        cell,
        {
          kind: 'barrier',
          name: named('barrier'),
          x: spot.x,
          y: spot.y,
          heading: turn * DEG,
          model: `barrier${length}`,
          params: { length },
          band: 'objects',
          collider: { type: 'box', hw: length / 2, hl: 13 },
          breakable: false,
        },
        r,
      );
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

  open() {},
};

// Zebra crossing on the road along one edge of the block.
function addCrosswalk(cell, paint, rng) {
  const horizontal = rng() < 0.5;
  const width = 150;
  const stripe = 18;
  if (horizontal) {
    // Across the road above the block: stripes run north-south.
    const y = cell.y0 - WORLD.margin - 35;
    if (y < 60) return;
    for (let s = -width / 2; s < width / 2; s += stripe * 2) paint.push({ x: cell.midX + s, y, w: stripe, h: 70, alpha: 0.8 });
  } else {
    const x = cell.x0 - WORLD.margin - 35;
    if (x < 60) return;
    for (let s = -width / 2; s < width / 2; s += stripe * 2) paint.push({ x, y: cell.midY + s, w: 70, h: stripe, alpha: 0.8 });
  }
}

// Dashed centre lines along every road (cell borders), broken at the crossings.
function addLaneLines(paint, cols, rows) {
  const { cell, margin } = WORLD;
  const { laneDash, laneGap, laneWidth } = SCENERY;
  const step = laneDash + laneGap;
  for (let k = 1; k < cols; k += 1) {
    const x = k * cell;
    for (let j = 0; j < rows; j += 1) {
      for (let y = j * cell + margin; y + laneDash <= (j + 1) * cell - margin; y += step) {
        paint.push({ x: x - laneWidth / 2, y, w: laneWidth, h: laneDash, alpha: 0.32 });
      }
    }
  }
  for (let k = 1; k < rows; k += 1) {
    const y = k * cell;
    for (let j = 0; j < cols; j += 1) {
      for (let x = j * cell + margin; x + laneDash <= (j + 1) * cell - margin; x += step) {
        paint.push({ x, y: y - laneWidth / 2, w: laneDash, h: laneWidth, alpha: 0.32 });
      }
    }
  }
}

// Arena walls: short barrier pieces along each edge (drawing only; collisions use the edges).
function addWalls(items) {
  const t = ARENA.wallThickness;
  const { width: W, height: H } = ARENA;
  const sides = [
    { name: 'north', from: [-t, -t / 2], to: [W + t, -t / 2], normal: { x: 0, y: -1 } },
    { name: 'south', from: [-t, H + t / 2], to: [W + t, H + t / 2], normal: { x: 0, y: 1 } },
    { name: 'west', from: [-t / 2, 0], to: [-t / 2, H], normal: { x: -1, y: 0 } },
    { name: 'east', from: [W + t / 2, 0], to: [W + t / 2, H], normal: { x: 1, y: 0 } },
  ];
  for (const side of sides) {
    const dx = side.to[0] - side.from[0];
    const dy = side.to[1] - side.from[1];
    const total = Math.hypot(dx, dy);
    const count = Math.ceil(total / SCENERY.wallSegment);
    const length = total / count;
    for (let i = 0; i < count; i += 1) {
      const k = (i + 0.5) / count;
      items.push({
        kind: 'wall',
        name: `wall-${side.name}-${i}`,
        x: side.from[0] + dx * k,
        y: side.from[1] + dy * k,
        heading: dx !== 0 ? 0 : 90 * DEG,
        model: `wall${Math.round(length)}`,
        params: { length, width: t * 0.75, height: SCENERY.wallHeight },
        band: 'wall',
        normal: side.normal,
        collider: null,
        breakable: false,
      });
    }
  }
}
