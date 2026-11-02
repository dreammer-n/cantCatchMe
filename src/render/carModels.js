import { CAR_MODEL, CAR_SIZE, PALETTE, BURNT } from '../config/tuning.js';
import { box, decal, frustum, hexa, roundWheel, shadeColor } from './lowpoly.js';
import { buildPlayerCar } from './playerCars.js';
import { LIGHT_BAR, POLICE_BUILDERS } from './policeModels.js';

export { BEARCAT_LIGHTS, LIGHT_BAR, ROTOR } from './policeModels.js';

// Which model goes with which name:
//   player  an older red coupe, kept for the tests
//   <car id>  any of the cars the player can drive (render/playerCars.js)
//   <car id>Body, <car id>Wheels  a player's car in two pieces, so the body can lean over its wheels. The lower
//     body and bumpers belong to the body: only the wheels are separate, or the car looks as if it comes apart
//   police, interceptor, bearcat, helicopter  render/policeModels.js
//   <any of these>Wreck  the same model burnt out: see burntOut

const STYLES = {
  player: {
    body: PALETTE.playerBody,
    stripe: PALETTE.playerStripe,
    glass: PALETTE.glass,
    glassShine: PALETTE.glassShine,
    trim: PALETTE.trim,
    hub: PALETTE.hub,
    tire: PALETTE.tire,
    headlight: PALETTE.headlight,
    taillight: PALETTE.taillight,
    spoiler: true,
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
      const wheel = roundWheel({ x0, x1, y, radius: m.wheelHeight / 2, color: style.tire, hub: style.hub, side });
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

// How far a colour has burnt at a point on the car: uneven, so patches of paint survive beside the black.
function burnShare(points) {
  const n = points.length;
  const x = points.reduce((sum, p) => sum + p[0], 0) / n;
  const y = points.reduce((sum, p) => sum + p[1], 0) / n;
  const z = points.reduce((sum, p) => sum + p[2], 0) / n;
  const patch = 0.5 + 0.5 * Math.sin(x * 0.19 + y * 0.07 + 1.3) * Math.sin(y * 0.11 - z * 0.13 + 0.4);
  return BURNT.burntMin + (BURNT.burntMax - BURNT.burntMin) * patch;
}

function burnt(color, points) {
  if (color === PALETTE.glass || color === PALETTE.glassShine) return PALETTE.soot;
  const share = burnShare(points);
  const mixTo = (shift) => {
    const from = (color >> shift) & 255;
    const to = (PALETTE.soot >> shift) & 255;
    return Math.round(from + (to - from) * share);
  };
  return (mixTo(16) << 16) | (mixTo(8) << 8) | mixTo(0);
}

// The same model after the fire: every point stays where it is, so the car keeps its shape. Only the colours
// change: paint scorched in patches, glass gone black, lamps out.
function burntOut(mesh) {
  return mesh.map((part) => ({
    ...part,
    faces: part.faces.map((face) => ({
      ...face,
      unlit: false,
      color: burnt(face.color, face.quad || face.v.map((i) => part.verts[i])),
      decals: face.decals.map((d) => ({ ...d, unlit: false, color: burnt(d.color, d.pts) })),
    })),
  }));
}

const meshes = new Map();

export function carMesh(name) {
  if (!meshes.has(name)) {
    const piece = name.match(/^(.+)(Body|Wheels)$/);
    if (name.endsWith('Wreck')) meshes.set(name, burntOut(carMesh(name.slice(0, -'Wreck'.length))));
    else if (piece) {
      const whole = piece[1] === 'player' ? buildCar(STYLES.player) : buildPlayerCar(piece[1]);
      meshes.set(name, whole.filter((part) => (part.tag === 'wheel') === (piece[2] === 'Wheels')));
    } else if (name in STYLES) meshes.set(name, buildCar(STYLES[name]));
    else if (name in POLICE_BUILDERS) meshes.set(name, POLICE_BUILDERS[name]());
    else meshes.set(name, buildPlayerCar(name));
  }
  return meshes.get(name);
}

// The colour of a car's paint (what most of its body faces are): flying panels are painted to match.
export function carPaint(name) {
  const counts = new Map();
  for (const part of carMesh(name)) {
    if (part.tag === 'wheel') continue;
    for (const { color } of part.faces) if (color !== PALETTE.glass) counts.set(color, (counts.get(color) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

// Corner points used for the car's live ground shadow (everything except the wheels),
// without duplicates (fewer points = cheaper shadow every frame).
export function carShadowPoints(name) {
  const seen = new Set();
  const points = [];
  for (const part of carMesh(name)) {
    if (part.noShadow || (part.tag === 'wheel' && !part.castsShadow)) continue;
    for (const p of part.shadowVerts || part.verts) {
      const key = p.map((v) => Math.round(v * 2)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(p);
    }
  }
  return points;
}
