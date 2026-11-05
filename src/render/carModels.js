import { PALETTE, BURNT } from '../config/tuning.js';
import { buildPlayerCar } from './playerCars.js';
import { POLICE_BUILDERS } from './policeModels.js';

export { BEARCAT_LIGHTS, JET, LIGHT_BAR, ROTOR } from './policeModels.js';

// Which model goes with which name:
//   <car id>  any of the cars the player can drive (render/playerCars.js)
//   <car id>Body, <car id>Wheels  a player's car in two pieces, so the body can lean over its wheels. The lower
//     body and bumpers belong to the body: only the wheels are separate, or the car looks as if it comes apart
//   police, interceptor, bearcat, helicopter  render/policeModels.js
//   <any of these>Wreck  the same model burnt out: see burntOut

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
      meshes.set(name, buildPlayerCar(piece[1]).filter((part) => (part.tag === 'wheel') === (piece[2] === 'Wheels')));
    } else if (name in POLICE_BUILDERS) meshes.set(name, POLICE_BUILDERS[name]());
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
