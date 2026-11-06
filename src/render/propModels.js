import { COLLISION, PALETTE, PILLARS, RAMP, RENDER, ROADBLOCK, SCENERY, WOODS_MAP, WORLD } from '../config/tuning.js';
import { glyphBars, glyphWidth } from './blockFont.js';
import { box, decal, faceted, frustum, glowing, ngon, rect, shadeColor, shell } from './lowpoly.js';
import { sedan } from './playerCars.js';

// Low-poly placeholder props, built from a few solids each. Original designs.
// Local axes: x = right, y = forward, z = up; each prop is centred on its ground point.

export const ISLAND_WIDTH = 70;
export const ISLAND_HEIGHT = 7;
export const LAMP_REACH = 26; // how far the lamp head sticks out from the pole (along local +y)
export const LAMP_HEIGHT = 104;

// Concrete block with a chamfered top edge.
export function concreteBlock({ width, length, height }) {
  const bevel = Math.min(4, height * 0.15);
  return [
    box(-width / 2, width / 2, -length / 2, length / 2, 0, height - bevel, PALETTE.concrete, 0),
    frustum(rect(0, 0, width, length), rect(0, 0, width - bevel * 2, length - bevel * 2), height - bevel, height, PALETTE.concrete, 1),
  ];
}

// Jersey-style road barrier lying along local x, with painted warning stripes.
export function barrier({ length, width = 26, height = 30, stripes = true }) {
  const half = length / 2;
  const foot = Math.max(5, height * 0.22);
  const upper = frustum(
    { x0: -half, x1: half, y0: -width / 2, y1: width / 2 },
    { x0: -half + 1, x1: half - 1, y0: -width * 0.2, y1: width * 0.2 },
    foot,
    height,
    PALETTE.barrier,
    1,
  );
  if (stripes) {
    const count = Math.max(2, Math.round(length / 40));
    for (let i = 0; i < count; i += 2) {
      for (const face of ['front', 'back']) decal(upper, face, i / count, (i + 1) / count, 0.12, 0.88, PALETTE.barrierStripe);
    }
  }
  return [box(-half, half, -width / 2, width / 2, 0, foot, PALETTE.barrier, 0), upper];
}

export function pineTree(size = 1) {
  const s = size * SCENERY.treeScale;
  return [
    ngon({ sides: 5, r0: 5 * s, r1: 4 * s, z0: 0, z1: 22 * s, color: PALETTE.trunk, layer: 0 }),
    ngon({ sides: 7, r0: 31 * s, r1: 0, z0: 14 * s, z1: 58 * s, color: PALETTE.pineDark, rotation: 0.2, layer: 1 }),
    ngon({ sides: 7, r0: 25 * s, r1: 0, z0: 36 * s, z1: 76 * s, color: PALETTE.pine, rotation: 0.6, layer: 2 }),
    ngon({ sides: 7, r0: 17 * s, r1: 0, z0: 58 * s, z1: 92 * s, color: PALETTE.pineDark, rotation: 0.1, layer: 3 }),
  ];
}

// A round deciduous tree: a faceted ball of leaves on a brown trunk.
export function leafyTree(size = 1, color = PALETTE.leafy) {
  const s = size * SCENERY.treeScale;
  const crown = (x, y, z0, z1, radius, tone, layer, seed) =>
    roughen(faceted({ x: x * s, y: y * s, z0: z0 * s, z1: z1 * s, radius: radius * s, color: shadeColor(color, tone), sides: 7, layer, rings: [[0, 0.45], [0.25, 0.9], [0.55, 1], [0.82, 0.66], [1, 0]] }), 0.14, seed, x * s, y * s);
  return [
    ngon({ sides: 5, r0: 6.5 * s, r1: 3.6 * s, z0: 0, z1: 8 * s, color: PALETTE.trunk, layer: 0 }),
    ngon({ sides: 5, r0: 3.6 * s, r1: 3 * s, z0: 8 * s, z1: 34 * s, color: PALETTE.trunk, layer: 0 }),
    crown(4, 6, 22, 60, 25, 0.86, 1, 1),
    crown(-9, -4, 26, 66, 22, 1, 2, 2),
    crown(6, -8, 40, 80, 19, 1.12, 3, 3),
  ];
}

// A pine under snow: each tier is green below a white cap.
export function snowPine(size = 1) {
  const s = size * SCENERY.treeScale;
  const tier = (r, z0, z1, layer, color) => [
    ngon({ sides: 7, r0: r * s, r1: r * 0.62 * s, z0: z0 * s, z1: (z0 + (z1 - z0) * 0.42) * s, color, rotation: layer * 0.4, layer: layer * 2 + 1 }),
    ngon({ sides: 7, r0: r * 0.62 * s, r1: 0, z0: (z0 + (z1 - z0) * 0.42) * s, z1: z1 * s, color: PALETTE.snow, rotation: layer * 0.4, layer: layer * 2 + 2 }),
  ];
  return [
    ngon({ sides: 5, r0: 5 * s, r1: 4 * s, z0: 0, z1: 20 * s, color: PALETTE.trunk, layer: 0 }),
    ...tier(30, 14, 54, 0, PALETTE.pineDark),
    ...tier(23, 36, 72, 1, PALETTE.pine),
    ...tier(15, 58, 90, 2, PALETTE.pineDark),
  ];
}

// Stretches a model: sx across, sz up. For tall-and-thin or short-and-wide versions of a tree.
function stretch(parts, sx, sz) {
  for (const part of parts) {
    for (const v of part.verts) {
      v[0] *= sx;
      v[1] *= sx;
      v[2] *= sz;
    }
    for (const face of part.faces) if (face.quad) for (const v of face.quad) { v[0] *= sx; v[1] *= sx; v[2] *= sz; }
  }
  return parts;
}

// A tall, slim tree: a crooked trunk that splits into branches, each ending in its own small clump of leaves at a
// different height (after the owner's reference picture).
export function branchyTree(size = 1, color = PALETTE.leafy) {
  const s = size * SCENERY.treeScale;
  const bark = PALETTE.trunk;
  const at = (x, y, z) => [x * s, y * s, z * s];
  const clump = (x, y, z, r, tone, layer, seed) =>
    roughen(faceted({ x: x * s, y: y * s, z0: (z - r * 0.8) * s, z1: (z + r * 0.9) * s, radius: r * s, color: shadeColor(color, tone), sides: 6, layer, rings: [[0, 0.5], [0.3, 0.95], [0.62, 1], [0.86, 0.6], [1, 0]] }), 0.16, seed, x * s, y * s);
  return [
    ngon({ sides: 5, r0: 4.2 * s, r1: 3 * s, z0: 0, z1: 30 * s, color: bark, layer: 0 }),
    twig(at(0, 0, 28), at(3, -1, 62), 4.6 * s, bark, 0),
    twig(at(3, -1, 60), at(1, 0, 92), 3.6 * s, bark, 0),
    twig(at(0, 0, 34), at(-16, 3, 48), 2.4 * s, bark, 1),
    twig(at(2, -1, 50), at(16, -2, 66), 2.4 * s, bark, 1),
    twig(at(3, -1, 70), at(-12, -3, 82), 2.2 * s, bark, 1),
    clump(-17, 3, 50, 10, 1, 2, 1),
    clump(17, -2, 68, 12, 0.92, 2, 2),
    clump(-12, -3, 84, 11, 1.08, 3, 3),
    clump(2, 0, 98, 14, 1, 4, 4),
  ];
}

// A young tree: a thin trunk and one small crown.
export function saplingTree(size = 1, color = PALETTE.leafy) {
  const s = size * SCENERY.treeScale;
  return [
    ngon({ sides: 5, r0: 2.6 * s, r1: 2 * s, z0: 0, z1: 26 * s, color: PALETTE.trunk, layer: 0 }),
    roughen(faceted({ z0: 20 * s, z1: 46 * s, radius: 14 * s, color: shadeColor(color, 1.08), sides: 6, layer: 1, rings: [[0, 0.5], [0.3, 0.95], [0.6, 1], [0.85, 0.6], [1, 0]] }), 0.15, 6, 0, 0),
  ];
}

// A cactus: a tall ribbed column with two arms.
export function cactus(size = 1, arms = 2) {
  const s = size * SCENERY.treeScale * 1.15;
  const c = PALETTE.cactus;
  const column = (x, y, r, z0, z1, layer) => ngon({ x, y, sides: 6, r0: r * s, r1: r * s * 0.85, z0: z0 * s, z1: z1 * s, color: c, layer });
  const parts = [column(0, 0, 8, 0, arms === 0 ? 58 : 72, 2)];
  if (arms >= 1) parts.push(box(-20 * s, -6 * s, -3.5 * s, 3.5 * s, 32 * s, 40 * s, c, 1), column(-20 * s, 0, 4.5, 32, 58, 1));
  if (arms >= 2) parts.push(box(6 * s, 19 * s, -3.5 * s, 3.5 * s, 22 * s, 30 * s, c, 3), column(19 * s, 0, 4.5, 22, 46, 3));
  return parts;
}

// A bare dead tree, orange against the grass.
export function deadTree(size = 1) {
  const s = size * SCENERY.treeScale;
  const c = PALETTE.log;
  const twig = (x, y, z) => box(-1.4 * s + x * s, 1.4 * s + x * s, -1.4 * s + y * s, 1.4 * s + y * s, z * s, (z + 16) * s, c, 2);
  return [
    ngon({ sides: 5, r0: 6 * s, r1: 2 * s, z0: 0, z1: 70 * s, color: c, layer: 0 }),
    box(-16 * s, 0, -1.6 * s, 1.6 * s, 34 * s, 37 * s, c, 1),
    box(0, 14 * s, -1.6 * s, 1.6 * s, 46 * s, 49 * s, c, 1),
    twig(-15, 0, 35),
    twig(13, 0, 47),
  ];
}

// A felled log, lying along local y.
export function felledLog() {
  const log = shell({ hw: 8, y0: -34, y1: 34, z0: 0, z1: 15, color: PALETTE.log, cut: 3, bevel: 3 });
  decal(log, 'front', 0.2, 0.8, 0.2, 0.8, PALETTE.logEnd);
  decal(log, 'back', 0.2, 0.8, 0.2, 0.8, PALETTE.logEnd);
  decal(log, 'top', 0.3, 0.4, 0.1, 0.55, shadeColor(PALETTE.log, 0.75));
  decal(log, 'top', 0.6, 0.7, 0.45, 0.9, shadeColor(PALETTE.log, 0.75));
  return [log];
}

// A great red rock, flat-topped.
// shape: 'mound' (a broad banded rock), 'butte' (steep sides, a flat top), 'spire' (tall and narrow).
export function mesa(size = 1, shape = 'mound') {
  const r = WORLD.mesaRadius * size;
  const bands = [shadeColor(PALETTE.mesa, 0.88), PALETTE.mesa, shadeColor(PALETTE.mesa, 1.14), shadeColor(PALETTE.mesa, 0.96)];
  if (shape === 'butte') {
    const rock = roughen(faceted({ z0: 0, z1: r * 1.5, radius: r * 1.05, color: PALETTE.mesa, sides: 7, rings: [[0, 1], [0.3, 0.97], [0.85, 0.9], [0.97, 0.82], [1, 0]] }), 0.1, size * 3, 0, 0);
    band(rock, r * 1.5, bands);
    return [rock];
  }
  if (shape === 'spire') {
    const rock = roughen(faceted({ z0: 0, z1: r * 2.1, radius: r * 0.75, color: PALETTE.mesa, sides: 6, rings: [[0, 1], [0.35, 0.82], [0.7, 0.6], [0.92, 0.42], [1, 0]] }), 0.14, size * 5, 0, 0);
    band(rock, r * 2.1, bands);
    return [rock, roughen(faceted({ x: r * 0.8, y: r * 0.3, z0: 0, z1: r * 0.45, radius: r * 0.4, color: shadeColor(PALETTE.mesa, 0.9), sides: 5, layer: 1, rings: [[0, 1], [0.6, 0.8], [1, 0]] }), 0.2, size * 7, r * 0.8, r * 0.3)];
  }
  const rock = roughen(faceted({ z0: 0, z1: r * 0.95, radius: r * 1.18, color: PALETTE.mesa, sides: 7, rings: [[0, 1], [0.35, 0.97], [0.7, 0.86], [0.93, 0.62], [1, 0]] }), 0.16, size * 7, 0, 0);
  band(rock, r * 0.95, [shadeColor(PALETTE.mesa, 0.88), PALETTE.mesa, shadeColor(PALETTE.mesa, 1.14), shadeColor(PALETTE.mesa, 0.96)]);
  const stone = roughen(faceted({ x: r * 1.05, y: -r * 0.55, z0: 0, z1: r * 0.38, radius: r * 0.36, color: shadeColor(PALETTE.mesa, 0.9), sides: 5, layer: 1, rings: [[0, 1], [0.6, 0.8], [1, 0]] }), 0.2, size * 11, r * 1.05, -r * 0.55);
  return [rock, stone];
}

// A water tower: four wooden legs under a round tank with a pointed lid.
export function waterTower() {
  const w = PALETTE.towerWood;
  const legs = [[-18, -18], [18, -18], [18, 18], [-18, 18]].map(([x, y]) => box(x - 2.5, x + 2.5, y - 2.5, y + 2.5, 0, 72, w, 0));
  const brace = box(-19, 19, -19, 19, 34, 37, w, 1);
  return [
    ...legs,
    brace,
    ngon({ sides: 10, r0: 26, r1: 26, z0: 72, z1: 108, color: PALETTE.towerTank, layer: 2 }),
    ngon({ sides: 10, r0: 29, r1: 0, z0: 108, z1: 124, color: PALETTE.towerWood, layer: 3 }),
  ];
}

// A wooden telegraph pole with a cross arm.
export function telegraphPole() {
  const w = PALETTE.towerWood;
  return [
    box(-2.5, 2.5, -2.5, 2.5, 0, LAMP_HEIGHT, w, 0),
    box(-20, 20, -1.5, 1.5, LAMP_HEIGHT - 10, LAMP_HEIGHT - 6, w, 1),
    box(-14, 14, -1.5, 1.5, LAMP_HEIGHT - 22, LAMP_HEIGHT - 18, w, 1),
  ];
}

// A wooden cabin with a pitched roof and a garage door. Same footprint as the repair shop.
export function cabin() {
  const { shopHalfWidth: hw, shopHalfLength: hl } = WORLD.station;
  const wall = shell({ hw, y0: -hl, y1: hl, z0: 0, z1: 44, color: PALETTE.cabinWall, cut: 1, bevel: 0 });
  decal(wall, 'front', 0.1, 0.46, 0, 0.72, PALETTE.shopDoor);
  for (let k = 1; k < 5; k += 1) decal(wall, 'front', 0.1, 0.46, k * 0.14, k * 0.14 + 0.016, PALETTE.shopDoorLine);
  decal(wall, 'front', 0.58, 0.88, 0.32, 0.74, PALETTE.glass);
  for (const side of ['left', 'right']) decal(wall, side, 0.3, 0.7, 0.4, 0.76, PALETTE.glass);
  decal(wall, 'back', 0.3, 0.7, 0.4, 0.76, PALETTE.glass);
  const roof = frustum({ x0: -hw - 5, x1: hw + 5, y0: -hl - 5, y1: hl + 5 }, { x0: -hw + 8, x1: hw - 8, y0: -1, y1: 1 }, 44, 74, PALETTE.cabinRoof, 1);
  const chimney = box(hw * 0.5, hw * 0.5 + 14, -14, 0, 56, 84, 0x7a4a34, 2);
  return [wall, roof, chimney];
}

// A low-poly grey rock.
// shape: 'lump' (a rounded lump with a stone at its foot), 'slab' (low and flat), 'jagged' (tall and broken),
// 'pile' (two or three stones together).
export function boulder(size = 1, shape = 'lump') {
  const r = WORLD.boulderRadius * size;
  const c = PALETTE.boulder;
  const piece = (x, y, height, radius, tone, layer, seed, sides = 5) =>
    roughen(faceted({ x, y, z0: 0, z1: height, radius, color: shadeColor(c, tone), sides, layer, rings: [[0, 1], [0.55, 0.8], [1, 0]] }), 0.24, seed, x, y);
  if (shape === 'slab') {
    return [roughen(faceted({ z0: 0, z1: r * 0.55, radius: r * 1.45, color: c, sides: 7, rings: [[0, 1], [0.6, 0.95], [0.9, 0.7], [1, 0]] }), 0.2, size * 13, 0, 0)];
  }
  if (shape === 'jagged') {
    return [
      roughen(faceted({ z0: 0, z1: r * 2, radius: r * 0.95, color: c, sides: 5, rings: [[0, 1], [0.4, 0.8], [0.75, 0.45], [1, 0]] }), 0.3, size * 17, 0, 0),
      piece(r * 0.9, -r * 0.5, r * 0.7, r * 0.5, 0.9, 1, size * 19),
    ];
  }
  if (shape === 'pile') {
    return [
      piece(-r * 0.45, r * 0.2, r * 0.9, r * 0.75, 1, 0, size * 23, 6),
      piece(r * 0.55, -r * 0.1, r * 0.75, r * 0.65, 0.88, 1, size * 29, 6),
      piece(0, -r * 0.65, r * 0.55, r * 0.5, 1.08, 2, size * 31),
    ];
  }
  const rock = roughen(faceted({ z0: 0, z1: r * 1.15, radius: r * 1.2, color: PALETTE.boulder, sides: 6, rings: [[0, 0.95], [0.4, 1], [0.8, 0.74], [1, 0]] }), 0.24, size * 5, 0, 0);
  const stone = roughen(faceted({ x: r * 1.05, y: r * 0.45, z0: 0, z1: r * 0.55, radius: r * 0.45, color: shadeColor(PALETTE.boulder, 0.9), sides: 5, layer: 1, rings: [[0, 1], [0.55, 0.8], [1, 0]] }), 0.22, size * 9, r * 1.05, r * 0.45);
  return [rock, stone];
}

// Pushes the points of a faceted solid about, so it is a lump rather than a perfectly round shape. The same
// every time for the same seed. (cx, cy): its middle.
function roughen(part, amount, seed, cx, cy) {
  const top = Math.max(...part.verts.map((v) => v[2]));
  part.verts.forEach((v, i) => {
    const r1 = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const r2 = Math.sin((i + 1) * 39.3468 + seed * 11.135) * 24634.6345;
    const k = 1 + ((r1 - Math.floor(r1)) - 0.5) * 2 * amount;
    v[0] = cx + (v[0] - cx) * k;
    v[1] = cy + (v[1] - cy) * k;
    if (v[2] > 0) v[2] = Math.min(top * 1.05, v[2] * (1 + ((r2 - Math.floor(r2)) - 0.5) * amount));
  });
  return part;
}

// Colours a rock's faces in bands by height, like layered stone. colors: from the bottom up.
function band(part, height, colors) {
  for (const face of part.faces) {
    const z = face.v.reduce((sum, i) => sum + part.verts[i][2], 0) / face.v.length;
    face.color = colors[Math.min(colors.length - 1, Math.floor((z / height) * colors.length))];
  }
}

// A park bench: wooden slats on a dark frame. Runs along local x; its seat faces local -y.
export function bench() {
  const wood = PALETTE.bench;
  const frame = PALETTE.trim;
  const parts = [-20, 20].map((x) => box(x - 1.5, x + 1.5, -7, 7, 0, 11, frame, 0));
  for (const y of [-5.5, -1.5, 2.5]) parts.push(box(-24, 24, y - 1.5, y + 1.5, 11, 13, wood, 1));
  for (const z of [16, 21]) parts.push(box(-24, 24, 5, 7, z - 1.5, z + 1.5, wood, 2));
  for (const x of [-20, 20]) parts.push(box(x - 1.5, x + 1.5, 5.5, 7.5, 11, 23, frame, 1));
  return parts;
}

// A billboard on two steel posts, showing a gold crown on the side the camera sees.
export function billboard() {
  const posts = [-42, 42].map((x) => box(x - 3, x + 3, -3, 3, 0, 50, PALETTE.pole, 0));
  const frame = box(-64, 64, -4, 4, 46, 94, PALETTE.pole, 1);
  const board = box(-61, 61, -5, 5, 49, 91, PALETTE.billboard, 2);
  const face = board.faces.find((f) => f.name === 'back');
  const crown = [[-22, 56], [22, 56], [28, 82], [13, 68], [0, 86], [-13, 68], [-28, 82]];
  face.decals.push({ pts: crown.map(([x, z]) => [x, -5, z]), color: PALETTE.crownGold, unlit: true });
  face.decals.push({ pts: [[-22, -5, 53], [22, -5, 53], [22, -5, 55], [-22, -5, 55]], color: PALETTE.crownGold, unlit: true });
  return [...posts, frame, board];
}

// The gas station's roof: a white rim under a bright red top. Nothing is under it but the pump islands, so
// cars can drive beneath it: it is drawn above them (band 'overhead').
export function canopyRoof() {
  const { roofHalfWidth: hw, roofHalfLength: hl } = WORLD.station;
  const rim = shell({ hw, y0: -hl, y1: hl, z0: 54, z1: 61, color: PALETTE.canopyRim, cut: 1, bevel: 0 });
  const top = shell({ hw: hw - 2, y0: -hl + 2, y1: hl - 2, z0: 61, z1: 64, color: PALETTE.canopyRed, cut: 1, bevel: 1.5, layer: 1 });
  for (const face of ['back', 'right', 'front', 'left']) decal(rim, face, 0, 1, 0.1, 0.4, PALETTE.canopyRed);
  return [rim, top];
}

function fuelPump(y) {
  const body = shell({ hw: 8, y0: y - 6, y1: y + 6, z0: 5, z1: 30, color: PALETTE.pumpBody, cut: 1.2, bevel: 1, layer: 2 });
  for (const face of ['back', 'front', 'right', 'left']) {
    decal(body, face, 0.15, 0.85, 0.55, 0.85, PALETTE.glass);
    decal(body, face, 0, 1, 0.12, 0.28, PALETTE.canopyRed);
  }
  return body;
}

// A fuel island: a raised strip with two pumps, and the post that holds up the roof.
export function pumpIsland() {
  const { pumpHalfWidth: hw, pumpHalfLength: hl } = WORLD.station;
  const base = shell({ hw, y0: -hl, y1: hl, z0: 0, z1: 5, color: PALETTE.curb, cut: 3, bevel: 1 });
  const post = shell({ hw: 4, y0: -4, y1: 4, z0: 5, z1: 54, color: PALETTE.canopyRim, cut: 1, bevel: 0, layer: 1 });
  return [base, post, fuelPump(-24), fuelPump(24)];
}

// An auto repair shop: grey walls, a dark flat roof, three dark garage doors along its front, under a red sign.
export function repairShop() {
  const { shopHalfWidth: hw, shopHalfLength: hl } = WORLD.station;
  const wall = shell({ hw, y0: -hl, y1: hl, z0: 0, z1: 50, color: PALETTE.shopWall, cut: 1, bevel: 0 });
  for (let i = 0; i < 3; i += 1) {
    const u0 = 0.05 + i * 0.3;
    decal(wall, 'front', u0, u0 + 0.26, 0, 0.66, PALETTE.shopDoor);
    for (let k = 1; k < 5; k += 1) decal(wall, 'front', u0, u0 + 0.26, k * 0.13, k * 0.13 + 0.015, PALETTE.shopDoorLine);
  }
  decal(wall, 'front', 0.1, 0.9, 0.76, 0.92, PALETTE.canopyRed);
  for (const side of ['left', 'right']) decal(wall, side, 0.15, 0.85, 0.45, 0.78, PALETTE.glass);
  decal(wall, 'back', 0.2, 0.8, 0.45, 0.78, PALETTE.glass);
  const roof = shell({ hw: hw + 2, y0: -hl - 2, y1: hl + 2, z0: 50, z1: 54, color: PALETTE.shopRoof, cut: 1.5, bevel: 1.2, layer: 1 });
  const unit = shell({ hw: 14, y0: -18, y1: 6, z0: 54, z1: 62, color: 0x8f949b, cut: 1, bevel: 1, layer: 2 });
  return [wall, roof, unit];
}

// A small square security booth with windows all round and a flat roof.
export function guardBooth() {
  const wall = shell({ hw: 20, y0: -20, y1: 20, z0: 0, z1: 40, color: PALETTE.boothWall, cut: 2, bevel: 0 });
  for (const face of ['back', 'right', 'front', 'left']) {
    decal(wall, face, 0.12, 0.88, 0.45, 0.85, PALETTE.glass);
    decal(wall, face, 0.14, 0.34, 0.47, 0.83, PALETTE.glassShine);
  }
  const roof = shell({ hw: 25, y0: -25, y1: 25, z0: 40, z1: 45, color: PALETTE.shopRoof, cut: 3, bevel: 1.5, layer: 1 });
  return [wall, roof];
}

// Street lamp; the head reaches out along local +y.
export function lampPost() {
  return [
    box(-5, 5, -5, 5, 0, 6, PALETTE.pole, 0),
    box(-2, 2, -2, 2, 6, LAMP_HEIGHT + 6, PALETTE.pole, 1),
    box(-1.5, 1.5, 0, LAMP_REACH, LAMP_HEIGHT + 2, LAMP_HEIGHT + 6, PALETTE.pole, 2),
    glowing(box(-5, 5, LAMP_REACH - 7, LAMP_REACH + 5, LAMP_HEIGHT - 2, LAMP_HEIGHT + 3, PALETTE.lamp, 3)),
  ];
}

// ---- Suburbs street furniture ----

// A fire hydrant: squat and red, with nozzles on its sides and a domed cap.
export function hydrant() {
  return [
    ngon({ sides: 8, r0: 7, r1: 7, z0: 0, z1: 3, color: PALETTE.hydrantDark, layer: 0 }),
    ngon({ sides: 8, r0: 5.4, r1: 5, z0: 3, z1: 17, color: PALETTE.hydrant, layer: 1 }),
    box(-8, 8, -2.2, 2.2, 9.5, 13.5, PALETTE.hydrantDark, 2),
    ngon({ sides: 8, r0: 5.6, r1: 2, z0: 17, z1: 22, color: PALETTE.hydrant, layer: 3 }),
  ];
}

// A mailbox on a post, with a little red flag. Faces local +y.
export function mailbox() {
  const body = shell({ hw: 6, y0: -9, y1: 9, z0: 22, z1: 32, color: PALETTE.mailbox, cut: 1.5, bevel: 2.5, layer: 1 });
  decal(body, 'front', 0.2, 0.8, 0.15, 0.7, shadeColor(PALETTE.mailbox, 0.7));
  return [box(-1.5, 1.5, -1.5, 1.5, 0, 22, PALETTE.pole, 0), body, box(6, 7.5, -4, -2, 26, 36, PALETTE.mailboxFlag, 2)];
}

// A wheelie bin with a lid.
export function trashCan() {
  return [
    ngon({ sides: 10, r0: 9.5, r1: 11, z0: 0, z1: 24, color: PALETTE.trashcan, layer: 0 }),
    ngon({ sides: 10, r0: 12, r1: 11, z0: 24, z1: 27, color: PALETTE.trashLid, layer: 1 }),
  ];
}

// A round garden hedge.
export function bush(size = 1) {
  return [faceted({ z0: 0, z1: 24 * size, radius: 18 * size, color: PALETTE.hedge, sides: 7, layer: 0, rings: [[0, 0.8], [0.35, 1], [0.75, 0.75], [1, 0]] })];
}

// One piece of white picket fence, along local x.
export function picketFence() {
  const c = PALETTE.fence;
  const parts = [box(-22, 22, -1, 1, 7, 9, c, 0), box(-22, 22, -1, 1, 14, 16, c, 0)];
  for (let x = -20; x <= 20; x += 8) parts.push(box(x - 1.6, x + 1.6, -1.4, 1.4, 0, 20, c, 1));
  return parts;
}

// A ramp: low at the back, high at the front (local +y), in site yellow with black chevrons.
export function jumpRamp() {
  const hw = RAMP.width / 2;
  const hl = RAMP.length / 2;
  const h = RAMP.height;
  const part = { ...frustum({ x0: -hw, x1: hw, y0: -hl, y1: hl }, { x0: -hw, x1: hw, y0: -hl, y1: hl }, 0, [0.6, 0.6, h, h], { sides: PALETTE.rampDark, top: PALETTE.ramp }, 0) };
  for (const v of [0.18, 0.46, 0.74]) decal(part, 'top', 0.08, 0.92, v, v + 0.1, PALETTE.rampDark);
  return [part];
}

// ---- Winter, Desert and Woods ----

// Moves a part sideways (along local x).
function shiftX(part, dx) {
  for (const v of part.verts) v[0] += dx;
  for (const face of part.faces) if (face.quad) for (const v of face.quad) v[0] += dx;
  if (part.minX !== undefined) {
    part.minX += dx;
    part.maxX += dx;
  }
  return part;
}

const BALL = [[0, 0.62], [0.28, 1], [0.66, 0.9], [1, 0]];

// A snowman: three balls of snow, a coal hat and eyes, a carrot nose and twig arms. It faces the camera (local -y).
export function snowman() {
  const c = PALETTE.snow;
  return [
    faceted({ z0: 0, z1: 26, radius: 14, color: c, sides: 8, layer: 0, rings: BALL }),
    faceted({ z0: 20, z1: 39, radius: 10, color: c, sides: 8, layer: 1, rings: BALL }),
    box(-21, -9, -1, 1, 29, 31, PALETTE.trunk, 2),
    box(9, 21, -1, 1, 29, 31, PALETTE.trunk, 2),
    box(-1.3, 1.3, -10.5, -8.5, 27, 29.5, PALETTE.coal, 2),
    faceted({ z0: 35, z1: 49, radius: 7.5, color: c, sides: 8, layer: 3, rings: BALL }),
    box(-1.4, 1.4, -13, -6, 41, 43.5, PALETTE.carrot, 4),
    box(-3.4, -1.6, -7.2, -5.8, 44, 46, PALETTE.coal, 4),
    box(1.6, 3.4, -7.2, -5.8, 44, 46, PALETTE.coal, 4),
    ngon({ sides: 8, r0: 7, r1: 7, z0: 47, z1: 48.5, color: PALETTE.coal, layer: 5 }),
    ngon({ sides: 8, r0: 4.6, r1: 4.4, z0: 48.5, z1: 56, color: PALETTE.coal, layer: 6 }),
  ];
}

// A thin straight twig from point a to point b ([x, y, z]), `t` thick: a long box turned to lie along the line.
function twig(a, b, t, color, layer) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d) || 1;
  const n = d.map((k) => k / length);
  // Two directions square to the twig, each t/2 long.
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const norm = (p) => {
    const l = Math.hypot(...p) || 1;
    return p.map((k) => (k / l) * (t / 2));
  };
  const u = norm(cross(n, helper));
  const v = norm(cross(n, u));
  const corner = (p, su, sv) => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
  const verts = [];
  for (const p of [a, b]) for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) verts.push(corner(p, su, sv));
  const faces = [
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
    [3, 2, 1, 0],
    [4, 5, 6, 7],
  ].map((v2) => ({ v: v2, color, decals: [] }));
  return { verts, faces, layer };
}

// A tumbleweed: a round, bulky ball of dry twigs. A dark tangled middle, twigs criss-crossing all over it, and
// rings of twig running round it so its outline is round from every side.
export function tumbleweed() {
  const r = 21;
  const middle = [0, 0, r];
  const colors = [PALETTE.tumbleweed, shadeColor(PALETTE.tumbleweed, 0.7), shadeColor(PALETTE.tumbleweed, 1.15)];
  const parts = [faceted({ z0: 3, z1: r * 2 - 4, radius: r * 0.72, color: shadeColor(PALETTE.tumbleweed, 0.6), sides: 7, layer: 0, rings: [[0, 0.55], [0.2, 0.9], [0.5, 1], [0.8, 0.85], [1, 0]] })];
  // Points spread over the ball (a fixed spiral, so every tumbleweed is the same drawing).
  const count = 30;
  const points = Array.from({ length: count }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - z * z);
    const a = i * 2.39996;
    const reach = r * (0.9 + 0.1 * Math.sin(i * 5.3));
    return [Math.cos(a) * ring * reach, Math.sin(a) * ring * reach, r + z * reach];
  });
  for (let i = 0; i < count; i += 1) parts.push(twig(points[i], points[(i * 7 + 5) % count], 1.8, colors[i % 3], 1 + (i % 2)));
  // Three rings round it, each turned a different way.
  for (const [tilt, turn] of [[0.3, 0], [1.25, 0.9], [1.0, 2.1]]) {
    const ringPoint = (a) => {
      let x = Math.cos(a) * r;
      let y = Math.sin(a) * r;
      let z = 0;
      [y, z] = [y * Math.cos(tilt), y * Math.sin(tilt)];
      [x, y] = [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
      return [x, y, r + z];
    };
    for (let k = 0; k < 10; k += 1) parts.push(twig(ringPoint((k / 10) * Math.PI * 2), ringPoint(((k + 1) / 10) * Math.PI * 2), 2, colors[(k + 1) % 3], 2));
  }
  for (let i = 0; i < 5; i += 1) parts.push(twig(points[i * 6], middle, 1.5, colors[(i + 1) % 3], 1));
  return parts;
}

// An oil pump: a beam nodding on an A-frame, a horse head at the front (local +y) over the well, the motor and
// its counterweights at the back.
export function pumpjack() {
  const c = PALETTE.pumpjack;
  const dark = shadeColor(c, 0.7);
  return [
    box(-15, 15, -40, 40, 0, 4, dark, 0),
    box(-9, 9, -38, -22, 4, 18, c, 1),
    box(-13, -9, -30, -20, 8, 28, PALETTE.pumpjackHead, 1),
    box(9, 13, -30, -20, 8, 28, PALETTE.pumpjackHead, 1),
    box(-11, -6, -5, 5, 4, 42, c, 1),
    box(6, 11, -5, 5, 4, 42, c, 1),
    ngon({ x: 0, y: 34, sides: 6, r0: 5, r1: 4, z0: 4, z1: 10, color: dark, layer: 1 }),
    box(-0.8, 0.8, 33.2, 34.8, 10, 30, PALETTE.pole, 2),
    box(-3.5, 3.5, -30, 30, 42, 48, c, 3),
    box(-4.5, 4.5, 26, 38, 28, 52, PALETTE.pumpjackHead, 4),
  ];
}

// An oil barrel, with two bands round it.
export function oilBarrel() {
  const c = PALETTE.barrel;
  const band = PALETTE.barrelBand;
  return [
    ngon({ sides: 10, r0: 9, r1: 9, z0: 0, z1: 8, color: c, layer: 0 }),
    ngon({ sides: 10, r0: 9.4, r1: 9.4, z0: 8, z1: 10, color: band, layer: 1 }),
    ngon({ sides: 10, r0: 9, r1: 9, z0: 10, z1: 17, color: c, layer: 2 }),
    ngon({ sides: 10, r0: 9.4, r1: 9.4, z0: 17, z1: 19, color: band, layer: 3 }),
    ngon({ sides: 10, r0: 9, r1: 8.6, z0: 19, z1: 26, color: c, topColor: band, layer: 4 }),
  ];
}

// A stack of sawn logs along local y: four at the bottom, then three, then two, their ends pale.
export function lumberStack() {
  const wood = shadeColor(PALETTE.log, 0.92);
  const parts = [];
  const log = (x, z, layer) => {
    const part = shell({ hw: 7.5, y0: -48, y1: 48, z0: z, z1: z + 15, color: wood, cut: 3, bevel: 2.5, layer });
    decal(part, 'front', 0.15, 0.85, 0.15, 0.85, PALETTE.logEnd);
    decal(part, 'back', 0.15, 0.85, 0.15, 0.85, PALETTE.logEnd);
    parts.push(shiftX(part, x));
  };
  for (const x of [-22.5, -7.5, 7.5, 22.5]) log(x, 0, 0);
  for (const x of [-15, 0, 15]) log(x, 13, 1);
  for (const x of [-7.5, 7.5]) log(x, 26, 2);
  return parts;
}

// A plank deck over the river, as wide as the road and running along local y.
export function bridgeDeck() {
  const half = WOODS_MAP.deckLength / 2;
  const hw = WORLD.margin;
  const deck = box(-hw, hw, -half, half, 0, 5, PALETTE.bridgeDeck, 0);
  for (let v = 0.04; v < 0.98; v += 0.08) decal(deck, 'top', 0, 1, v, v + 0.025, PALETTE.bridgePlank);
  return [deck, box(-hw, -hw + 8, -half, half, 5, 8, PALETTE.railing, 1), box(hw - 8, hw, -half, half, 5, 8, PALETTE.railing, 1)];
}

// A wooden railing along local x: posts and two rails.
export function railing() {
  const half = WOODS_MAP.deckLength / 2;
  const c = PALETTE.railing;
  const parts = [box(-half, half, -1.5, 1.5, 9, 12, c, 1), box(-half, half, -1.5, 1.5, 17, 20, c, 1)];
  for (let x = -half + 2; x <= half - 2; x += 37) parts.push(box(x - 2.2, x + 2.2, -2.2, 2.2, 0, 22, shadeColor(c, 0.85), 0));
  return parts;
}

export function trafficCone() {
  return [
    box(-8, 8, -8, 8, 0, 2, PALETTE.cone, 0),
    ngon({ sides: 8, r0: 6.5, r1: 4.8, z0: 2, z1: 8, color: PALETTE.cone, layer: 1 }),
    ngon({ sides: 8, r0: 4.8, r1: 3.6, z0: 8, z1: 12, color: PALETTE.coneStripe, layer: 2 }),
    ngon({ sides: 8, r0: 3.6, r1: 1.5, z0: 12, z1: 19, color: PALETTE.cone, layer: 3 }),
  ];
}

// The lucky die: the power-up that gives a random item. A big dark amber die with dark spots and a bevelled
// top. A few versions show different numbers on their visible faces: swapped at each bounce, they make
// it look as if it is rolling after the car.
export const DIE_SIZE = 42;
const DIE_SPOTS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
// The numbers on the faces in view: [top, one side, the other side].
export const DIE_ROLLS = [
  [1, 2, 3],
  [5, 4, 1],
  [3, 6, 5],
  [2, 3, 6],
];

function dieSpots(part, face, number) {
  const size = 0.16;
  for (const [column, row] of DIE_SPOTS[number]) {
    const u = 0.25 + column * 0.25;
    const v = 0.25 + row * 0.25;
    decal(part, face, u - size / 2, u + size / 2, v - size / 2, v + size / 2, PALETTE.cratePip);
  }
}

export function luckyDie(roll = 0) {
  const h = DIE_SIZE / 2;
  const bevel = 4;
  const [top, sideA, sideB] = DIE_ROLLS[roll];
  const body = box(-h, h, -h, h, 0, DIE_SIZE - bevel, PALETTE.crate, 0);
  dieSpots(body, 'back', sideA);
  dieSpots(body, 'right', sideB);
  const cap = frustum(rect(0, 0, DIE_SIZE, DIE_SIZE), rect(0, 0, DIE_SIZE - bevel * 2, DIE_SIZE - bevel * 2), DIE_SIZE - bevel, DIE_SIZE, PALETTE.crate, 1);
  dieSpots(cap, 'top', top);
  return [body, cap];
}

// One giant block letter, standing on a plinth. Bars are painted far ones first, so nearer ones cover
// the faces where they meet (the letter is always seen from its x = 0 side: see WorldLayout).
export function blockLetter(letter, color) {
  const u = WORLD.letterUnit;
  const half = (glyphWidth(letter) * u) / 2;
  const t = WORLD.letterThickness / 2;
  const bars = [...glyphBars(letter)].sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return bars.map(([x0, z0, x1, z1], order) =>
    box(x0 * u - half, x1 * u - half, -t, t, ISLAND_HEIGHT + z0 * u, ISLAND_HEIGHT + z1 * u, color, order),
  );
}

// Wooden crate: breakable.
export function woodCrate() {
  const body = box(-14, 14, -14, 14, 0, 26, PALETTE.woodCrate, 0);
  for (const face of ['front', 'back', 'left', 'right']) decal(body, face, 0.42, 0.58, 0, 1, PALETTE.woodStrap);
  decal(body, 'top', 0.42, 0.58, 0, 1, PALETTE.woodStrap);
  return [body];
}

// Shipping container, with a dark band near one end. Runs along local y.
export function shippingContainer({ width, length, height, color }) {
  const body = box(-width / 2, width / 2, -length / 2, length / 2, 0, height, PALETTE[color], 0);
  for (const face of ['left', 'right']) decal(body, face, 0.82, 0.96, 0, 1, PALETTE.trim);
  return [body];
}

// The Pillars power-up: a rough stone block, wider at the foot, with a pale top.
export function stonePillar() {
  const h = PILLARS.halfSize;
  const top = PILLARS.height;
  return [
    frustum(rect(0, 0, h * 2 + 8, h * 2 + 8), rect(0, 0, h * 2, h * 2), 0, top * 0.22, PALETTE.pillar, 0),
    frustum(rect(0, 0, h * 2, h * 2), rect(0, 0, h * 2 - 7, h * 2 - 7), top * 0.22, top * 0.9, PALETTE.pillar, 1),
    frustum(rect(0, 0, h * 2 - 3, h * 2 - 3), rect(0, 0, h * 2 - 11, h * 2 - 11), top * 0.9, top, PALETTE.pillarCap, 2),
  ];
}

// A spike strip: a low dark bar with a row of bright steel teeth, and hazard paint. Runs along local x.
export function spikeStrip() {
  const hw = ROADBLOCK.spikeHalfLength;
  const hl = ROADBLOCK.spikeHalfDepth;
  const bar = box(-hw, hw, -hl, hl, 0, 3, PALETTE.spikeBase, 0);
  const stripes = 7;
  for (let i = 0; i < stripes; i += 2) decal(bar, 'top', i / stripes, (i + 1) / stripes, 0, 1, PALETTE.swatStripe);
  const parts = [bar];
  const teeth = 9;
  for (let i = 0; i < teeth; i += 1) {
    const x = -hw + ((i + 0.5) / teeth) * hw * 2;
    for (const y of [-hl * 0.45, hl * 0.45]) parts.push(ngon({ x, y, sides: 3, r0: 4, r1: 0, z0: 3, z1: 12, color: PALETTE.spikeTeeth, layer: 1 }));
  }
  return parts;
}

// Stepped stone base with a tapered column.
export function monument() {
  return [
    ngon({ sides: 8, r0: 40, r1: 36, z0: 0, z1: 12, color: PALETTE.monument, rotation: 0.39, layer: 0 }),
    ngon({ sides: 8, r0: 26, r1: 22, z0: 12, z1: 24, color: PALETTE.monument, rotation: 0.39, layer: 1 }),
    ngon({ sides: 4, r0: 14, r1: 5, z0: 24, z1: 130, color: PALETTE.concrete, rotation: 0.78, layer: 2 }),
  ];
}

// Low round planter in the middle of a roundabout: a curb around grass.
export function roundabout(radius = COLLISION.roundaboutRadius) {
  return [
    ngon({ sides: 14, r0: radius, r1: radius - 2, z0: 0, z1: ISLAND_HEIGHT, color: PALETTE.curb, layer: 0 }),
    ngon({ sides: 14, r0: radius - 8, r1: radius - 8, z0: ISLAND_HEIGHT, z1: ISLAND_HEIGHT + 0.5, color: PALETTE.median, layer: 1 }),
  ];
}

// Parked cars: the same bodywork as the player's sedan-like cars, in everyday shapes. All face along local
// y on the same car-sized footprint (44 x 84).
const CIVILIAN_MODELS = {
  sedan: (body) => sedan({ body }),
  compact: (body) => sedan({ body, L: 74, belt: 18, tail: 17, cabinF: 0.1, cabinB: -0.42, roofF: -0.04, roofB: -0.38, roofZ: 30, wheelY: 0.31 }),
  wagon: (body) => sedan({ body, cabinF: 0.1, cabinB: -0.44, roofF: 0, roofB: -0.42, roofZ: 30, tail: 17 }),
  coupe: (body) => sedan({ body, roofZ: 27, cabinF: 0.02, cabinB: -0.3, roofF: -0.08, roofB: -0.24 }),
};

// Raised island: a low cream curb around fresh grass with a few darker patches. Runs along local y.
export function island(length, width = ISLAND_WIDTH) {
  const curb = frustum(rect(0, 0, width, length), rect(0, 0, width - 3, length - 3), 0, ISLAND_HEIGHT, PALETTE.curb, 0);
  const mu = 7 / width;
  const mv = 7 / length;
  decal(curb, 'top', mu, 1 - mu, mv, 1 - mv, PALETTE.median);
  const tuft = (u, v, w, h) => decal(curb, 'top', u, u + w / width, v, v + h / length, PALETTE.medianTuft);
  for (const [u, v, w, h] of [[0.2, 0.2, 18, 12], [0.62, 0.34, 14, 18], [0.3, 0.62, 16, 14], [0.68, 0.74, 12, 12]]) tuft(u, v, w, h);
  return [curb];
}

// The model for an item of the world layout.
export function propMesh(item) {
  const p = item.params;
  switch (item.kind) {
    case 'island':
      return island(p.length, p.width);
    case 'tree':
      if (p.treeKind === 'pine') return pineTree(p.size);
      if (p.treeKind === 'pineTall') return stretch(pineTree(p.size), 0.78, 1.32);
      if (p.treeKind === 'pineWide') return stretch(pineTree(p.size), 1.22, 0.8);
      if (p.treeKind === 'snowpine') return snowPine(p.size);
      if (p.treeKind === 'snowpineTall') return stretch(snowPine(p.size), 0.8, 1.3);
      if (p.treeKind === 'snowpineWide') return stretch(snowPine(p.size), 1.2, 0.82);
      if (p.treeKind === 'cactus') return cactus(p.size);
      if (p.treeKind === 'cactusOne') return cactus(p.size, 1);
      if (p.treeKind === 'cactusPlain') return cactus(p.size, 0);
      if (p.treeKind === 'dead') return deadTree(p.size);
      if (p.treeKind === 'deadTall') return stretch(deadTree(p.size), 0.85, 1.35);
      if (p.treeKind === 'branchy') return branchyTree(p.size);
      if (p.treeKind === 'sapling') return saplingTree(p.size);
      return leafyTree(p.size, PALETTE[p.treeKind]);
    case 'lamp':
      return lampPost();
    case 'block':
      return concreteBlock(p);
    case 'barrier':
      return barrier({ length: p.length });
    case 'cone':
      return trafficCone();
    case 'woodcrate':
      return woodCrate();
    case 'civilian':
      return CIVILIAN_MODELS[p.shape](PALETTE[p.color]);
    case 'letter':
      return blockLetter(p.letter, PALETTE[p.color]);
    case 'container':
      return shippingContainer(p);
    case 'monument':
      return monument();
    case 'pillar':
      return stonePillar();
    case 'spikes':
      return spikeStrip();
    case 'roundabout':
      return roundabout();
    case 'pole':
      return telegraphPole();
    case 'log':
      return felledLog();
    case 'mesa':
      return mesa(p.size, p.shape);
    case 'tower':
      return waterTower();
    case 'cabin':
      return cabin();
    case 'canopy':
      return canopyRoof();
    case 'pumps':
      return pumpIsland();
    case 'shop':
      return repairShop();
    case 'booth':
      return guardBooth();
    case 'bench':
      return bench();
    case 'boulder':
      return boulder(p.size, p.shape);
    case 'billboard':
      return billboard();
    case 'hydrant':
      return hydrant();
    case 'mailbox':
      return mailbox();
    case 'trashcan':
      return trashCan();
    case 'bush':
      return bush(p.size);
    case 'fence':
      return picketFence();
    case 'ramp':
      return jumpRamp();
    case 'snowman':
      return snowman();
    case 'tumbleweed':
      return tumbleweed();
    case 'pumpjack':
      return pumpjack();
    case 'barrel':
      return oilBarrel();
    case 'lumber':
      return lumberStack();
    case 'bridge':
      return bridgeDeck();
    case 'railing':
      return railing();
    default:
      throw new Error(`No model for ${item.kind}`);
  }
}

// Pixels per world unit to draw an item at.
export function propBakeScale(item) {
  return ['island', 'roundabout', 'canopy', 'shop', 'cabin', 'mesa', 'bridge'].includes(item.kind) ? RENDER.flatBakeScale : RENDER.bakeScale;
}
