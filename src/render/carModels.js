import { CAR_MODEL, CAR_SIZE, PALETTE } from '../config/tuning.js';
import { box, decal, frustum, hexa, shadeColor } from './lowpoly.js';

// Low-poly car models built from a handful of solids. Original designs:
//   player  red compact muscle coupe with cream racing stripes and a spoiler
//   police  white patrol car with a blue side stripe, push bar and red / blue light bar
//   interceptor  the same patrol car in black and white: dark hood and boot, no stripes
//   wreck   the same body burnt out (used for destroyed police cars and the player's crash)
//   wreckRoof  that wreck lying upside down, wheels in the air

const STYLES = {
  player: {
    body: PALETTE.playerBody,
    stripe: PALETTE.playerStripe,
    glass: PALETTE.glass,
    glassShine: PALETTE.glassShine,
    trim: PALETTE.trim,
    hub: PALETTE.hub,
    tyre: PALETTE.tyre,
    headlight: PALETTE.headlight,
    taillight: PALETTE.taillight,
    spoiler: true,
  },
  police: {
    body: PALETTE.policeBody,
    sideStripe: PALETTE.policeStripe,
    roofStripe: PALETTE.policeStripe,
    glass: PALETTE.glass,
    glassShine: PALETTE.glassShine,
    trim: PALETTE.trim,
    hub: PALETTE.hub,
    tyre: PALETTE.tyre,
    headlight: PALETTE.headlight,
    taillight: PALETTE.taillight,
    pushBar: true,
    lightBar: true,
  },
  interceptor: {
    body: PALETTE.policeBody,
    hood: PALETTE.interceptorDark,
    boot: PALETTE.interceptorDark,
    roofStripe: PALETTE.interceptorDark,
    glass: PALETTE.glass,
    glassShine: PALETTE.glassShine,
    trim: PALETTE.trim,
    hub: PALETTE.hub,
    tyre: PALETTE.tyre,
    headlight: PALETTE.headlight,
    taillight: PALETTE.taillight,
    pushBar: true,
    lightBar: true,
  },
  wreck: {
    body: PALETTE.wreckBody,
    glass: PALETTE.wreckGlass,
    glassShine: PALETTE.wreckGlass,
    trim: 0x1c1d20,
    hub: 0x34363a,
    tyre: 0x141518,
    headlight: 0x2a2826,
    taillight: 0x2a2826,
    unlitLights: false,
    roofDrop: 3, // crumpled roof
  },
};

// Height bands, bottom to top:
//   layer 0  wheels, dark lower sills and bumpers (painted far to near)
//   layer 1  body: hood (sloped), middle, boot (sloped), full width over the wheels
//   layer 2  glass cabin with a flat roof, spoiler or light bar
// Each band is its own solid, so its faces catch the light differently: that is what makes
// the roof, windscreen, sides and hood read as separate surfaces.
function buildCar(style) {
  const m = CAR_MODEL;
  const hl = CAR_SIZE.length / 2;
  const L = CAR_SIZE.length;
  const W = m.bodyHalfWidth;
  const top = W - m.shoulderInset;
  const yF = L * m.cabinFront; // where the windscreen meets the hood
  const yB = L * m.cabinBack; // where the rear window meets the boot
  const roofZ = m.roofHeight - (style.roofDrop || 0);
  const glowLights = style.unlitLights !== false;
  const parts = [];

  // Wheels, with a lighter hub on the outside face.
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const y = end * L * m.wheelBase;
      const x0 = side < 0 ? -m.wheelOuter : m.wheelInner;
      const x1 = side < 0 ? -m.wheelInner : m.wheelOuter;
      const wheel = box(x0, x1, y - m.wheelLength / 2, y + m.wheelLength / 2, 0, m.wheelHeight, style.tyre, 0);
      decal(wheel, side < 0 ? 'left' : 'right', 0.3, 0.7, 0.22, 0.66, style.hub);
      wheel.tag = 'wheel';
      parts.push(wheel);
    }
  }

  // Lower body (sills) and bumpers: darker, so the car's height reads in bands.
  const sill = shadeColor(style.body, m.sillShade);
  const front = hl - m.bumperDepth;
  parts.push(box(-m.sillHalfWidth, m.sillHalfWidth, -front, front, m.sillBottom, m.sillTop, sill, 0));
  const bumperF = box(-W + 2, W - 2, front, hl, m.sillBottom, m.sillTop + 1, style.trim, 0);
  const bumperR = box(-W + 2, W - 2, -hl, -front, m.sillBottom, m.sillTop + 1, style.trim, 0);
  parts.push(bumperF, bumperR);
  if (style.pushBar) {
    for (const x of [-W + 7, W - 10]) parts.push(box(x, x + 3, hl, hl + 3, 5, 14, style.trim, 0));
    parts.push(box(-W + 7, W - 7, hl + 1, hl + 3, 11, 14, style.trim, 0));
  }

  // Upper body in three pieces with matching shoulder lines.
  const z0 = m.sillTop;
  const hood = frustum(
    { x0: -W, x1: W, y0: yF, y1: front },
    { x0: -top, x1: top, y0: yF, y1: front - 1.5 },
    z0,
    [m.beltHeight, m.beltHeight, m.noseHeight, m.noseHeight],
    style.hood || style.body,
    1,
  );
  decal(hood, 'front', 0.05, 0.27, 0.35, 0.85, style.headlight, glowLights);
  decal(hood, 'front', 0.73, 0.95, 0.35, 0.85, style.headlight, glowLights);
  decal(hood, 'front', 0.33, 0.67, 0.25, 0.7, style.trim); // grille
  const middle = frustum({ x0: -W, x1: W, y0: yB, y1: yF }, { x0: -top, x1: top, y0: yB, y1: yF }, z0, m.beltHeight, style.body, 1);
  if (style.sideStripe) {
    for (const side of ['left', 'right']) decal(middle, side, 0, 1, 0.3, 0.62, style.sideStripe);
  }
  const boot = frustum(
    { x0: -W, x1: W, y0: -front, y1: yB },
    { x0: -top, x1: top, y0: -front + 1, y1: yB },
    z0,
    [m.tailHeight, m.tailHeight, m.beltHeight, m.beltHeight],
    style.boot || style.body,
    1,
  );
  decal(boot, 'back', 0.05, 0.27, 0.4, 0.85, style.taillight, glowLights);
  decal(boot, 'back', 0.73, 0.95, 0.4, 0.85, style.taillight, glowLights);
  if (style.stripe) {
    for (const piece of [hood, middle, boot]) decal(piece, 'top', 0.41, 0.59, 0, 1, style.stripe);
  }
  parts.push(hood, middle, boot);

  // Cabin: glass all round (sloped windscreen and rear window), body-coloured pillars, flat roof.
  const cabin = hexa(
    [
      [-W + m.cabinInset, yB + 1, m.beltHeight],
      [W - m.cabinInset, yB + 1, m.beltHeight],
      [W - m.cabinInset, yF - 1, m.beltHeight],
      [-W + m.cabinInset, yF - 1, m.beltHeight],
    ],
    [
      [-W + m.roofInset, L * m.roofBack, roofZ],
      [W - m.roofInset, L * m.roofBack, roofZ],
      [W - m.roofInset, L * m.roofFront, roofZ],
      [-W + m.roofInset, L * m.roofFront, roofZ],
    ],
    { sides: style.glass, top: style.body },
    2,
  );
  decal(cabin, 'front', 0.12, 0.34, 0.15, 0.85, style.glassShine); // windscreen reflection
  decal(cabin, 'back', 0.66, 0.84, 0.2, 0.8, style.glassShine);
  for (const side of ['left', 'right']) {
    decal(cabin, side, 0.5, 0.58, 0, 1, style.body); // pillar between the side windows
    decal(cabin, side, 0, 1, 0, 0.1, style.body); // window sill line
  }
  if (style.stripe) decal(cabin, 'top', 0.41, 0.59, 0, 1, style.stripe);
  if (style.roofStripe) decal(cabin, 'top', 0, 1, 0.78, 1, style.roofStripe);
  parts.push(cabin);

  if (style.spoiler) {
    const z = m.tailHeight;
    for (const x of [-W + 7, W - 9]) parts.push(box(x, x + 2, -front + 2, -front + 4, z, z + 4, style.trim, 2));
    parts.push(box(-W + 2.5, W - 2.5, -hl + 1, -hl + 7, z + 4, z + 6, style.body, 2));
  }
  if (style.lightBar) {
    // Red half on the left, blue half on the right; CarView adds the flashing glow on top.
    const y = (L * (m.roofFront + m.roofBack)) / 2;
    const bar = box(-LIGHT_BAR.halfWidth, LIGHT_BAR.halfWidth, y - 3, y + 3, roofZ, roofZ + LIGHT_BAR.height, style.trim, 3);
    decal(bar, 'top', 0.04, 0.48, 0.1, 0.9, PALETTE.lightRed, true);
    decal(bar, 'top', 0.52, 0.96, 0.1, 0.9, PALETTE.lightBlue, true);
    for (const face of ['front', 'back']) {
      decal(bar, face, 0.04, 0.48, 0.15, 0.85, PALETTE.lightRed, true);
      decal(bar, face, 0.52, 0.96, 0.15, 0.85, PALETTE.lightBlue, true);
    }
    decal(bar, 'left', 0.1, 0.9, 0.15, 0.85, PALETTE.lightRed, true);
    decal(bar, 'right', 0.1, 0.9, 0.15, 0.85, PALETTE.lightBlue, true);
    parts.push(bar);
  }
  return parts;
}

// Light bar position, shared with CarView (the flashing glow is drawn over it).
export const LIGHT_BAR = {
  halfWidth: 12,
  height: 4,
  get centreY() {
    return (CAR_SIZE.length * (CAR_MODEL.roofFront + CAR_MODEL.roofBack)) / 2;
  },
  get topZ() {
    return CAR_MODEL.roofHeight + LIGHT_BAR.height;
  },
};

// The same model turned upside down, sitting on the road. The models are open underneath (nothing ever
// sees that side of a car on its wheels), so this adds the underside: painted after the body, before the
// wheels, which stick up past it.
function flipOver(parts) {
  const height = Math.max(...parts.flatMap((part) => part.verts.map((v) => v[2])));
  const top = Math.max(...parts.map((part) => part.layer));
  const flip = ([x, y, z]) => [x, y, height - z];
  const flipped = parts.map((part) => ({
    ...part,
    layer: top - part.layer,
    verts: part.verts.map(flip),
    faces: part.faces.map((face) => ({ ...face, decals: face.decals.map((d) => ({ ...d, pts: d.pts.map(flip) })) })),
  }));
  // Built right way up, because a solid here only has a top face: flipped, it would face the road.
  const z = height - CAR_MODEL.sillBottom;
  flipped.push(box(-CAR_MODEL.bodyHalfWidth, CAR_MODEL.bodyHalfWidth, -CAR_SIZE.length / 2, CAR_SIZE.length / 2, z, z + 2, PALETTE.chunkMetal, top - 0.5));
  return flipped;
}

const meshes = new Map();

export function carMesh(name) {
  if (!meshes.has(name)) meshes.set(name, name === 'wreckRoof' ? flipOver(buildCar(STYLES.wreck)) : buildCar(STYLES[name]));
  return meshes.get(name);
}

// Corner points used for the car's live ground shadow (everything except the wheels),
// without duplicates (fewer points = cheaper shadow every frame).
export function carShadowPoints(name) {
  const seen = new Set();
  const points = [];
  for (const part of carMesh(name)) {
    if (part.tag === 'wheel') continue;
    for (const p of part.verts) {
      const key = p.map((v) => Math.round(v * 2)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(p);
    }
  }
  return points;
}
