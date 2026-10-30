import * as Phaser from 'phaser';
import { CHUNKS, CONES, DEPTH, PALETTE, RENDER, SCENERY, WORLD } from '../config/tuning.js';
import { propCatalogue } from '../systems/WorldLayout.js';
import { createRng } from '../utils/math.js';
import { depthAt } from './layers.js';
import { bakeMesh } from './lowpoly.js';
import { projection } from './projection.js';
import { LAMP_REACH, propBakeScale, propMesh } from './propModels.js';

const DEG = Math.PI / 180;
const screen = { x: 0, y: 0 };
const CULL_MARGIN = 40;
const CHUNK_BOX_MARGIN = 160; // lamp glows and hole edges reach a little beyond their chunk's props
const FLOOR_SQUARES = Math.round(CHUNKS.size / SCENERY.floorChunk);
const MAX_NEW_CHUNKS_IN_A_STEP = 5; // crossing a corner brings in 5; more means a restart or a jump

// Draws whatever chunks the simulation has loaded (systems/ChunkManager.js):
//   floor   painted asphalt in the ground layer (world coordinates), split into squares so the
//           squares off screen are skipped;
//   holes   sinkholes, drawn on top of the floor;
//   props   low-poly models drawn once at startup into images, depth-sorted by where they stand,
//           hidden while off screen.
// Nothing is created during play: floors come from one fixed set per chunk in the grid, prop images
// from a pool. Each new chunk costs a little time, so normally only one is filled in per frame:
// they arrive off screen, beyond what the camera shows.
// Breakable props are the only ones that move (knocked flying); the simulation says where they are.
export class Scenery {
  constructor(scene, layers) {
    this.scene = scene;
    this.meshes = new Map();
    this.items = []; // the prop on screen for each item of the loaded chunks
    this.bySource = new Map();
    this.freeProps = [];
    this.loaded = new Map(); // chunk key -> { slot, props, data }
    this.seenVersion = -1;
    this.waiting = false; // chunks still to be filled in
    this.bakeCatalogue();
    for (let i = 0; i < CHUNKS.propPool; i += 1) this.freeProps.push(this.makeProp());
    this.freeSlots = createSlots(scene, layers);
  }

  // Draws every prop model for the current camera, once.
  bakeCatalogue() {
    for (const entry of propCatalogue()) {
      const key = propKey(entry.model, entry.heading);
      bakeMesh(this.scene, key, this.meshFor(entry), entry.heading, projection, 'body', propBakeScale(entry));
      bakeMesh(this.scene, `${key}:shadow`, this.meshFor(entry), entry.heading, projection, 'shadow');
    }
  }

  meshFor(entry) {
    let mesh = this.meshes.get(entry.model);
    if (!mesh) {
      mesh = propMesh(entry);
      this.meshes.set(entry.model, mesh);
    }
    return mesh;
  }

  makeProp() {
    const shadow = this.scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    const body = this.scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    return { body, shadow, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 }, source: null, gone: false, moved: false };
  }

  // Called every frame; does nothing unless the set of loaded chunks has changed.
  // budget: how many new chunks to fill in now.
  sync(chunks, budget = 1) {
    if (this.seenVersion === chunks.version && !this.waiting) return;
    this.seenVersion = chunks.version;
    for (const [key, entry] of this.loaded) {
      if (!chunks.active.has(key)) this.unloadChunk(key, entry);
    }
    let missing = 0;
    for (const key of chunks.active.keys()) if (!this.loaded.has(key)) missing += 1;
    let left = missing > MAX_NEW_CHUNKS_IN_A_STEP ? Infinity : budget;
    for (const [key, chunk] of chunks.active) {
      if (left <= 0) break;
      if (this.loaded.has(key)) continue;
      this.loadChunk(key, chunk.data);
      left -= 1;
      missing -= 1;
    }
    this.waiting = missing > 0;
    this.items = [];
    for (const entry of this.loaded.values()) for (const prop of entry.props) this.items.push(prop);
  }

  loadChunk(key, data) {
    const slot = this.freeSlots.pop();
    this.drawFloor(slot, data);
    this.drawHoles(slot, data);
    const props = data.items.map((item) => {
      const prop = this.freeProps.pop() || this.makeProp();
      prop.source = item;
      this.bySource.set(item, prop);
      this.showProp(prop);
      return prop;
    });
    this.loaded.set(key, { slot, props, data });
  }

  unloadChunk(key, entry) {
    for (const prop of entry.props) {
      this.bySource.delete(prop.source);
      prop.source = null;
      prop.gone = false;
      prop.moved = false;
      prop.body.setVisible(false).setRotation(0).setAlpha(1);
      prop.shadow.setVisible(false);
      this.freeProps.push(prop);
    }
    for (const square of entry.slot.squares) square.floor.setVisible(false);
    entry.slot.glow.setVisible(false);
    entry.slot.holes.setVisible(false);
    this.freeSlots.push(entry.slot);
    this.loaded.delete(key);
  }

  showProp(prop) {
    const item = prop.source;
    const key = propKey(item.model, item.heading);
    const body = bakeMesh(this.scene, key, this.meshFor(item), item.heading, projection, 'body', propBakeScale(item));
    const shadow = bakeMesh(this.scene, `${key}:shadow`, this.meshFor(item), item.heading, projection, 'shadow');
    prop.body.setTexture(body.key).setOrigin(body.originX, body.originY).setScale(1 / body.scale);
    prop.shadow.setTexture(shadow.key).setOrigin(shadow.originX, shadow.originY).setScale(1 / shadow.scale).setAlpha(RENDER.shadowAlpha);
    this.place(prop, item.x, item.y, 0);
    prop.body.setDepth(item.band === 'raised' ? DEPTH.raised : depthAt(item.x, item.y));
    prop.shadow.setDepth(item.band === 'raised' ? DEPTH.raised - 1 : DEPTH.shadows);
  }

  // Called when the camera setup changes (debug tool): redraws everything for the new view.
  redraw() {
    this.bakeCatalogue();
    for (const entry of this.loaded.values()) {
      for (const prop of entry.props) this.showProp(prop);
      this.drawHoles(entry.slot, entry.data);
      this.measureSlot(entry.slot, entry.data);
    }
  }

  place(prop, x, y, lift) {
    projection.toScreen(x, y, 0, screen);
    prop.shadow.setPosition(screen.x, screen.y);
    prop.body.setPosition(screen.x, screen.y - lift * projection.lift);
    // Screen box around body and shadow, for culling.
    const b = prop.bounds;
    b.x0 = Infinity;
    b.y0 = Infinity;
    b.x1 = -Infinity;
    b.y1 = -Infinity;
    this.growBounds(b, prop.body);
    this.growBounds(b, prop.shadow);
  }

  growBounds(b, image) {
    const w = image.width * image.scaleX;
    const h = image.height * image.scaleY;
    const left = image.x - image.originX * w;
    const top = image.y - image.originY * h;
    b.x0 = Math.min(b.x0, left);
    b.y0 = Math.min(b.y0, top);
    b.x1 = Math.max(b.x1, left + w);
    b.y1 = Math.max(b.y1, top + h);
  }

  // view: the camera's visible rectangle (camera.worldView). Hides everything outside it.
  cull(view) {
    const x0 = view.x - CULL_MARGIN;
    const y0 = view.y - CULL_MARGIN;
    const x1 = view.right + CULL_MARGIN;
    const y1 = view.bottom + CULL_MARGIN;
    for (const prop of this.items) {
      if (prop.gone) continue;
      const b = prop.bounds;
      const visible = b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
      if (prop.body.visible !== visible) {
        prop.body.setVisible(visible);
        prop.shadow.setVisible(visible);
      }
    }
    for (const { slot } of this.loaded.values()) {
      for (const square of slot.squares) {
        const b = square.bounds;
        square.floor.setVisible(b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1);
      }
      const b = slot.bounds;
      const visible = b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
      slot.glow.setVisible(visible);
      slot.holes.setVisible(visible);
    }
  }

  // Moves the props the simulation knocked over. cones: ChaseSimulation.cones.
  syncCones(cones) {
    for (const cone of cones) {
      const prop = this.bySource.get(cone.item);
      if (!prop) continue;
      const item = prop.source;
      if (cone.state === 'standing') {
        if (prop.moved) {
          prop.moved = false;
          prop.gone = false;
          prop.body.setRotation(0).setAlpha(1).setVisible(true);
          prop.shadow.setAlpha(RENDER.shadowAlpha).setVisible(true);
          this.place(prop, item.x, item.y, 0);
          prop.body.setDepth(depthAt(item.x, item.y));
        }
        continue;
      }
      prop.moved = true;
      if (cone.state === 'gone') {
        prop.gone = true;
        prop.body.setVisible(false);
        prop.shadow.setVisible(false);
        continue;
      }
      // Flying: bounces that get smaller, and a spin, fading out at the end.
      const feel = CONES.kinds[item.kind] || CONES;
      const t = Math.min(1, cone.timer / (feel.flySeconds || CONES.flySeconds));
      const bounces = Math.abs(Math.sin(Math.PI * t * 3)) * (1 - t) * (feel.hop || CONES.hop);
      this.place(prop, cone.x, cone.y, bounces);
      prop.body.setRotation(cone.angle).setAlpha(Math.min(1, (1 - t) * 3)).setDepth(depthAt(cone.x, cone.y));
      prop.shadow.setAlpha(RENDER.shadowAlpha * Math.min(1, (1 - t) * 3));
    }
  }

  // ------------------------------------------------------------------------------------------
  // Floor
  // ------------------------------------------------------------------------------------------

  drawFloor(slot, data) {
    const size = SCENERY.floorChunk;
    const random = createRng(data.seed + 77);
    const patches = Math.round(SCENERY.patchesPerCell * (size / WORLD.cell) ** 2);
    for (let row = 0; row < FLOOR_SQUARES; row += 1) {
      for (let col = 0; col < FLOOR_SQUARES; col += 1) {
        const square = slot.squares[row * FLOOR_SQUARES + col];
        const x0 = data.x0 + col * size;
        const y0 = data.y0 + row * size;
        const x1 = x0 + size;
        const y1 = y0 + size;
        const g = square.floor;
        g.clear();
        g.fillStyle(PALETTE.asphalt, 1);
        // Overlap neighbours by a unit so no seam shows between squares.
        g.fillRect(x0 - 1, y0 - 1, size + 2, size + 2);
        // Each rectangle is cut at the same overlap, so a square never draws further outside itself
        // than that (culling stays exact) and its asphalt can't leave a line across a neighbour's paint.
        for (const mark of data.paint) {
          if (mark.ring) {
            if (mark.x >= x0 && mark.x < x1 && mark.y >= y0 && mark.y < y1) {
              g.lineStyle(mark.width, PALETTE.paintWhite, mark.alpha);
              g.strokeCircle(mark.x, mark.y, mark.r);
            }
            continue;
          }
          if (mark.arrow) {
            if (mark.x >= x0 && mark.x < x1 && mark.y >= y0 && mark.y < y1) drawArrow(g, mark);
            continue;
          }
          const px0 = Math.max(mark.x, x0 - 1);
          const py0 = Math.max(mark.y, y0 - 1);
          const px1 = Math.min(mark.x + mark.w, x1 + 1);
          const py1 = Math.min(mark.y + mark.h, y1 + 1);
          if (px1 <= px0 || py1 <= py0) continue;
          g.fillStyle(floorColor(mark.color), mark.alpha);
          g.fillRect(px0, py0, px1 - px0, py1 - py0);
        }
        // Worn asphalt patches: give the eye something to track at speed.
        for (let i = 0; i < patches; i += 1) {
          const r = 10 + random() * 30;
          const x = x0 + 40 + random() * (size - 80);
          const y = y0 + 40 + random() * (size - 80);
          const angle = random() * Math.PI * 2;
          g.fillStyle(i % 3 === 0 ? PALETTE.asphaltPatchLight : PALETTE.asphaltPatchDark, 0.8);
          const corner = (k) => [x + Math.cos(angle + k * 2.2) * r, y + Math.sin(angle + k * 2.2) * r * 0.7];
          const [a, b, c] = [corner(0), corner(1), corner(2)];
          g.fillTriangle(a[0], a[1], b[0], b[1], c[0], c[1]);
        }
        square.x0 = x0;
        square.y0 = y0;
      }
    }

    // Warm light pools under the street lamps (additive blend = glow).
    slot.glow.clear();
    for (const item of data.items) {
      if (item.kind !== 'lamp') continue;
      const hx = item.x + Math.sin(item.heading) * LAMP_REACH;
      const hy = item.y - Math.cos(item.heading) * LAMP_REACH;
      slot.glow.fillStyle(PALETTE.lampGlow, 0.13);
      slot.glow.fillCircle(hx, hy, 115);
      slot.glow.fillStyle(PALETTE.lampGlow, 0.15);
      slot.glow.fillCircle(hx, hy, 65);
    }
    this.measureSlot(slot, data);
  }

  measureSlot(slot, data) {
    for (const square of slot.squares) {
      square.bounds = projectedBox(square.x0, square.y0, square.x0 + SCENERY.floorChunk, square.y0 + SCENERY.floorChunk);
    }
    const m = CHUNK_BOX_MARGIN;
    slot.bounds = projectedBox(data.x0 - m, data.y0 - m, data.x0 + CHUNKS.size + m, data.y0 + CHUNKS.size + m);
  }

  // Each hole: a broken rim, then the far wall going down, then the dark. The dark part is pushed
  // toward the viewer, which leaves the far wall showing, so the hole reads as having depth.
  drawHoles(slot, data) {
    const g = slot.holes;
    g.clear();
    const towardX = projection.sinA;
    const towardY = projection.cosA;
    for (const hole of data.voids) {
      const scaled = (factor, shift = 0) =>
        hole.outline.map((p) => ({
          x: hole.x + (p.x - hole.x) * factor + towardX * shift,
          y: hole.y + (p.y - hole.y) * factor + towardY * shift,
        }));
      const reach = hole.collider.type === 'circle' ? hole.collider.r : hole.collider.hl;
      g.fillStyle(PALETTE.voidRim, 1);
      g.fillPoints(scaled(1.1), true);
      g.fillStyle(PALETTE.voidWall, 1);
      g.fillPoints(scaled(1), true);
      g.fillStyle(PALETTE.void, 1);
      g.fillPoints(scaled(0.84, reach * 0.12), true);
    }
  }

  describe() {
    return this.items.map(({ source, body }) => ({ name: source.name, kind: source.kind, x: source.x, y: source.y, depth: body.depth, visible: body.visible }));
  }
}

// One set of floor drawings per chunk in the active grid. Order matters: everything in the ground
// layer is drawn in the order it was added, so all floors come first and all lamp glows together.
// Mixing them would cost an extra draw call per blend change.
function createSlots(scene, layers) {
  const count = (CHUNKS.activeRadius * 2 + 1) ** 2;
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const squares = [];
    for (let k = 0; k < FLOOR_SQUARES * FLOOR_SQUARES; k += 1) {
      const floor = scene.add.graphics().setVisible(false);
      layers.ground.add(floor);
      squares.push({ floor, x0: 0, y0: 0, bounds: null });
    }
    slots.push({ squares, glow: null, holes: null, bounds: null });
  }
  for (const slot of slots) {
    slot.glow = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    layers.ground.add(slot.glow);
  }
  for (const slot of slots) {
    slot.holes = scene.add.graphics().setVisible(false);
    layers.ground.add(slot.holes);
  }
  return slots;
}

function floorColor(color) {
  if (color === 'lot') return PALETTE.lot;
  if (color === 'plaza') return PALETTE.plaza;
  return PALETTE.paintWhite;
}

// A painted road arrow: a shaft and a head, turned to its heading.
function drawArrow(g, mark) {
  const { arrowLength: length, arrowWidth: width } = WORLD;
  const fx = Math.sin(mark.heading);
  const fy = -Math.cos(mark.heading);
  const rx = -fy;
  const ry = fx;
  const at = (along, across) => [mark.x + fx * along + rx * across, mark.y + fy * along + ry * across];
  const shaft = width * 0.17;
  const neck = length * 0.12;
  const [a, b, c, d] = [at(-length / 2, -shaft), at(-length / 2, shaft), at(neck, shaft), at(neck, -shaft)];
  const [tip, left, right] = [at(length / 2, 0), at(neck, -width / 2), at(neck, width / 2)];
  g.fillStyle(PALETTE.paintWhite, mark.alpha);
  g.fillTriangle(a[0], a[1], b[0], b[1], c[0], c[1]);
  g.fillTriangle(a[0], a[1], c[0], c[1], d[0], d[1]);
  g.fillTriangle(tip[0], tip[1], left[0], left[1], right[0], right[1]);
}

function propKey(model, heading) {
  return `prop:${model}:${Math.round(heading / DEG)}:${projection.key}`;
}


// Screen box around a world rectangle (all four corners projected).
function projectedBox(x0, y0, x1, y1) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]) {
    projection.toScreen(x, y, 0, screen);
    box.x0 = Math.min(box.x0, screen.x);
    box.y0 = Math.min(box.y0, screen.y);
    box.x1 = Math.max(box.x1, screen.x);
    box.y1 = Math.max(box.y1, screen.y);
  }
  return box;
}
