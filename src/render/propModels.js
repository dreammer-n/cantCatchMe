import { COLLISION, PALETTE, PILLARS, RENDER, ROADBLOCK, SCENERY, WORLD } from '../config/tuning.js';
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
  return [
    ngon({ sides: 5, r0: 5 * s, r1: 4 * s, z0: 0, z1: 26 * s, color: PALETTE.trunk, layer: 0 }),
    faceted({ z0: 20 * s, z1: 76 * s, radius: 33 * s, color, sides: 8, layer: 1, rings: [[0, 0.42], [0.22, 0.88], [0.5, 1], [0.78, 0.68], [1, 0]] }),
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

// A cactus: a tall ribbed column with two arms.
export function cactus(size = 1) {
  const s = size * SCENERY.treeScale * 1.15;
  const c = PALETTE.cactus;
  const column = (x, y, r, z0, z1, layer) => ngon({ x, y, sides: 6, r0: r * s, r1: r * s * 0.85, z0: z0 * s, z1: z1 * s, color: c, layer });
  return [
    column(0, 0, 8, 0, 72, 2),
    box(-20 * s, -6 * s, -3.5 * s, 3.5 * s, 32 * s, 40 * s, c, 1),
    column(-20 * s, 0, 4.5, 32, 58, 1),
    box(6 * s, 19 * s, -3.5 * s, 3.5 * s, 22 * s, 30 * s, c, 3),
    column(19 * s, 0, 4.5, 22, 46, 3),
  ];
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
export function mesa(size = 1) {
  const r = WORLD.mesaRadius * size;
  return [
    faceted({ z0: 0, z1: r * 0.85, radius: r * 1.2, color: PALETTE.mesa, sides: 8, rings: [[0, 1], [0.55, 0.9], [0.95, 0.62], [1, 0]] }),
  ];
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
export function boulder(size = 1) {
  const r = WORLD.boulderRadius * size;
  return [faceted({ z0: 0, z1: r * 1.5, radius: r * 1.25, color: PALETTE.boulder, sides: 6, rings: [[0, 0.92], [0.45, 1], [0.8, 0.6], [1, 0]] })];
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
      if (p.treeKind === 'snowpine') return snowPine(p.size);
      if (p.treeKind === 'cactus') return cactus(p.size);
      if (p.treeKind === 'dead') return deadTree(p.size);
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
      return mesa(p.size);
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
      return boulder(p.size);
    case 'billboard':
      return billboard();
    default:
      throw new Error(`No model for ${item.kind}`);
  }
}

// Pixels per world unit to draw an item at.
export function propBakeScale(item) {
  return ['island', 'roundabout', 'canopy', 'shop', 'cabin', 'mesa'].includes(item.kind) ? RENDER.flatBakeScale : RENDER.bakeScale;
}
