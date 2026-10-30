import { COLLISION, PALETTE, RENDER, SCENERY, WORLD } from '../config/tuning.js';
import { glyphBars, glyphWidth } from './blockFont.js';
import { box, decal, frustum, glowing, hexa, ngon, rect } from './lowpoly.js';

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

export function leafyTree(size = 1) {
  const s = size * SCENERY.treeScale;
  return [
    ngon({ sides: 5, r0: 5 * s, r1: 4 * s, z0: 0, z1: 26 * s, color: PALETTE.trunk, layer: 0 }),
    ngon({ sides: 8, r0: 16 * s, r1: 32 * s, z0: 22 * s, z1: 40 * s, color: PALETTE.leafy, rotation: 0.3, layer: 1 }),
    ngon({ sides: 8, r0: 32 * s, r1: 26 * s, z0: 40 * s, z1: 58 * s, color: PALETTE.leafy, rotation: 0.3, layer: 2 }),
    ngon({ sides: 8, r0: 26 * s, r1: 10 * s, z0: 58 * s, z1: 70 * s, color: PALETTE.leafy, rotation: 0.3, layer: 3 }),
  ];
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

// Shockwave crate (power-up): a wrapped gift box, orange-red with a cream ribbon and a bow on top.
export const CRATE_SIZE = 44;
export function crate() {
  const h = CRATE_SIZE / 2;
  const lidZ = CRATE_SIZE * 0.78;
  const body = box(-h, h, -h, h, 0, lidZ, PALETTE.crate, 0);
  for (const face of ['front', 'back', 'left', 'right']) decal(body, face, 0.4, 0.6, 0, 1, PALETTE.crateRibbon);
  const lid = frustum(rect(0, 0, CRATE_SIZE + 5, CRATE_SIZE + 5), rect(0, 0, CRATE_SIZE + 3, CRATE_SIZE + 3), lidZ, CRATE_SIZE, PALETTE.crate, 1);
  for (const face of ['front', 'back', 'left', 'right']) decal(lid, face, 0.4, 0.6, 0, 1, PALETTE.crateRibbon);
  decal(lid, 'top', 0.4, 0.6, 0, 1, PALETTE.crateRibbon);
  decal(lid, 'top', 0, 1, 0.4, 0.6, PALETTE.crateRibbon);
  // The bow: two loops and a knot.
  const bowZ = CRATE_SIZE;
  const loop = (x) => frustum(rect(x, 0, 12, 9), rect(x * 1.25, 0, 7, 5), bowZ, bowZ + 11, PALETTE.crateRibbon, 2);
  const knot = box(-4, 4, -4, 4, bowZ, bowZ + 7, PALETTE.crateRibbon, 3);
  return [body, lid, loop(-8), loop(8), knot];
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

// Wooden crate: breakable, and brown so it can't be mistaken for the teal Shockwave crate.
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

function civilianWheels() {
  const parts = [];
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const y = end * 27;
      const x0 = side < 0 ? -23 : 19;
      const wheel = box(x0, x0 + 4, y - 8, y + 8, 0, 12, PALETTE.tyre, 0);
      decal(wheel, side < 0 ? 'left' : 'right', 0.3, 0.7, 0.22, 0.66, PALETTE.hub);
      parts.push(wheel);
    }
  }
  return parts;
}

function civilianBody(color) {
  const body = frustum({ x0: -21, x1: 21, y0: -42, y1: 42 }, { x0: -20, x1: 20, y0: -42, y1: 41 }, 5, [18, 18, 15, 15], color, 1);
  decal(body, 'front', 0.06, 0.28, 0.4, 0.85, PALETTE.headlight, true);
  decal(body, 'front', 0.72, 0.94, 0.4, 0.85, PALETTE.headlight, true);
  decal(body, 'back', 0.06, 0.26, 0.45, 0.85, PALETTE.taillight, true);
  decal(body, 'back', 0.74, 0.94, 0.45, 0.85, PALETTE.taillight, true);
  return body;
}

function civilianCabin(color, back, front, roofBack, roofFront) {
  const cabin = hexa(
    [[-18, back, 18], [18, back, 18], [18, front, 18], [-18, front, 18]],
    [[-15, roofBack, 31], [15, roofBack, 31], [15, roofFront, 31], [-15, roofFront, 31]],
    { sides: PALETTE.glass, top: color },
    2,
  );
  for (const side of ['left', 'right']) decal(cabin, side, 0.47, 0.53, 0, 1, color);
  return cabin;
}

// Small car: the cabin runs right to the back. Faces along local y; the footprint is car-sized (44 x 84).
export function hatchback(color) {
  return [...civilianWheels(), civilianBody(color), civilianCabin(color, -41, 12, -38, 0)];
}

// Three-box family car: a boot behind the cabin.
export function sedan(color) {
  return [...civilianWheels(), civilianBody(color), civilianCabin(color, -24, 14, -15, 2)];
}

// Tall delivery van. Faces along local y; the same car-sized footprint.
export function van(color) {
  const parts = civilianWheels();
  const body = frustum({ x0: -21, x1: 21, y0: -42, y1: 42 }, { x0: -19, x1: 19, y0: -42, y1: 24 }, 5, 46, color, 1);
  decal(body, 'front', 0.1, 0.9, 0.5, 0.92, PALETTE.glass);
  decal(body, 'front', 0.06, 0.26, 0.08, 0.2, PALETTE.headlight, true);
  decal(body, 'front', 0.74, 0.94, 0.08, 0.2, PALETTE.headlight, true);
  decal(body, 'back', 0.46, 0.54, 0.1, 0.9, PALETTE.trim); // where the rear doors meet
  for (const side of ['left', 'right']) decal(body, side, side === 'left' ? 0 : 0.76, side === 'left' ? 0.24 : 1, 0.55, 0.88, PALETTE.glass);
  parts.push(body);
  return parts;
}

// Raised parking island: low curb around a vivid top. Runs along local y.
export function island(length, width = ISLAND_WIDTH) {
  const curb = frustum(rect(0, 0, width, length), rect(0, 0, width - 3, length - 3), 0, ISLAND_HEIGHT, PALETTE.curb, 0);
  const mu = 7 / width;
  const mv = 7 / length;
  decal(curb, 'top', mu, 1 - mu, mv, 1 - mv, PALETTE.median);
  return [curb];
}

const CIVILIAN_MODELS = { van, hatchback, sedan };

// The model for an item of the world layout.
export function propMesh(item) {
  const p = item.params;
  switch (item.kind) {
    case 'island':
      return island(p.length);
    case 'tree':
      return p.treeKind === 'pine' ? pineTree(p.size) : leafyTree(p.size);
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
    case 'roundabout':
      return roundabout();
    default:
      throw new Error(`No model for ${item.kind}`);
  }
}

// Pixels per world unit to draw an item at.
export function propBakeScale(item) {
  return item.kind === 'island' || item.kind === 'roundabout' ? RENDER.flatBakeScale : RENDER.bakeScale;
}
