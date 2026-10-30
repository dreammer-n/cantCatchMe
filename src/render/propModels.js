import { PALETTE, SCENERY } from '../config/tuning.js';
import { box, decal, frustum, glowing, ngon, rect } from './lowpoly.js';

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

// Shockwave crate (power-up): a teal gift box with a cream ribbon and a glowing lid.
export const CRATE_SIZE = 30;
export function crate() {
  const h = CRATE_SIZE / 2;
  const body = box(-h, h, -h, h, 0, CRATE_SIZE * 0.8, PALETTE.crate, 0);
  for (const face of ['front', 'back', 'left', 'right']) decal(body, face, 0.4, 0.6, 0, 1, PALETTE.crateRibbon);
  const lid = frustum(rect(0, 0, CRATE_SIZE + 4, CRATE_SIZE + 4), rect(0, 0, CRATE_SIZE + 2, CRATE_SIZE + 2), CRATE_SIZE * 0.8, CRATE_SIZE, PALETTE.crate, 1);
  decal(lid, 'top', 0.4, 0.6, 0, 1, PALETTE.crateRibbon, true);
  decal(lid, 'top', 0, 1, 0.4, 0.6, PALETTE.crateRibbon, true);
  return [body, lid];
}

// Raised parking island: low curb around a grass top. Runs along local y.
export function island(length, width = ISLAND_WIDTH) {
  const curb = frustum(rect(0, 0, width, length), rect(0, 0, width - 3, length - 3), 0, ISLAND_HEIGHT, PALETTE.curb, 0);
  const mu = 7 / width;
  const mv = 7 / length;
  decal(curb, 'top', mu, 1 - mu, mv, 1 - mv, PALETTE.grass);
  return [curb];
}
