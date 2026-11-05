import { PALETTE } from '../config/tuning.js';
import { box, decal, hexa, loft, shadeColor, shell } from './lowpoly.js';
import { detail, doorLine, greenhouse, headlights, grille, mirrors, pressedBody, sideMark, taillights, wheelsAndFloor } from './playerCars.js';

// The police fleet, built the same way as the player's best cars (bodies made of slices, real wheel openings):
//   police  white patrol car with a navy stripe and a push bar
//   interceptor  the same car in black and white: dark hood, boot and fenders, white doors and roof
//   bearcat  a heavy, dark grey armoured truck with a barred ram
//   helicopter  a rounded police helicopter; its rotors are drawn fresh each frame (HelicopterView)
// Local x = right, y = forward, z = up.

const LENS_RED = PALETTE.lightRed;
const LENS_BLUE = PALETTE.lightBlue;

// Red on the left, blue on the right; CarView adds the flashing glow on top.
function lightBar({ hw, y, z, height, depth = 3.2, layer = 5 }) {
  const bar = shell({ hw, y0: y - depth, y1: y + depth, z0: z, z1: z + height, color: PALETTE.trim, cut: 1.2, bevel: 0.6, layer });
  decal(bar, 'top', 0.04, 0.46, 0.14, 0.86, LENS_RED, true);
  decal(bar, 'top', 0.54, 0.96, 0.14, 0.86, LENS_BLUE, true);
  for (const face of ['front', 'back']) {
    decal(bar, face, 0.04, 0.46, 0.15, 0.85, LENS_RED, true);
    decal(bar, face, 0.54, 0.96, 0.15, 0.85, LENS_BLUE, true);
  }
  return detail(bar);
}

// Light bar position, shared with CarView (the flashing glow is drawn over it).
const ROOF_Z = 30;
export const LIGHT_BAR = { halfWidth: 12, height: 4, centreY: -10, topZ: ROOF_Z + 4 };

function patrolCar({ panel = () => PALETTE.policeBody, marks = () => {}, roofMarks = () => {} }) {
  const c = PALETTE.policeBody;
  const axles = [-27, 27];
  const body = pressedBody({
    axles, radius: 8, W: 22, color: c, panel,
    outline: [[-43, 13.5, 15.5, 0.88], [-37, 16.5, 19, 0.97], [-24, 17, 20, 1], [14, 17, 19.6, 1], [36, 15, 17, 0.97], [43, 11, 13.5, 0.87]],
  });
  taillights(body, 0.45, 0.85);
  decal(body, 'back', 0.34, 0.66, 0.5, 0.82, PALETTE.trim);
  headlights(body, 'front', 0.48, 0.95);
  grille(body, 0.35, 0.8, PALETTE.trim);
  doorLine(body, -5, 6, 17, c);
  marks(body);
  const [cabin, roof] = greenhouse({ hw: 19.5, y0: -25, y1: 14, roofY0: -19, roofY1: -1, z0: 19, z1: ROOF_Z, frame: c, panes: [[0.3, 0.62], [0.66, 0.9]], lean: 3.6 });
  roofMarks(roof);
  const trim = PALETTE.trim;
  const pushBar = [-10, 10].map((x) => detail(box(x - 1.1, x + 1.1, 44.5, 46.8, 4, 13, trim, 1)));
  const rail = detail(box(-12, 12, 45, 46.8, 10, 12.2, trim, 1));
  return [
    ...wheelsAndFloor({ axles, radius: 8, width: 6.5, reach: 22.6, hw: 19, length: 38, floor: 16 }),
    body,
    shell({ hw: 21, y0: 41.5, y1: 45, z0: 4.5, z1: 8.5, color: trim, cut: 1.5, bevel: 0.8 }),
    shell({ hw: 21, y0: -45, y1: -41.5, z0: 4.5, z1: 8.5, color: trim, cut: 1.5, bevel: 0.8 }),
    cabin,
    roof,
    ...mirrors(19.6, 11, 19, trim),
    ...pushBar,
    rail,
    lightBar({ hw: LIGHT_BAR.halfWidth, y: LIGHT_BAR.centreY, z: ROOF_Z, height: LIGHT_BAR.height }),
  ];
}

function buildPolice() {
  const navy = PALETTE.policeStripe;
  return patrolCar({
    marks: (body) => sideMark(body, -16, 16, 10.5, 14.5, navy),
    roofMarks: (roof) => decal(roof, 'top', 0, 1, 0.76, 1, navy),
  });
}

function buildInterceptor() {
  const dark = PALETTE.interceptorDark;
  return patrolCar({ panel: (band, y) => (y > 14 || y < -24 ? dark : PALETTE.policeBody) });
}

// Roof lights, for CarView's flashing glow.
const TRUCK_ROOF = 45;
export const BEARCAT_LIGHTS = { halfWidth: 8, centreY: -1, topZ: TRUCK_ROOF + 3 };

// Bigger than a car in play (BEARCAT.scale), slab-sided, with narrow slits for windows.
function buildBearcat() {
  const c = PALETTE.swatBody;
  const dark = PALETTE.swatDark;
  const axles = [-27, 24];
  const radius = 10.5;
  const body = pressedBody({
    axles, radius, W: 22, flare: 1.6, sill: 9, color: c,
    outline: [[-44, 24, 27, 0.96], [-39, 26, 29, 1], [12, 26, 29, 1], [33, 25, 28, 0.98], [38, 21, 27, 0.92]],
  });
  taillights(body, 0.5, 0.82);
  headlights(body, 'front', 0.62, 0.92);
  sideMark(body, -39, 38, 23, 25.6, PALETTE.swatStripe);
  doorLine(body, -7, 9, 23, c);
  const [cabin, roof] = greenhouse({ hw: 20.5, y0: -42, y1: 12, roofY0: -40, roofY1: 5, z0: 28.5, z1: TRUCK_ROOF, frame: c, panes: [[0.14, 0.34], [0.42, 0.62], [0.72, 0.92]], lean: 2 });
  // Armour over the lower half of the glass, leaving slits.
  for (const side of ['left', 'right']) decal(cabin, side, 0, 1, 0, 0.5, c);
  decal(cabin, 'front', 0, 1, 0, 0.42, c);
  decal(cabin, 'back', 0, 1, 0, 0.55, c);
  decal(roof, 'top', 0.1, 0.9, 0.08, 0.92, shadeColor(c, 0.82));
  const hatch = detail(shell({ hw: 8, y0: -34, y1: -16, z0: TRUCK_ROOF, z1: TRUCK_ROOF + 2.6, color: dark, cut: 1.5, bevel: 0.8, layer: 5 }));
  const ram = shell({ hw: 24, y0: 37, y1: 46, z0: 4, z1: 23, color: dark, cut: 2, bevel: 1.5, leanF: 1 });
  for (let i = 0; i < 5; i += 1) decal(ram, 'front', 0.1 + i * 0.17, 0.17 + i * 0.17, 0.12, 0.86, PALETTE.hub);
  return [
    ...wheelsAndFloor({ axles, radius, width: 8, reach: 23, hw: 19, length: 37, floor: 21 }),
    body,
    cabin,
    roof,
    ram,
    hatch,
    ...mirrors(21, 9, 29, dark),
    shell({ hw: 21, y0: -47, y1: -43.5, z0: 7, z1: 13, color: dark, cut: 1.2, bevel: 0.8 }),
    lightBar({ hw: BEARCAT_LIGHTS.halfWidth, y: BEARCAT_LIGHTS.centreY, z: TRUCK_ROOF, height: 3, depth: 2.6, layer: 6 }),
  ];
}

// It is modelled at car size and drawn larger on screen: it has to read clearly from this far above the
// road, and modelling it this size would need a drawing sheet too wide for older phones.
const HELI_SCALE = 1.5;
const MAST_TOP = 37;
const TAIL_Y = -74;
const TAIL_ROTOR_Z = 31;

// A slice through the fuselage: rounded, widest around the middle.
const slice = (y, w, z0, z1) => {
  const at = (share) => z0 + (z1 - z0) * share;
  return { y, half: [[w * 0.55, z0], [w * 0.93, at(0.2)], [w, at(0.5)], [w * 0.84, at(0.82)], [w * 0.46, z1]] };
};

// One skid: a long runner with its front turned up.
function skid(x) {
  const c = PALETTE.rotorBlade;
  const tip = hexa(
    [[x - 1.5, 26, -9], [x + 1.5, 26, -9], [x + 1.5, 33, -4.5], [x - 1.5, 33, -4.5]],
    [[x - 1.5, 26, -6.5], [x + 1.5, 26, -6.5], [x + 1.5, 33, -2], [x - 1.5, 33, -2]],
    c,
    0,
  );
  return [box(x - 1.5, x + 1.5, -26, 26, -9, -6.5, c, 0), tip];
}

function buildHelicopter() {
  const c = PALETTE.heliBody;
  const band = PALETTE.heliBand;
  const glass = PALETTE.glass;
  const paint = (b, y) => {
    if (y > 8 && b >= 2) return glass; // the nose bubble, from the chin up and over
    if (y > 16 && b === 1) return glass;
    if (y > -11 && y < 6 && b === 2) return glass; // the cabin's side windows
    return b <= 1 ? band : c;
  };
  const fuselage = loft({
    stations: [slice(-24, 7, 12, 25), slice(-11, 13, 4, 28), slice(6, 15, 2, 29), slice(18, 13.5, 3, 24.5), slice(28, 9.5, 6, 16), slice(34, 4.5, 9, 12.5)],
    paint,
    layer: 2,
  });
  decal(fuselage, 'top:2', 0.14, 0.3, 0.12, 0.9, PALETTE.glassShine);
  const boom = loft({
    stations: [slice(TAIL_Y, 2.2, 19, 23), slice(-22, 5.5, 12, 25)],
    paint: (b) => (b <= 1 ? band : c),
    layer: 1,
  });
  const stabiliser = shell({ hw: 13, y0: -65, y1: -57, z0: 20, z1: 22, color: band, cut: 1.5, bevel: 0.6, layer: 2 });
  const fin = shell({ hw: 1.4, y0: TAIL_Y, y1: -60, z0: 21, z1: 38, color: c, cut: 0.5, bevel: 0.4, leanB: -2, leanF: 6, layer: 3 });
  const hump = shell({ hw: 8, y0: -15, y1: 6, z0: 27, z1: 33, color: shadeColor(c, 0.72), cut: 3, bevel: 1.5, lean: 1.5, layer: 3 });
  decal(hump, 'back', 0.14, 0.42, 0.25, 0.8, PALETTE.trim);
  decal(hump, 'back', 0.58, 0.86, 0.25, 0.8, PALETTE.trim);
  const mast = box(-2, 2, -6, -2, 33, MAST_TOP, PALETTE.rotorBlade, 4);
  const lamp = detail(shell({ hw: 2.8, y0: 25, y1: 31, z0: 1, z1: 6, color: PALETTE.trim, cut: 1, bevel: 0.6, layer: 1 }));
  decal(lamp, 'front', 0.14, 0.86, 0.14, 0.86, PALETTE.searchlight, true);
  const tube = (y) => box(-16, 16, y - 1, y + 1, -3, -1, PALETTE.rotorBlade, 0);
  const leg = (x, y) => box(x - 1, x + 1, y - 1, y + 1, -7, -1, PALETTE.rotorBlade, 0);
  return [...skid(-16), ...skid(16), tube(-12), tube(14), leg(-16, -12), leg(16, -12), leg(-16, 14), leg(16, 14), lamp, boom, stabiliser, fuselage, fin, hump, mast];
}

// The helicopter's rotors, shared with HelicopterView, which draws them.
export const ROTOR = { radius: 92, height: MAST_TOP * HELI_SCALE, tailReach: -TAIL_Y * HELI_SCALE, tailHeight: TAIL_ROTOR_Z * HELI_SCALE, modelScale: HELI_SCALE };

// The airstrike's jet: a plain grey, cartoonish fighter, no markings of any country. Modelled at car size and drawn
// larger (JET.modelScale), like the helicopter. Local y = forward.
const JET_SCALE = 1.8;
function buildJet() {
  const c = PALETTE.jetBody;
  const dark = PALETTE.jetDark;
  const fuselage = loft({
    stations: [slice(-44, 4.5, 8, 15), slice(-30, 6.5, 6, 17), slice(0, 7.5, 5, 18), slice(26, 6, 6, 16), slice(40, 3.5, 8, 13), slice(48, 1.5, 10, 11.5)],
    paint: (b, y) => (y > 36 ? dark : c),
    layer: 2,
  });
  const canopy = loft({
    stations: [slice(8, 3.2, 16, 18), slice(18, 3.8, 15.5, 22.5), slice(30, 2.6, 15, 19)],
    paint: () => PALETTE.glass,
    layer: 3,
  });
  decal(canopy, 'top:0', 0.2, 0.45, 0.2, 0.9, PALETTE.glassShine);
  const flat = (points, z, thick, color, layer) => hexa(points.map(([x, y]) => [x, y, z]), points.map(([x, y]) => [x, y, z + thick]), color, layer);
  const wings = flat([[-46, -24], [46, -24], [8, 16], [-8, 16]], 9, 2, c, 1);
  const tailWings = flat([[-17, -46], [17, -46], [4, -32], [-4, -32]], 11, 1.6, c, 1);
  const fin = hexa([[-1, -46, 15], [1, -46, 15], [1, -30, 15], [-1, -30, 15]], [[-1, -48, 34], [1, -48, 34], [1, -40, 34], [-1, -40, 34]], dark, 4);
  const intakes = [-1, 1].map((sd) => detail(box(sd * 8.5 - 2, sd * 8.5 + 2, -8, 10, 7, 13, dark, 1)));
  const nozzle = detail(box(-3.5, 3.5, -49, -44, 9.5, 15, PALETTE.trim, 2));
  return [wings, tailWings, ...intakes, nozzle, fuselage, canopy, fin];
}

export const JET = { modelScale: JET_SCALE };

export const POLICE_BUILDERS = { police: buildPolice, interceptor: buildInterceptor, bearcat: buildBearcat, helicopter: buildHelicopter, jet: buildJet };
