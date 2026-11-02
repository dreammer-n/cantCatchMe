import { PALETTE } from '../config/tuning.js';
import { box, chunkyWheel, decal, loft, ngon, roundWheel, shadeColor, shell } from './lowpoly.js';

// The cars the player can drive (prices and handling are in CARS, tuning.js). All original low-poly
// models, built in code. Local x = right, y = forward, z = up. Parts tagged 'wheel' are drawn on their own
// sheet, so the body can lean over them. Every model stays within about x +-27 and y +-47: the car's size in
// play comes from its `scale`, which collisions use too. Bodies are shells with bevelled edges and cut
// corners, so they catch the light like pressed metal rather than looking like stacked boxes. The coupe, pickup,
// ram, rally and hypercar go further, with bodies built from slices: see pressedBody.

const WHITE = 0xf2f2ec;
const CHROME = 0xd6dae0;
const DARK = 0x24262c;
const ARCH = 0x0d0e11;

function wheelSet({ reach = 23.2, ys = [-27, 27], radius = 6.8, width = 4.5, hub = PALETTE.hub, castsShadow = false }) {
  const wheels = [];
  for (const side of [-1, 1]) {
    for (const y of ys) {
      const x0 = side < 0 ? -reach : reach - width;
      const wheel = roundWheel({ x0, x1: x0 + width, y, radius, color: PALETTE.tire, hub, side });
      wheel.tag = 'wheel';
      wheel.castsShadow = castsShadow;
      wheels.push(wheel);
    }
  }
  return wheels;
}

// A dark wheel well on a body side, so a wheel looks tucked under the bodywork.
function arches(part, ys, radius, z0) {
  for (const side of ['left', 'right']) {
    const face = part.faces.find((f) => f.name === side);
    const x = side === 'left' ? part.minX : part.maxX;
    for (const y of ys) {
      const pts = [];
      for (let i = 0; i <= 8; i += 1) {
        const a = (i * Math.PI) / 8;
        pts.push([x, y + radius * Math.cos(a), Math.max(z0, radius * 0.92 + radius * Math.sin(a) * 0.95)]);
      }
      face.decals.push({ pts, color: ARCH, unlit: false });
    }
  }
}

// Moves a part sideways, decals and all (a shell is built around x = 0).
function shiftX(part, dx) {
  const moved = new Set();
  const move = (p) => {
    if (moved.has(p)) return;
    moved.add(p);
    p[0] += dx;
  };
  part.verts.forEach(move);
  for (const face of part.faces) {
    if (face.quad) face.quad.forEach(move);
    for (const d of face.decals) d.pts.forEach(move);
  }
  part.minX += dx;
  part.maxX += dx;
  return part;
}

// A tank-style track down one side.
function track(side, length, height, width = 9, reach = 27) {
  const part = shell({ hw: width / 2, y0: -length, y1: length, z0: 0, z1: height, color: PALETTE.tire, cut: 4, bevel: 1.5 });
  for (const name of ['left', 'right']) {
    for (let i = 0; i < 5; i += 1) decal(part, name, 0.04 + i * 0.19, 0.17 + i * 0.19, 0.18, 0.72, PALETTE.hub);
  }
  for (let i = 0; i < 11; i += 2) decal(part, 'top', 0, 1, i / 11, (i + 1) / 11, shadeColor(PALETTE.tire, 1.9));
  shiftX(part, side * (reach - width / 2));
  part.tag = 'wheel';
  part.castsShadow = true;
  return part;
}

// A glass cabin: glass panes, body-coloured pillars at the corners and a bevelled roof.
function cab({ hw, y0, y1, z0, z1, lean = 3.5, leanF = 7, leanB = 4, roof, cut = 2.2, layer = 2, pillar = true }) {
  const roofZ = z1 - 1.8;
  const glass = shell({ hw, y0, y1, z0, z1: roofZ, color: roof, cut, bevel: 0, lean, leanF, leanB, layer });
  for (const face of glass.faces) if (['front', 'back', 'left', 'right'].includes(face.name)) face.color = PALETTE.glass;
  decal(glass, 'front', 0.1, 0.3, 0.1, 0.88, PALETTE.glassShine);
  decal(glass, 'front', 0.36, 0.42, 0.1, 0.88, PALETTE.glassShine);
  decal(glass, 'back', 0.68, 0.86, 0.15, 0.82, PALETTE.glassShine);
  if (pillar) for (const side of ['left', 'right']) decal(glass, side, 0.47, 0.53, 0, 1, roof);
  const slab = shell({ hw: hw - lean + 0.5, y0: y0 + leanB - 0.5, y1: y1 - leanF + 0.5, z0: roofZ, z1, color: roof, cut, bevel: 1, layer: layer + 1 });
  return [glass, slab];
}

function headlights(part, face = 'front', v0 = 0.3, v1 = 0.8) {
  decal(part, face, 0.04, 0.25, v0, v1, PALETTE.headlight, true);
  decal(part, face, 0.75, 0.96, v0, v1, PALETTE.headlight, true);
  return part;
}

function taillights(part, v0 = 0.4, v1 = 0.8) {
  decal(part, 'back', 0.04, 0.26, v0, v1, PALETTE.taillight, true);
  decal(part, 'back', 0.74, 0.96, v0, v1, PALETTE.taillight, true);
  return part;
}

function grille(part, v0 = 0.25, v1 = 0.75, color = DARK) {
  decal(part, 'front', 0.31, 0.69, v0, v1, color);
  return part;
}

function sideWindows(part, windows, v0, v1) {
  for (const [u0, u1] of windows) {
    decal(part, 'left', u0, u1, v0, v1, PALETTE.glass);
    decal(part, 'right', 1 - u1, 1 - u0, v0, v1, PALETTE.glass); // left faces run front to back, right the other way
  }
  return part;
}

// A door line and handle, in shadow on the body side.
function doors(part, u, color) {
  const seam = shadeColor(color, 0.68);
  for (const side of ['left', 'right']) {
    const at = side === 'left' ? u : 1 - u;
    decal(part, side, at - 0.012, at + 0.012, 0.05, 0.9, seam);
    decal(part, side, at + (side === 'left' ? 0.03 : -0.08), at + (side === 'left' ? 0.08 : -0.03), 0.62, 0.72, seam);
  }
  return part;
}

const bumper = (hw, y0, y1, color, z0 = 5, z1 = 10) => shell({ hw, y0, y1, z0, z1, color, cut: 1.5, bevel: 0.8 });

// (Also used for parked cars: render/propModels.js.)
// A sedan-like car: hood, middle and boot in one line, a glass cabin, wheel wells, bumpers and mirrors.
export function sedan({
  body,
  hoodColor = body,
  bootColor = body,
  roof = body,
  trim = PALETTE.trim,
  stripe = null,
  sideStripe = null,
  L = 84,
  W = 22,
  belt = 17,
  nose = 13.5,
  tail = 15.5,
  cabinF = 0.1,
  cabinB = -0.3,
  roofF = -0.01,
  roofB = -0.22,
  roofZ = 29,
  wheelY = 0.32,
  radius = 6.8,
  width = 4.5,
  doorAt = 0.5,
}) {
  const hl = L / 2;
  const yF = L * cabinF;
  const yB = L * cabinB;
  const axle = L * wheelY;
  const sill = shell({ hw: W - 2.5, y0: -hl + 3, y1: hl - 3, z0: 4, z1: 9, color: shadeColor(body, 0.5), cut: 2, bevel: 0, layer: -1 });
  const hood = shell({ hw: W, y0: yF, y1: hl - 2, z0: 8, z1: [belt, nose], color: hoodColor, cutB: 0, cutF: 4.5, bevel: 1.6, bevelB: 0, leanF: 0.8 });
  const middle = shell({ hw: W, y0: yB, y1: yF, z0: 8, z1: belt, color: body, cut: 0, bevel: 1.6, bevelF: 0, bevelB: 0 });
  const boot = shell({ hw: W, y0: -hl + 2, y1: yB, z0: 8, z1: [tail, belt], color: bootColor, cutB: 3.5, cutF: 0, bevel: 1.6, bevelF: 0, leanB: 0.8 });
  arches(hood, [axle], radius + 1.6, 8);
  arches(boot, [-axle], radius + 1.6, 8);
  headlights(hood);
  grille(hood);
  taillights(boot);
  decal(boot, 'back', 0.34, 0.66, 0.45, 0.72, DARK);
  doors(middle, doorAt, body);
  if (sideStripe) for (const part of [hood, middle, boot]) for (const side of ['left', 'right']) decal(part, side, 0, 1, 0.5, 0.72, sideStripe);
  if (stripe) {
    for (const part of [hood, middle, boot]) {
      decal(part, 'top', 0.32, 0.45, 0, 1, stripe);
      decal(part, 'top', 0.55, 0.68, 0, 1, stripe);
    }
  }
  const cabin = cab({ hw: W - 2.3, y0: yB + 1, y1: yF - 1, z0: belt, z1: roofZ, lean: 3.6, leanF: yF - 1 - L * roofF, leanB: L * roofB - yB - 1, roof });
  if (stripe) {
    decal(cabin[1], 'top', 0.32, 0.45, 0, 1, stripe);
    decal(cabin[1], 'top', 0.55, 0.68, 0, 1, stripe);
  }
  const mirrors = [-1, 1].map((s) => box(s * (W + 0.2) - 1.3, s * (W + 0.2) + 1.3, yF - 4, yF - 1, belt - 0.5, belt + 2, body, 2));
  return [
    ...wheelSet({ ys: [-axle, axle], radius, width }),
    sill,
    hood,
    middle,
    boot,
    bumper(W - 0.5, hl - 2.5, hl + 0.5, trim),
    bumper(W - 0.5, -hl - 0.5, -hl + 2.5, trim),
    ...cabin,
    ...mirrors,
  ];
}

// ---- The pressed-body cars ----
// In play the body sheet is drawn over the wheel sheet, so a wheel only shows through a real opening in the
// body. These cars have them: the body rises over each wheel, and the wheels and a dark floor under them are
// drawn first, here and in the garage alike.

const RIM = 0xbcc2ca;
const RIM_CENTRE = 0x3c4048;
const LIP = 0x14161a;
const LENS = 0x858b94;
const LENS_GLINT = 0xbcc1c7;
const ARCH_ROOM = 1.5; // from the tire to the arch
const LIP_HEIGHT = 1.6;
const WHEEL_LAYER = -3;

const mix = (a, b, t) => a + (b - a) * t;

// A small part that doesn't change the car's shadow (which is worked out every frame).
function detail(part) {
  part.noShadow = true;
  return part;
}

// outline: [y, shoulder height, top height, share of the width], back to front. A station is added wherever the
// body has to rise over a wheel, and the shoulder rises with it, which is what shapes the fenders.
function pressedBody({ outline, axles, radius, W, flare = 0.8, sill = 6, crown = 0.3, color, panel = () => color }) {
  const R = radius + ARCH_ROOM;
  const reach = R + 1.2;
  const shoulderOf = 0.7 * R;
  const ys = new Set(outline.map((p) => p[0]));
  for (const axle of axles) for (const d of [-reach, -shoulderOf, 0, shoulderOf, reach]) ys.add(axle + d);
  const at = (y) => {
    const i = Math.max(0, outline.findIndex((p) => p[0] >= y) - 1);
    const [a, b] = [outline[i], outline[i + 1]];
    const t = (y - a[0]) / (b[0] - a[0]);
    return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)];
  };
  const stations = [...ys].sort((a, b) => a - b).map((y) => {
    const [shoulder, top, share] = at(y);
    const d = Math.min(...axles.map((axle) => Math.abs(y - axle)));
    let edge = sill;
    let bulge = 0;
    if (d < reach) {
      const rise = Math.min(1, (reach - d) / (reach - shoulderOf));
      edge = d > shoulderOf ? mix(sill, radius + 0.72 * R, rise) : mix(radius + 0.72 * R, radius + R, (shoulderOf - d) / shoulderOf);
      bulge = flare * rise;
    }
    const x = W * share;
    const lip = edge + LIP_HEIGHT;
    const high = Math.max(shoulder, lip + 0.6);
    return { y, half: [[x + bulge - 0.5, edge], [x + bulge, lip], [x, high], [x - 1.2, Math.max(top, high + 1)], [x * 0.72, top + crown]] };
  });
  const body = loft({ stations, paint: (band, y) => (band === 0 ? LIP : panel(band, y)) });
  const outer = new Set(outline.map((p) => p[0]));
  body.shadowVerts = stations.flatMap((s, i) => (outer.has(s.y) ? [body.verts[i * 10 + 2], body.verts[i * 10 + 3], body.verts[i * 10 + 7], body.verts[i * 10 + 6]] : []));
  return body;
}

// Paints across a body's top, u across it (0 = left) and y0..y1 along it.
function topMark(body, u0, u1, y0, y1, color, unlit = false) {
  body.stations.forEach((a, s) => {
    const b = body.stations[s + 1];
    if (!b || b.y <= y0 || a.y >= y1) return;
    decal(body, `top:${s}`, u0, u1, (Math.max(y0, a.y) - a.y) / (b.y - a.y), (Math.min(y1, b.y) - a.y) / (b.y - a.y), color, unlit);
    body.faces.find((f) => f.name === `top:${s}`).decals.at(-1).joined = true;
  });
}

// Paints on both side panels at real heights, so that a line stays straight where the panel dips over a wheel.
function sideMark(body, y0, y1, z0, z1, color, unlit = false) {
  const on = (station, z) => {
    const [low, high] = [station.half[1], station.half[2]];
    const t = Math.max(0, Math.min(1, (z - low[1]) / (high[1] - low[1] || 1)));
    return [mix(low[0], high[0], t), Math.max(low[1], Math.min(high[1], z))];
  };
  const along = (a, b, y) => {
    const t = (y - a.y) / (b.y - a.y);
    return { y, half: [1, 2].map((i) => [mix(a.half[i][0], b.half[i][0], t), mix(a.half[i][1], b.half[i][1], t)]) };
  };
  body.stations.forEach((a, s) => {
    const b = body.stations[s + 1];
    if (!b || b.y <= y0 || a.y >= y1) return;
    const ends = [Math.max(y0, a.y), Math.min(y1, b.y)].map((y) => {
      const { half } = along(a, b, y);
      return { y, half: [null, half[0], half[1]] };
    });
    for (const [name, sign] of [[`right1:${s}`, 1], [`left1:${s}`, -1]]) {
      const point = (end, z) => {
        const [x, height] = on(end, z);
        return [sign * x, end.y, height];
      };
      body.faces.find((f) => f.name === name).decals.push({ pts: [point(ends[0], z0), point(ends[1], z0), point(ends[1], z1), point(ends[0], z1)], color, unlit, joined: true });
    }
  });
}

// A door line and handle.
function doorLine(body, y, sill, shoulder, color) {
  sideMark(body, y - 0.3, y + 0.3, sill + 1, shoulder - 0.4, shadeColor(color, 0.62));
  sideMark(body, y - 5, y - 2, shoulder - 3.2, shoulder - 2.3, shadeColor(color, 0.5));
}

// Four wheels (the axles run along x), and the dark floor seen through the arches.
function wheelsAndFloor({ axles, radius, width, reach, hw, length, floor }) {
  const parts = [];
  for (const side of [-1, 1]) {
    for (const y of axles) {
      const x0 = side < 0 ? -reach : reach - width;
      const wheel = chunkyWheel({ x0, x1: x0 + width, y, radius, color: PALETTE.tire, rim: RIM, hub: RIM_CENTRE, side, layer: WHEEL_LAYER });
      wheel.tag = 'wheel';
      parts.push(wheel);
    }
  }
  const pan = box(-hw, hw, -length, length, 0, floor, LIP, WHEEL_LAYER - 1);
  pan.tag = 'wheel';
  return [pan, ...parts];
}

// The cabin: body-coloured pillars and frames around panes of glass, and a roof on top. panes: [u0, u1] along
// the side, 0 at the front. roofY0, roofY1: where the top of the cabin ends, so the glass slopes.
function greenhouse({ hw, y0, y1, roofY0, roofY1, z0, z1, frame, roof = frame, panes, lean = 3, layer = 2 }) {
  const roofZ = z1 - 1.6;
  const cabin = shell({ hw, y0, y1, z0, z1: roofZ, color: frame, cut: 2, bevel: 0, lean, leanF: y1 - roofY1, leanB: roofY0 - y0, layer });
  decal(cabin, 'front', 0.05, 0.95, 0.07, 0.93, PALETTE.glass);
  decal(cabin, 'front', 0.14, 0.3, 0.14, 0.86, PALETTE.glassShine);
  decal(cabin, 'front', 0.35, 0.41, 0.14, 0.86, PALETTE.glassShine);
  decal(cabin, 'back', 0.08, 0.92, 0.1, 0.88, PALETTE.glass);
  decal(cabin, 'back', 0.62, 0.78, 0.16, 0.82, PALETTE.glassShine);
  for (const [u0, u1] of panes) {
    decal(cabin, 'left', u0, u1, 0.13, 0.9, PALETTE.glass);
    decal(cabin, 'right', 1 - u1, 1 - u0, 0.13, 0.9, PALETTE.glass);
    const shine = u0 + (u1 - u0) * 0.2;
    decal(cabin, 'left', shine, shine + (u1 - u0) * 0.14, 0.2, 0.84, PALETTE.glassShine);
    decal(cabin, 'right', 1 - shine - (u1 - u0) * 0.14, 1 - shine, 0.2, 0.84, PALETTE.glassShine);
  }
  const slab = shell({ hw: hw - lean + 0.4, y0: roofY0 - 0.4, y1: roofY1 + 0.4, z0: roofZ, z1, color: roof, cut: 2, bevel: 0.9, layer: layer + 1 });
  return [cabin, slab];
}

const mirrors = (x, y, z, color) => [-1, 1].map((s) => detail(box(s * x - 1.5, s * x + 1.5, y - 1.4, y + 1.4, z, z + 2.2, color, 2)));

// A wing on two struts.
function wing({ hw, y0, y1, z, strutX, strutZ, color, strutColor = color, thick = 2.4 }) {
  const struts = [-1, 1].map((s) => box(s * strutX - 1, s * strutX + 1, y0 + 2.5, y0 + 6, strutZ, z + 0.2, strutColor, 2));
  return [...struts, shell({ hw, y0, y1, z0: z, z1: z + thick, color, cut: 1.2, bevel: 0.7, layer: 3 })];
}

const BUILDERS = {
  // The default: a red coupe with cream racing stripes and a low spoiler. Long hood, cabin set back.
  coupe: () => {
    const c = PALETTE.playerBody;
    const axles = [-27, 27];
    const body = pressedBody({
      axles, radius: 8, W: 22, color: c,
      outline: [[-43, 13, 14.5, 0.88], [-37, 16, 18.5, 0.97], [-14, 16.5, 19.5, 1], [14, 16.5, 19.2, 1], [36, 14.5, 16.8, 0.97], [43, 10.5, 13.5, 0.87]],
    });
    taillights(body, 0.45, 0.85);
    decal(body, 'back', 0.34, 0.66, 0.5, 0.82, DARK);
    headlights(body, 'front', 0.48, 0.95);
    grille(body, 0.35, 0.8);
    for (const [u0, u1] of [[0.24, 0.42], [0.58, 0.76]]) topMark(body, u0, u1, -43, 43, PALETTE.playerStripe);
    doorLine(body, -5, 6, 16.5, c);
    const [cabin, roof] = greenhouse({ hw: 19.5, y0: -25, y1: 14, roofY0: -19, roofY1: -1, z0: 19, z1: 30.5, frame: c, panes: [[0.3, 0.62], [0.66, 0.9]], lean: 3.6 });
    for (const [u0, u1] of [[0.24, 0.42], [0.58, 0.76]]) decal(roof, 'top', u0, u1, 0, 1, PALETTE.playerStripe);
    return [
      ...wheelsAndFloor({ axles, radius: 8, width: 6.5, reach: 22.6, hw: 19, length: 38, floor: 16 }),
      body,
      shell({ hw: 21, y0: 41.5, y1: 45, z0: 4.5, z1: 8.5, color: PALETTE.trim, cut: 1.5, bevel: 0.8 }),
      shell({ hw: 21, y0: -45, y1: -41.5, z0: 4.5, z1: 8.5, color: PALETTE.trim, cut: 1.5, bevel: 0.8 }),
      cabin,
      roof,
      ...mirrors(19.6, 11, 19, c),
      ...wing({ hw: 19, y0: -44, y1: -37, z: 20.5, strutX: 13, strutZ: 14, color: c, strutColor: PALETTE.trim }),
    ];
  },

  // Short and upright, its cabin pushed right back.
  hatchback: () =>
    sedan({ body: 0xf4c20d, L: 72, W: 21, belt: 18, nose: 14, tail: 17.5, cabinF: 0.1, cabinB: -0.44, roofF: -0.04, roofB: -0.4, roofZ: 31, wheelY: 0.31, doorAt: 0.42 }),

  // A little three-wheeler: one wheel in front, a black canopy on posts.
  tuktuk: () => {
    const body = 0xf6c518;
    const front = roundWheel({ x0: -2.5, x1: 2.5, y: 32, radius: 7, color: PALETTE.tire, hub: PALETTE.hub, side: 1 });
    front.tag = 'wheel';
    const nose = shell({ hw: 9, y0: 8, y1: 35, z0: 7, z1: [21, 14], color: body, cut: 3, cutB: 0, bevel: 1.5, bevelB: 0, lean: 1 });
    decal(nose, 'front', 0.28, 0.72, 0.35, 0.85, PALETTE.headlight, true);
    const tub = shell({ hw: 19, y0: -36, y1: 10, z0: 7, z1: 21, color: body, cut: 4, bevel: 1.5 });
    taillights(tub);
    decal(tub, 'back', 0.3, 0.7, 0.45, 0.72, DARK);
    const floor = shell({ hw: 14, y0: -28, y1: 8, z0: 21, z1: 22, color: 0x3a2a1c, cut: 2, bevel: 0, layer: 2 });
    const posts = [[-17, 8], [17, 8], [-17, -32], [17, -32]].map(([x, py]) => box(x - 1, x + 1, py - 1, py + 1, 20, 40, DARK, 2));
    const screen = shell({ hw: 14, y0: 7, y1: 10, z0: 21, z1: 37, color: PALETTE.glass, cut: 0, bevel: 0, leanF: 1, layer: 2 });
    decal(screen, 'front', 0.1, 0.3, 0.1, 0.9, PALETTE.glassShine);
    const canopy = shell({ hw: 21, y0: -38, y1: 13, z0: 39, z1: 45, color: 0x17181c, cut: 5, bevel: 2.5, layer: 3 });
    return [...wheelSet({ ys: [-22], reach: 24, radius: 7.5 }), front, nose, tub, floor, ...posts, screen, canopy];
  },

  // A long, plain delivery van.
  van: () => {
    const c = 0x2465d6;
    const sill = shell({ hw: 19, y0: -38, y1: 38, z0: 4, z1: 9, color: shadeColor(c, 0.5), cut: 2, bevel: 0, layer: -1 });
    const hood = shell({ hw: 21, y0: 24, y1: 40, z0: 8, z1: [20, 15.5], color: c, cutB: 0, cutF: 4, bevel: 1.5, bevelB: 0 });
    headlights(hood);
    grille(hood);
    const body = shell({ hw: 21, y0: -40, y1: 27, z0: 8, z1: 40, color: c, cut: 3, cutF: 0, bevel: 2.5, lean: 1.5, leanF: 13 });
    decal(body, 'front', 0.05, 0.95, 0.42, 0.92, PALETTE.glass);
    decal(body, 'front', 0.12, 0.3, 0.46, 0.88, PALETTE.glassShine);
    sideWindows(body, [[0.03, 0.27]], 0.52, 0.86);
    for (const side of ['left', 'right']) decal(body, side, 0.3, 0.97, 0.3, 0.33, shadeColor(c, 0.65));
    taillights(body, 0.2, 0.48);
    decal(body, 'back', 0.14, 0.86, 0.58, 0.88, PALETTE.glass);
    arches(hood, [28], 8.4, 8);
    arches(body, [-27], 8.4, 8);
    return [...wheelSet({ ys: [-27, 28] }), sill, hood, body, bumper(21, 39, 42, PALETTE.trim), bumper(21, -42, -39, PALETTE.trim)];
  },

  // A classic pickup in turquoise with a cream roof: long hood, upright cab and a real open bed, its floor
  // the top of the body and its walls standing round it.
  pickup: () => {
    const c = 0x12b8a8;
    const axles = [-26, 27];
    const bedFloor = shadeColor(c, 0.42);
    const body = pressedBody({
      axles, radius: 8.8, W: 21.5, color: c,
      outline: [[-41, 15, 17.5, 0.98], [-14, 15.5, 17.5, 1], [-13, 19, 23, 1], [10, 19, 23, 1], [33, 18, 21.5, 0.99], [42, 13, 16, 0.91]],
      panel: (band, y) => (band >= 3 && y < -13.5 ? bedFloor : c),
    });
    headlights(body, 'front', 0.42, 0.92);
    grille(body, 0.35, 0.86);
    for (let i = 0; i < 4; i += 1) topMark(body, 0.14 + i * 0.2, 0.18 + i * 0.2, -40, -14, shadeColor(bedFloor, 0.72));
    doorLine(body, -10, 6, 19, c);
    const wall = (x) => shiftX(shell({ hw: 1.2, y0: -41.5, y1: -13, z0: 15, z1: 26.5, color: c, cut: 0.4, bevel: 0.4, layer: 1 }), x);
    const tailgate = detail(shell({ hw: 20.3, y0: -41.5, y1: -39.3, z0: 8, z1: 26.5, color: c, cut: 0.4, bevel: 0.4, layer: 1 }));
    taillights(tailgate, 0.45, 0.8);
    decal(tailgate, 'back', 0.34, 0.66, 0.62, 0.8, shadeColor(c, 0.62));
    const front = detail(shell({ hw: 20.3, y0: -15, y1: -13, z0: 15, z1: 26.5, color: c, cut: 0.2, bevel: 0.4, layer: 1 }));
    const [cabin, roof] = greenhouse({ hw: 20, y0: -13.5, y1: 10, roofY0: -12, roofY1: 2.5, z0: 22.5, z1: 37.5, frame: c, roof: 0xf2ead4, panes: [[0.3, 0.86]], lean: 2.4 });
    return [
      ...wheelsAndFloor({ axles, radius: 8.8, width: 7, reach: 22, hw: 18.5, length: 37, floor: 17 }),
      body,
      wall(-20.3),
      wall(20.3),
      tailgate,
      front,
      cabin,
      roof,
      ...mirrors(20.6, 8, 23, c),
      shell({ hw: 21, y0: 41, y1: 45, z0: 4, z1: 10, color: CHROME, cut: 1.5, bevel: 0.8 }),
      shell({ hw: 21, y0: -45, y1: -41.5, z0: 5, z1: 9.5, color: CHROME, cut: 1.2, bevel: 0.8 }),
    ];
  },

  // A sleek pursuit cruiser, long and low: what a police car would be if it had a real budget.
  highway: () => {
    const parts = sedan({ body: 0x253a63, sideStripe: CHROME, belt: 16, nose: 12, tail: 15, cabinF: 0.08, cabinB: -0.3, roofF: -0.04, roofB: -0.22, roofZ: 26.5, width: 5 });
    for (const x of [-15, 12]) parts.push(box(x, x + 3, 42, 45, 5, 13, DARK, 1));
    parts.push(box(-15, 15, 43, 45, 10, 13, DARK, 1));
    return parts;
  },

  muscle: () => {
    const parts = sedan({ body: 0x1c63e0, stripe: WHITE, roofZ: 27, nose: 14.5, cabinF: -0.02, cabinB: -0.34, roofF: -0.11, roofB: -0.28, radius: 7.2, width: 5.2 });
    parts.push(shell({ hw: 6.5, y0: 6, y1: 24, z0: 15, z1: 19, color: 0x14171c, cut: 1.5, bevel: 1, lean: 1, layer: 2 }));
    return parts;
  },

  // The heavy one: tall and square on chunky wheels, an orange stripe down its side, a roof rack and a great
  // slotted orange ram on the front.
  ram: () => {
    const c = 0x5a5f67;
    const orange = 0xff7a1a;
    const axles = [-27, 24];
    const radius = 10;
    const body = pressedBody({
      axles, radius, W: 21, flare: 1.4, sill: 8, color: c,
      outline: [[-41, 23, 26, 0.95], [-37, 26, 29, 1], [14, 26, 29, 1], [32, 25, 28, 0.98], [37, 21, 27.5, 0.93]],
    });
    sideMark(body, -41, 37, 23.2, 26, orange);
    taillights(body, 0.5, 0.82);
    decal(body, 'back', 0.34, 0.66, 0.52, 0.8, DARK);
    headlights(body, 'front', 0.68, 0.95);
    doorLine(body, -7, 8, 23.5, c);
    const scoop = detail(shell({ hw: 5.5, y0: 18, y1: 28, z0: 28, z1: 30, color: DARK, cut: 1.2, bevel: 0.7, lean: 0.8, layer: 1 }));
    const [cabin, roof] = greenhouse({ hw: 20.2, y0: -40, y1: 14, roofY0: -38.5, roofY1: 4, z0: 28.5, z1: 42.5, frame: c, panes: [[0.2, 0.42], [0.46, 0.68], [0.72, 0.94]], lean: 2.5 });
    const plate = shell({ hw: 26, y0: 37, y1: 45, z0: 3, z1: 21, color: orange, cut: 2, bevel: 1.5, leanF: 1 });
    for (let i = 0; i < 5; i += 1) decal(plate, 'front', 0.1 + i * 0.17, 0.17 + i * 0.17, 0.12, 0.84, DARK);
    const rails = [-14, 14].map((x) => detail(box(x - 1, x + 1, -36, 2, 42.5, 44.7, DARK, 4)));
    const slats = [-30, -20, -10, 0].map((y) => detail(box(-14, 14, y - 0.8, y + 0.8, 43.3, 44.5, DARK, 4)));
    const pack = detail(shell({ hw: 9, y0: -28, y1: -11, z0: 44.5, z1: 48, color: 0x2c2f35, cut: 1.5, bevel: 1, layer: 5 }));
    return [
      ...wheelsAndFloor({ axles, radius, width: 8, reach: 22.4, hw: 18.5, length: 36, floor: 20 }),
      body,
      scoop,
      cabin,
      roof,
      plate,
      ...mirrors(20.6, 11, 29, DARK),
      ...rails,
      ...slats,
      pack,
      shell({ hw: 21, y0: -44, y1: -41, z0: 7, z1: 13, color: DARK, cut: 1.2, bevel: 0.8 }),
    ];
  },

  // A two-tone camper bus with a V on its nose and windows all round.
  bus: () => {
    const green = 0x1f9d57;
    const cream = 0xf3ecd2;
    const sill = shell({ hw: 19, y0: -38, y1: 38, z0: 4, z1: 9, color: shadeColor(green, 0.5), cut: 2, bevel: 0, layer: -1 });
    const lower = shell({ hw: 21, y0: -41, y1: 41, z0: 8, z1: 21, color: green, cut: 6, cutB: 4, bevel: 0 });
    headlights(lower, 'front', 0.35, 0.8);
    taillights(lower);
    decal(lower, 'front', 0.34, 0.66, 0.55, 1, cream);
    arches(lower, [-27, 27], 8.4, 8);
    const upper = shell({ hw: 21, y0: -41, y1: 41, z0: 21, z1: 40, color: cream, cut: 6, cutB: 4, bevel: 3, lean: 2, leanF: 13, leanB: 3, layer: 1 });
    decal(upper, 'front', 0.04, 0.96, 0.2, 0.86, PALETTE.glass);
    decal(upper, 'front', 0.1, 0.28, 0.24, 0.82, PALETTE.glassShine);
    decal(upper, 'back', 0.12, 0.88, 0.25, 0.8, PALETTE.glass);
    sideWindows(upper, [[0.03, 0.27], [0.32, 0.56], [0.61, 0.85]], 0.28, 0.82);
    return [...wheelSet({ ys: [-27, 27] }), sill, lower, upper, bumper(21, 40, 43, CHROME), bumper(21, -43, -40, CHROME)];
  },

  // Tall and rugged, with a roof rack and a bar across its nose.
  suv: () => {
    const c = 0x2f9e44;
    const sill = shell({ hw: 19, y0: -37, y1: 38, z0: 6, z1: 11, color: shadeColor(c, 0.5), cut: 2, bevel: 0, layer: -1 });
    const hood = shell({ hw: 21.5, y0: 8, y1: 39, z0: 10, z1: [25, 21], color: c, cutB: 0, cutF: 3.5, bevel: 1.8, bevelB: 0 });
    headlights(hood);
    grille(hood, 0.2, 0.8);
    const rear = shell({ hw: 21.5, y0: -40, y1: 8, z0: 10, z1: 25, color: c, cutB: 3, cutF: 0, bevel: 1, bevelF: 0 });
    doors(rear, 0.42, c);
    taillights(rear);
    arches(hood, [26], 10, 10);
    arches(rear, [-26], 10, 10);
    const [glass, roof] = cab({ hw: 20, y0: -39, y1: 8, z0: 25, z1: 41, lean: 2.5, leanF: 5, leanB: 1, roof: c });
    const rails = [-15, 15].map((x) => box(x - 1, x + 1, -34, 2, 41, 44, DARK, 4));
    const slats = [-28, -18, -8].map((y) => box(-15, 15, y - 1, y + 1, 42, 44, DARK, 4));
    const bar = shell({ hw: 24, y0: 39, y1: 44, z0: 6, z1: 14, color: DARK, cut: 2, bevel: 1 });
    return [...wheelSet({ ys: [-26, 26], radius: 8.5, width: 6, reach: 25 }), sill, hood, rear, glass, roof, ...rails, ...slats, bar];
  },

  // A two-tone cruiser from another age: chrome bumpers and rear fins.
  tailfin: () => {
    const c = 0x1fb6b8;
    const parts = sedan({ body: c, roof: 0xf4efdc, trim: CHROME, sideStripe: CHROME, roofZ: 28, nose: 12.5, tail: 15, cabinF: 0.06, cabinB: -0.28, roofF: -0.05, roofB: -0.23 });
    for (const side of [-1, 1]) {
      parts.push(shiftX(shell({ hw: 2.2, y0: -41, y1: -16, z0: 14, z1: [25, 16], color: c, cut: 0.8, bevel: 0.8, layer: 2 }), side * 19.8));
    }
    return parts;
  },

  // Long, black and in no hurry: a cabin that runs almost to the tail.
  hearse: () =>
    sedan({ body: 0x1a1b20, trim: CHROME, sideStripe: CHROME, L: 90, nose: 13, belt: 16, tail: 16, cabinF: 0.14, cabinB: -0.46, roofF: 0.05, roofB: -0.44, roofZ: 33, wheelY: 0.33 }),

  // Wide arches, white stripes from nose to tail, a hood scoop and a big black wing on struts.
  rally: () => {
    const c = 0x1a6fe8;
    const axles = [-27, 27];
    const radius = 8.4;
    const body = pressedBody({
      axles, radius, W: 22, flare: 1.6, color: c,
      outline: [[-43, 14.5, 16.5, 0.92], [-37, 17, 20, 1], [-15, 17.5, 20.5, 1], [12, 17.2, 20, 1], [36, 15.5, 18, 0.98], [43, 11, 14.5, 0.9]],
    });
    const stripes = [[0.22, 0.43], [0.57, 0.78]];
    for (const [u0, u1] of stripes) topMark(body, u0, u1, -43, 43, WHITE);
    taillights(body, 0.45, 0.85);
    decal(body, 'back', 0.34, 0.66, 0.5, 0.82, DARK);
    headlights(body, 'front', 0.5, 0.95);
    grille(body, 0.35, 0.82);
    doorLine(body, -6, 6, 17.5, c);
    const scoop = detail(shell({ hw: 5.5, y0: 18, y1: 30, z0: 19, z1: 22, color: shadeColor(c, 0.62), cut: 1.2, bevel: 0.9, lean: 0.8, leanF: 2, layer: 1 }));
    decal(scoop, 'front', 0.14, 0.86, 0.2, 0.8, DARK);
    const [cabin, roof] = greenhouse({ hw: 19.5, y0: -26, y1: 12, roofY0: -20, roofY1: -2, z0: 20, z1: 31, frame: c, panes: [[0.3, 0.62], [0.66, 0.9]], lean: 3.4 });
    for (const [u0, u1] of stripes) decal(roof, 'top', u0, u1, 0, 1, WHITE);
    return [
      ...wheelsAndFloor({ axles, radius, width: 7, reach: 23.4, hw: 19, length: 38, floor: 17 }),
      body,
      scoop,
      cabin,
      roof,
      ...mirrors(19.8, 9, 20, c),
      ...wing({ hw: 25, y0: -46, y1: -35, z: 32, strutX: 15, strutZ: 15, color: DARK }),
      shell({ hw: 22, y0: 41.5, y1: 46, z0: 3.5, z1: 8.5, color: DARK, cut: 1.5, bevel: 0.8 }),
      shell({ hw: 21.5, y0: -46, y1: -42, z0: 4, z1: 9, color: DARK, cut: 1.5, bevel: 0.8 }),
    ];
  },

  // A truck cab with a house on its back: the bed hangs out over the cab.
  camper: () => {
    const cream = 0xf1e8d6;
    const sill = shell({ hw: 19, y0: -38, y1: 38, z0: 4, z1: 9, color: 0x6e685b, cut: 2, bevel: 0, layer: -1 });
    const hood = shell({ hw: 20.5, y0: 18, y1: 40, z0: 8, z1: [21, 16], color: WHITE, cutB: 0, cutF: 4, bevel: 1.8, bevelB: 0 });
    headlights(hood);
    grille(hood);
    arches(hood, [27], 8.4, 8);
    const under = shell({ hw: 20.5, y0: 2, y1: 18, z0: 8, z1: 21, color: WHITE, cut: 0, bevel: 0 });
    const [glass, slab] = cab({ hw: 19, y0: 2, y1: 18, z0: 21, z1: 33, roof: WHITE, lean: 1.5, leanF: 4, leanB: 0, pillar: false });
    const house = shell({ hw: 23, y0: -41, y1: 2, z0: 10, z1: 46, color: cream, cut: 3, cutF: 0, bevel: 2.5, bevelF: 0, layer: 2 });
    decal(house, 'back', 0.2, 0.8, 0.48, 0.82, PALETTE.glass);
    sideWindows(house, [[0.08, 0.38], [0.6, 0.85]], 0.56, 0.8);
    for (const side of ['left', 'right']) decal(house, side, 0, 1, 0.3, 0.4, 0xc95f3b);
    taillights(house, 0.06, 0.2);
    const overhang = shell({ hw: 23, y0: 2, y1: 25, z0: 33, z1: 46, color: cream, cut: 5, cutB: 0, bevel: 2.5, bevelB: 0, leanF: 7, layer: 3 });
    decal(overhang, 'front', 0.1, 0.9, 0.2, 0.7, PALETTE.glass);
    const vent = shell({ hw: 7, y0: -26, y1: -12, z0: 46, z1: 49, color: 0xb7b0a0, cut: 1.5, bevel: 1, layer: 3 });
    return [...wheelSet({ ys: [-24, 27] }), sill, hood, under, glass, slab, house, overhang, vent, bumper(20.5, 39, 42, PALETTE.trim)];
  },

  // A low orange wedge: a nose that nearly touches the road, wide black-edged arches, lights set into the hood,
  // vents and a wing in its own colour.
  hypercar: () => {
    const c = 0xff7a12;
    const axles = [-27, 26];
    const radius = 8;
    const body = pressedBody({
      axles, radius, W: 22.5, flare: 1.2, sill: 4.5, crown: 0, color: c,
      outline: [[-43, 13.5, 15, 0.9], [-36, 16, 18.5, 0.98], [-12, 15.5, 18, 1], [6, 14, 16.8, 1], [26, 12, 14.6, 0.97], [38, 8.5, 10.8, 0.9], [44, 6.5, 8.5, 0.8]],
    });
    // Headlights set into the hood: a dark recess, deepest at the back, with a gray lens and a glint inside it.
    for (const [u0, u1] of [[0.05, 0.3], [0.7, 0.95]]) {
      topMark(body, u0, u1, 31, 40, DARK);
      topMark(body, u0 + 0.025, u1 - 0.025, 33.5, 39.4, LENS);
      topMark(body, u0 + 0.05, u1 - 0.05, 36.8, 38.6, LENS_GLINT);
    }
    topMark(body, 0.36, 0.64, 20, 28, DARK);
    topMark(body, 0.3, 0.7, -32, -20, DARK);
    taillights(body, 0.35, 0.85);
    decal(body, 'back', 0.34, 0.66, 0.3, 0.85, DARK);
    decal(body, 'front', 0.3, 0.7, 0.3, 0.8, DARK);
    for (const [u0, u1] of [[0.06, 0.24], [0.76, 0.94]]) {
      decal(body, 'front', u0, u1, 0.35, 0.82, DARK);
      decal(body, 'front', u0 + 0.02, u1 - 0.02, 0.41, 0.72, LENS);
    }
    sideMark(body, -14, -5, 8, 12.5, DARK);
    const [cabin, roof] = greenhouse({ hw: 17, y0: -18, y1: 20, roofY0: -11, roofY1: 6, z0: 16, z1: 26.5, frame: c, panes: [[0.34, 0.86]], lean: 3 });
    return [
      ...wheelsAndFloor({ axles, radius, width: 7, reach: 23.4, hw: 19.5, length: 38, floor: 15 }),
      body,
      cabin,
      roof,
      ...mirrors(17.4, 15, 16.5, c),
      ...wing({ hw: 22, y0: -45, y1: -36, z: 23.5, strutX: 14, strutZ: 16, color: c }),
      shell({ hw: 21, y0: 42, y1: 47, z0: 2.5, z1: 5, color: DARK, cut: 2, bevel: 0.6 }),
      shell({ hw: 21, y0: -45.5, y1: -42, z0: 3.5, z1: 8, color: DARK, cut: 1.5, bevel: 0.8 }),
    ];
  },

  // Red cab, ladder along the top, and a light bar.
  firetruck: () => {
    const c = 0xe2211c;
    const sill = shell({ hw: 20, y0: -40, y1: 42, z0: 5, z1: 11, color: 0x8c1512, cut: 2, bevel: 0, layer: -1 });
    const cabLow = shell({ hw: 21, y0: 12, y1: 43, z0: 10, z1: 25, color: c, cutB: 0, cutF: 4, bevel: 0 });
    headlights(cabLow, 'front', 0.15, 0.55);
    grille(cabLow, 0.15, 0.7, CHROME);
    arches(cabLow, [27], 9.6, 10);
    const [glass, slab] = cab({ hw: 20.5, y0: 12, y1: 42, z0: 25, z1: 41, roof: c, leanF: 6, leanB: 0, lean: 2.2 });
    const rear = shell({ hw: 21, y0: -42, y1: 12, z0: 10, z1: 38, color: c, cut: 2.5, cutF: 0, bevel: 1.5, bevelF: 0 });
    for (const side of ['left', 'right']) {
      decal(rear, side, 0, 1, 0.05, 0.14, CHROME);
      decal(rear, side, 0.3, 0.6, 0.32, 0.8, shadeColor(c, 0.65));
      decal(rear, side, 0.64, 0.94, 0.32, 0.8, shadeColor(c, 0.65));
    }
    taillights(rear, 0.08, 0.28);
    arches(rear, [-28], 9.6, 10);
    const rails = [-9, 9].map((x) => box(x - 1.5, x + 1.5, -42, 12, 38, 41, CHROME, 2));
    const rungs = [];
    for (let y = -38; y < 10; y += 8) rungs.push(box(-9, 9, y, y + 2, 38.5, 40.5, CHROME, 2));
    const bar = shell({ hw: 13, y0: 22, y1: 28, z0: 41, z1: 45, color: c, cut: 1, bevel: 0.6, layer: 4 });
    decal(bar, 'top', 0.04, 0.48, 0.1, 0.9, PALETTE.lightRed, true);
    decal(bar, 'top', 0.52, 0.96, 0.1, 0.9, PALETTE.lightBlue, true);
    return [...wheelSet({ ys: [-28, 27], radius: 8, width: 5 }), sill, cabLow, glass, slab, rear, ...rails, ...rungs, bar, bumper(21, 42, 45, CHROME)];
  },

  // On tracks, behind a great yellow blade.
  bulldozer: () => {
    const c = 0xf2bb15;
    const hull = shell({ hw: 17.5, y0: -38, y1: 34, z0: 6, z1: 25, color: c, cut: 3, bevel: 2 });
    taillights(hull, 0.55, 0.85);
    grille(hull, 0.3, 0.85);
    for (const side of ['left', 'right']) decal(hull, side, 0.1, 0.9, 0.2, 0.3, shadeColor(c, 0.6));
    const [glass, slab] = cab({ hw: 14.5, y0: -26, y1: 6, z0: 25, z1: 45, lean: 1.5, leanF: 3, leanB: 1, roof: c });
    const stack = ngon({ x: 9, y: 18, sides: 6, r0: 2, r1: 2, z0: 25, z1: 38, color: DARK, layer: 2 });
    const arms = [-21, 21].map((x) => box(x - 2, x + 2, 12, 40, 8, 13, DARK, 0));
    const blade = shell({ hw: 27, y0: 39, y1: 46.5, z0: 1, z1: 26, color: c, cut: 2.5, bevel: 1.5, leanF: 3.5 });
    decal(blade, 'front', 0, 1, 0, 0.12, shadeColor(c, 0.55));
    return [track(-1, 36, 14), track(1, 36, 14), hull, glass, slab, stack, ...arms, blade];
  },

  // Enormous wheels and a small purple truck perched on top.
  monster: () => {
    const c = 0x8a35e0;
    const frame = shell({ hw: 13, y0: -30, y1: 30, z0: 9, z1: 18, color: DARK, cut: 2, bevel: 0, layer: -1 });
    const axles = [-26, 26].map((y) => box(-18, 18, y - 2, y + 2, 11, 15, DARK, -1));
    const hood = shell({ hw: 16.5, y0: 4, y1: 37, z0: 17, z1: [29, 25], color: c, cutB: 0, cutF: 4, bevel: 1.6, bevelB: 0 });
    headlights(hood);
    grille(hood);
    const rear = shell({ hw: 16.5, y0: -36, y1: 4, z0: 17, z1: 29, color: c, cutB: 3, cutF: 0, bevel: 1, bevelF: 0 });
    taillights(rear);
    doors(rear, 0.25, c);
    const [glass, slab] = cab({ hw: 15.5, y0: -24, y1: 4, z0: 29, z1: 43, lean: 2.5, leanF: 6, leanB: 2.5, roof: c, pillar: false });
    return [...wheelSet({ ys: [-26, 26], radius: 14, width: 10, reach: 27, castsShadow: true }), frame, ...axles, hood, rear, glass, slab];
  },

  // The real thing: tracks, a turret and a long gun.
  tank: () => {
    const c = 0x5f8a2e;
    const glacis = shell({ hw: 18, y0: 6, y1: 42, z0: 5, z1: [20, 13], color: c, cut: 2, cutB: 0, bevel: 1.2, bevelB: 0 });
    const rear = shell({ hw: 18, y0: -42, y1: 6, z0: 5, z1: 20, color: c, cut: 2, cutF: 0, bevel: 1.2, bevelF: 0 });
    taillights(rear, 0.5, 0.85);
    decal(rear, 'top', 0.2, 0.8, 0.1, 0.35, shadeColor(c, 0.65));
    const skirts = [-1, 1].map((s) => box(s < 0 ? -20 : 18, s < 0 ? -18 : 20, -42, 42, 14, 18, shadeColor(c, 0.75), 2));
    const turret = ngon({ x: 0, y: -8, sides: 8, r0: 16, r1: 12.5, z0: 20, z1: 31, color: c, topColor: shadeColor(c, 1.12), rotation: Math.PI / 8, layer: 3 });
    const hatch = ngon({ x: -5, y: -12, sides: 6, r0: 4.5, r1: 4, z0: 31, z1: 33, color: shadeColor(c, 0.75), layer: 4 });
    const gun = box(-2, 2, 4, 47, 23, 27, shadeColor(c, 0.7), 4);
    const muzzle = box(-3, 3, 42, 47, 22, 28, DARK, 4);
    return [track(-1, 40, 16), track(1, 40, 16), glacis, rear, ...skirts, turret, hatch, gun, muzzle];
  },
};

export const PLAYER_CAR_IDS = Object.keys(BUILDERS);

export function buildPlayerCar(id) {
  return BUILDERS[id]();
}
