import { PALETTE } from '../config/tuning.js';
import { chunkyWheel, ngon, paintMesh, projectMesh, shadeColor, shell } from './lowpoly.js';
import { projection } from './projection.js';

// The wreckage that flies out of a crash, as real solid models: a tire, a door panel, a bent bumper, a piece of
// hood. Each is drawn at startup in DEBRIS.poses positions through one turn, so as it tumbles the sheet shows its
// thickness and its faces catching the light. Pose 0 is lying flat, as is the pose half a turn on.

export const DEBRIS = {
  poses: 16,
  scale: 1.5, // pixels per world unit in the sheet
  cell: 40, // world units across one drawing
  shards: 6, // little fragments, each one fixed pose
};

export const DEBRIS_KINDS = ['tire', 'panel', 'bumper', 'hood'];
const KEY = 'fx-debris';

// A copy of a model, with every point moved. Colours and faces stay as they are.
function moved(mesh, change) {
  const seen = new Map();
  const point = (p) => {
    if (!seen.has(p)) seen.set(p, change(p));
    return seen.get(p);
  };
  return mesh.map((part) => ({
    ...part,
    verts: part.verts.map(point),
    faces: part.faces.map((face) => ({
      ...face,
      quad: face.quad && face.quad.map(point),
      decals: face.decals.map((d) => ({ ...d, pts: d.pts.map(point) })),
    })),
  }));
}

function turnedAboutX([x, y, z], a) {
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

function turnedAboutY([x, y, z], a) {
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

function turnedAboutZ([x, y, z], a) {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}

const MODELS = {
  tire: () => {
    const wheel = chunkyWheel({ x0: -3.5, x1: 3.5, y: 0, radius: 8, color: PALETTE.chunkTire, rim: PALETTE.chunkHub, hub: PALETTE.chunkTireWall, side: 1, sides: 10, chamfer: 1 });
    return moved([wheel], ([x, y, z]) => [x, y, z - 8]);
  },
  panel: () => {
    const color = PALETTE.chunkPanel;
    const part = shell({ hw: 11, y0: -8, y1: 8, z0: -1.1, z1: 1.1, color, cut: 2.6, bevel: 0.6 });
    part.faces.find((f) => f.name === 'top').decals.push({ pts: [[-7.5, 2, 1.1], [7.5, 2, 1.1], [7.5, 2.8, 1.1], [-7.5, 2.8, 1.1]], color: shadeColor(color, 0.6) });
    return moved([part], ([x, y, z]) => [x, y, z + (y * y) * 0.02 - 0.6]); // creased by the crash
  },
  bumper: () => moved([shell({ hw: 15, y0: -2.6, y1: 2.6, z0: -1.9, z1: 1.9, color: PALETTE.chunkMetal, cut: 1.2, bevel: 0.8 })], ([x, y, z]) => [x, y + x * x * 0.018 - 2, z]),
  hood: () => {
    const part = ngon({ sides: 5, r0: 12, r1: 10.5, z0: -1, z1: 1, color: shadeColor(PALETTE.chunkPanel, 1.45), rotation: 0.4 });
    return moved([part], ([x, y, z]) => [x * 1.05, y * 0.8, z + x * 0.1]);
  },
};

// Each kind tumbles about its own slanted axis, so it doesn't just flip like a card.
function pose(kind, mesh, a) {
  if (kind === 'tire') return moved(mesh, (p) => turnedAboutY(p, a + Math.PI / 2)); // flat at 0, upright at a quarter turn
  return moved(mesh, (p) => turnedAboutZ(turnedAboutX(p, a), 0.5));
}

// A small splinter with some depth: pale, because the particles tint it.
function shardMesh(seed) {
  const sides = 3 + (seed % 3);
  const part = ngon({ sides, r0: 4.5, r1: 3.4, z0: -1.1, z1: 1.1, color: 0xd8d8d8, rotation: seed });
  return moved([part], (p) => turnedAboutZ(turnedAboutX(p, 0.7 + seed * 0.9), seed));
}

function draw(ctx, mesh, x, y) {
  ctx.setTransform(DEBRIS.scale, 0, 0, DEBRIS.scale, x, y);
  paintMesh(ctx, projectMesh(mesh, 0.5, projection));
}

export const frameName = (kind, index) => `${kind}${index}`;
export const shardFrames = () => Array.from({ length: DEBRIS.shards }, (_, i) => `shard${i}`);

// Draws the sheet, once.
export function makeDebrisSheet(scene) {
  if (scene.textures.exists(KEY)) return KEY;
  const cell = Math.ceil(DEBRIS.cell * DEBRIS.scale);
  const texture = scene.textures.createCanvas(KEY, cell * DEBRIS.poses, cell * (DEBRIS_KINDS.length + 1));
  const ctx = texture.context;
  DEBRIS_KINDS.forEach((kind, row) => {
    const mesh = MODELS[kind]();
    for (let i = 0; i < DEBRIS.poses; i += 1) {
      draw(ctx, pose(kind, mesh, (i / DEBRIS.poses) * Math.PI * 2), (i + 0.5) * cell, (row + 0.5) * cell);
      texture.add(frameName(kind, i), 0, i * cell, row * cell, cell, cell);
    }
  });
  for (let i = 0; i < DEBRIS.shards; i += 1) {
    draw(ctx, shardMesh(i + 1), (i + 0.5) * cell, (DEBRIS_KINDS.length + 0.5) * cell);
    texture.add(`shard${i}`, 0, i * cell, DEBRIS_KINDS.length * cell, cell, cell);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  texture.refresh();
  return KEY;
}
