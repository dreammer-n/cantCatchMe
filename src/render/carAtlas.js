import { RENDER } from '../config/tuning.js';
import { wrapAngle } from '../utils/math.js';
import { carMesh } from './carModels.js';
import { boundsOf, paintMesh, projectMesh } from './lowpoly.js';
import { projection } from './projection.js';

// Directional car drawings, made at startup from the 3D low-poly model: RENDER.directions views
// evenly spaced around the compass, all through the current camera. Frames are named dir0 .. dir(N-1)
// (dir0 = facing north, then clockwise); every frame is the same size with the car's ground centre
// at the same pivot. All directions are drawn (no mirroring), because the light comes from one side.
// Real artwork can later replace this with a loaded atlas of the same layout.

const TAU = Math.PI * 2;
const COLUMNS = 8;
const PADDING = 2; // world units around the drawing inside each frame

export const atlasMeta = new Map(); // atlas key -> { originX, originY, cellW, cellH, width, height, directions }
const MAX_DIRECTIONS = Math.max(RENDER.directions, ...Object.values(RENDER.carDirections));
const FRAME_NAMES = Array.from({ length: MAX_DIRECTIONS }, (_, i) => `dir${i}`);

export function directionsFor(name) {
  if (name.endsWith('Wreck')) return RENDER.carDirections.playerWreck;
  if (name.endsWith('Body')) return RENDER.carDirections.playerBody;
  if (name.endsWith('Wheels')) return RENDER.carDirections.playerWheels;
  return RENDER.carDirections[name] || RENDER.directions;
}

export function atlasKey(name, proj) {
  return `car:${name}:${proj.key}`;
}

export function directionHeading(index, directions = RENDER.directions) {
  return (index * TAU) / directions;
}

// Every view of the car, plus how far the drawings reach from the pivot (to size the frames).
export function measureCar(name, proj) {
  const mesh = carMesh(name);
  const directions = directionsFor(name);
  const views = [];
  let halfWidth = 0;
  let up = 0;
  let down = 0;
  for (let i = 0; i < directions; i += 1) {
    const projected = projectMesh(mesh, directionHeading(i, directions), proj);
    const b = boundsOf(projected);
    halfWidth = Math.max(halfWidth, -b.minX, b.maxX);
    up = Math.max(up, -b.minY);
    down = Math.max(down, b.maxY);
    views.push(projected);
  }
  return { views, halfWidth, up, down, directions };
}

export function atlasLayout(measure) {
  const scale = RENDER.bakeScale;
  const cellW = Math.ceil((measure.halfWidth + PADDING) * 2 * scale);
  const cellH = Math.ceil((measure.up + measure.down + PADDING * 2) * scale);
  const rows = Math.ceil((measure.directions || RENDER.directions) / COLUMNS);
  return { cellW, cellH, pivotY: (measure.up + PADDING) * scale, width: COLUMNS * cellW, height: rows * cellH };
}

// Sheets made but not all drawn yet: atlas key -> { texture, views, cellW, cellH, pivotY, left: frame indices }.
const unfinished = new Map();

function paintFrame(job, i) {
  const scale = RENDER.bakeScale;
  const ctx = job.texture.context;
  const x = (i % COLUMNS) * job.cellW;
  const y = Math.floor(i / COLUMNS) * job.cellH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, job.cellW, job.cellH);
  ctx.clip(); // keep each view inside its own frame
  ctx.translate(x + job.cellW / 2, y + job.pivotY);
  ctx.scale(scale, scale);
  paintMesh(ctx, job.views[i]);
  ctx.restore();
}

// Builds the atlas for the current camera (once per camera setup). Returns its key.
// first: 'all' draws every direction now. A heading draws only the views around it now (a car standing still on
// the title), 'none' none at all; paintCarAtlases draws the rest a few a frame, and asking again with 'all'
// finishes it at once. A run never starts with a sheet unfinished (GameScene.finishWarmUp).
export function ensureCarAtlas(scene, name, proj = projection, first = 'all') {
  const key = atlasKey(name, proj);
  if (scene.textures.exists(key)) {
    if (first === 'all') finishAtlas(key);
    else if (typeof first === 'number' && unfinished.has(key)) {
      const job = unfinished.get(key);
      const before = job.left.length;
      paintAround(job, first);
      if (job.left.length !== before) job.texture.refresh();
    }
    return key;
  }

  const measure = measureCar(name, proj);
  const { cellW, cellH, pivotY, width, height } = atlasLayout(measure);
  const texture = scene.textures.createCanvas(key, width, height);
  const job = { texture, views: measure.views, cellW, cellH, pivotY, left: [] };
  measure.views.forEach((_, i) => {
    texture.add(FRAME_NAMES[i], 0, (i % COLUMNS) * cellW, Math.floor(i / COLUMNS) * cellH, cellW, cellH);
    job.left.push(i);
  });
  atlasMeta.set(key, { originX: 0.5, originY: pivotY / cellH, cellW, cellH, width, height, directions: measure.directions });
  if (typeof first === 'number') paintAround(job, first);
  unfinished.set(key, job);
  if (first === 'all') finishAtlas(key);
  else texture.refresh();
  return key;
}

// The view for a heading and its neighbours, in case it is drawn a step either way.
function paintAround(job, heading) {
  const n = job.views.length;
  const index = Math.round(((((heading % TAU) + TAU) % TAU) / TAU) * n) % n;
  for (const i of [index, (index + 1) % n, (index + n - 1) % n]) {
    const at = job.left.indexOf(i);
    if (at < 0) continue;
    paintFrame(job, i);
    job.left.splice(at, 1);
  }
}

function finishAtlas(key) {
  const job = unfinished.get(key);
  if (!job) return;
  for (const i of job.left) paintFrame(job, i);
  job.left.length = 0;
  job.texture.refresh();
  unfinished.delete(key);
}

// Draws up to `count` more views of the unfinished sheets. Returns whether any are left.
export function paintCarAtlases(count) {
  for (const [key, job] of unfinished) {
    while (count > 0 && job.left.length > 0) {
      paintFrame(job, job.left.shift());
      count -= 1;
    }
    if (job.left.length === 0) {
      job.texture.refresh();
      unfinished.delete(key);
    }
    if (count <= 0) break;
  }
  return unfinished.size > 0;
}

export function finishCarAtlases() {
  for (const key of [...unfinished.keys()]) finishAtlas(key);
}

// There are too many cars to keep them all drawn: only the selected one has sheets, and these go when it is
// swapped for another. Call once nothing is showing them.
export function releaseCarSheets(scene, id, proj = projection) {
  for (const name of [`${id}Body`, `${id}Wheels`, `${id}Wreck`]) {
    const key = atlasKey(name, proj);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    atlasMeta.delete(key);
    unfinished.delete(key);
  }
}

// Picks the drawing for a world heading. Writes { frame, rotation } into `out`.
// rotation = small leftover angle between that drawing and the true on-screen direction.
export function frameFor(heading, proj, out = { frame: 'dir0', rotation: 0 }, directions = RENDER.directions) {
  const n = directions;
  const step = TAU / n;
  const turns = (((heading % TAU) + TAU) % TAU) / step;
  const index = Math.round(turns) % n;
  out.frame = FRAME_NAMES[index];
  out.rotation = wrapAngle(proj.screenHeading(heading) - proj.screenHeading(index * step)) * RENDER.residualRotation;
  return out;
}
