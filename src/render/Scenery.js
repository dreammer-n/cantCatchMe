import * as Phaser from 'phaser';
import { CHUNKS, CONES, DEPTH, EFFECTS, MAPS, PALETTE, PILLARS, RENDER, ROADBLOCK, SCENERY, WORLD } from '../config/tuning.js';
import { propCatalogue } from '../systems/WorldLayout.js';
import { createRng } from '../utils/math.js';
import { depthAt } from './layers.js';
import { clipToRect, groundColor, surfacePaint } from './groundPaint.js';
import { bakeMesh, releasePropDrawings } from './lowpoly.js';
import { projection } from './projection.js';
import { LAMP_REACH, propBakeScale, propMesh } from './propModels.js';
import { groundMarksFor, paintBlob, paintDrift } from './softShapes.js';

const DEG = Math.PI / 180;
const screen = { x: 0, y: 0 };
const CULL_MARGIN = 40;
// A prop not drawn yet is taken to reach this far around its foot on screen, which covers the biggest (a gas
// station roof), so it is drawn before any part of it can come into view.
const PENDING_REACH = 420;
const CHUNK_BOX_MARGIN = 160; // lamp glows and hole edges reach a little beyond their chunk's props
const FLOOR_SQUARES = Math.round(CHUNKS.size / SCENERY.floorChunk);
const MAX_NEW_CHUNKS_IN_A_STEP = 5; // crossing a corner brings in 5; more means a restart or a jump

// Draws whatever chunks the simulation has loaded (systems/ChunkManager.js):
//   floor   painted ground in the ground layer (world coordinates), split into squares so the
//           squares off screen are skipped; soft marks and lamp light lie on top of it;
//   holes   sinkholes, drawn on top of the floor;
//   props   low-poly models drawn once at startup into images, depth-sorted by where they stand,
//           hidden while off screen.
// Nothing is created during play: floors come from one fixed set per chunk in the grid, prop images
// from a pool. Each new chunk costs a little time, so normally only one is filled in per frame:
// they arrive off screen, beyond what the camera shows.
// Breakable props are the only ones that move (knocked flying); the simulation says where they are.
export class Scenery {
  constructor(scene, layers, map = MAPS[0]) {
    this.scene = scene;
    this.map = map;
    this.meshes = new Map();
    this.items = []; // the prop on screen for each item of the loaded chunks
    this.bySource = new Map();
    this.freeProps = [];
    this.loaded = new Map(); // chunk key -> { slot, props, data }
    this.seenVersion = -1;
    this.waiting = false; // chunks still to be filled in
    this.makeMarkTextures();
    // Only the props on screen are drawn now (showProp draws each the first time); the rest of the map's come a
    // few at a time after the title is up (bakeSome).
    this.toBake = propCatalogue(this.map);
    for (let i = 0; i < CHUNKS.propPool; i += 1) this.freeProps.push(this.makeProp());
    this.freeSlots = createSlots(scene, layers);
    this.pillarProps = Array.from({ length: PILLARS.pool }, () => this.makeProp());
    this.applyPillarDrawing();
    this.spikeProps = Array.from({ length: ROADBLOCK.maxSpikes }, () => this.makeProp());
  }

  makeMarkTextures() {
    for (const [key, paint] of [['fx-blob', paintBlob], ['fx-drift', paintDrift]]) {
      if (this.scene.textures.exists(key)) continue;
      const texture = this.scene.textures.createCanvas(key, MARK_TEXTURE, MARK_TEXTURE);
      paint(texture.context, MARK_TEXTURE);
      texture.refresh();
    }
  }

  // Everything is drawn again in a new map's colours. Nothing of the old map stays on screen.
  reload(map) {
    this.map = map;
    for (const [key, entry] of this.loaded) this.unloadChunk(key, entry);
    this.items = [];
    this.seenVersion = -1;
    this.waiting = false;
    this.meshes.clear();
    releasePropDrawings(this.scene);
    this.bakeCatalogue();
    this.applyPillarDrawing();
  }

  // Draws every prop model for the current camera, once.
  bakeCatalogue() {
    for (const entry of propCatalogue(this.map)) this.bakeEntry(entry);
    this.toBake = [];
  }

  // Draws one prop model (if not drawn yet) and returns its two drawings.
  bakeEntry(entry) {
    const key = propKey(entry.model, entry.heading);
    return {
      body: bakeMesh(this.scene, key, this.meshFor(entry), entry.heading, projection, 'body', propBakeScale(entry)),
      shadow: bakeMesh(this.scene, `${key}:shadow`, this.meshFor(entry), entry.heading, projection, 'shadow'),
    };
  }

  // Draws up to `count` more of the map's props not drawn yet. Returns whether any are left.
  bakeSome(count) {
    for (let i = 0; i < count && this.toBake.length > 0; i += 1) this.bakeEntry(this.toBake.pop());
    return this.toBake.length > 0;
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
    return { body, shadow, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 }, source: null, gone: false, moved: false, pending: false };
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
      this.deferProp(prop);
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
      prop.pending = false;
      prop.body.setVisible(false).setRotation(0).setAlpha(1);
      prop.shadow.setVisible(false);
      this.freeProps.push(prop);
    }
    for (const square of entry.slot.squares) square.floor.setVisible(false);
    entry.slot.marks.setVisible(false);
    entry.slot.glow.setVisible(false);
    entry.slot.holes.setVisible(false);
    this.freeSlots.push(entry.slot);
    this.loaded.delete(key);
  }

  // A prop is only drawn once it comes near the screen (cull), so a chunk loads without drawing what nobody sees
  // yet; by then the warm-up has usually drawn its model already, and showing it is quick.
  deferProp(prop) {
    const item = prop.source;
    prop.pending = true;
    prop.body.setVisible(false);
    prop.shadow.setVisible(false);
    projection.toScreen(item.x, item.y, 0, screen);
    const b = prop.bounds;
    b.x0 = screen.x - PENDING_REACH;
    b.x1 = screen.x + PENDING_REACH;
    b.y0 = screen.y - PENDING_REACH;
    b.y1 = screen.y + PENDING_REACH;
  }

  showProp(prop) {
    const item = prop.source;
    prop.pending = false;
    const key = propKey(item.model, item.heading);
    const body = bakeMesh(this.scene, key, this.meshFor(item), item.heading, projection, 'body', propBakeScale(item));
    const shadow = bakeMesh(this.scene, `${key}:shadow`, this.meshFor(item), item.heading, projection, 'shadow');
    prop.body.setTexture(body.key).setOrigin(body.originX, body.originY).setScale(1 / body.scale);
    prop.shadow.setTexture(shadow.key).setOrigin(shadow.originX, shadow.originY).setScale(1 / shadow.scale).setAlpha(RENDER.shadowAlpha);
    this.place(prop, item.x, item.y, 0);
    if (item.band === 'overhead') prop.body.setDepth(DEPTH.effects - 2); // a roof: cars drive under it
    else prop.body.setDepth(item.band === 'raised' ? DEPTH.raised : depthAt(item.x, item.y));
    prop.shadow.setDepth(item.band === 'raised' ? DEPTH.raised - 1 : DEPTH.shadows);
  }

  // Called when the camera setup changes (debug tool): redraws everything for the new view.
  redraw() {
    this.bakeCatalogue();
    this.applyPillarDrawing();
    for (const entry of this.loaded.values()) {
      for (const prop of entry.props) this.showProp(prop);
      this.drawHoles(entry.slot, entry.data);
      this.measureSlot(entry.slot, entry.data);
    }
  }

  applyPillarDrawing() {
    const drawn = this.bakeEntry({ kind: 'pillar', model: 'pillar', heading: 0, params: {} });
    this.pillarBody = drawn.body;
    this.pillarShadow = drawn.shadow;
    for (const prop of this.pillarProps) {
      prop.body.setTexture(this.pillarBody.key).setOrigin(this.pillarBody.originX, this.pillarBody.originY);
      prop.shadow.setTexture(this.pillarShadow.key).setOrigin(this.pillarShadow.originX, this.pillarShadow.originY);
    }
  }

  // Spike strips lie flat on the road, under the cars.
  syncSpikes(strips) {
    for (let i = 0; i < strips.length; i += 1) {
      const strip = strips[i];
      const prop = this.spikeProps[i];
      if (!strip.active) {
        prop.body.setVisible(false);
        prop.shadow.setVisible(false);
        continue;
      }
      const eighth = Math.PI / 8;
      const turn = ((Math.round(strip.heading / eighth) % 8) + 8) % 8;
      const { body } = this.bakeEntry({ kind: 'spikes', model: 'spikes', heading: turn * eighth, params: {} });
      prop.body.setTexture(body.key).setOrigin(body.originX, body.originY).setScale(1 / body.scale);
      projection.toScreen(strip.x, strip.y, 0, screen);
      prop.body.setVisible(true).setPosition(screen.x, screen.y).setDepth(DEPTH.raised);
    }
  }

  // Pillars grow out of the road with a little overshoot, then sink back into it.
  syncPillars(pillars) {
    for (let i = 0; i < pillars.length; i += 1) {
      const pillar = pillars[i];
      const prop = this.pillarProps[i];
      if (!pillar.active) {
        prop.body.setVisible(false);
        prop.shadow.setVisible(false);
        continue;
      }
      let height;
      if (pillar.state === 'sinking') {
        height = Math.max(0, 1 - pillar.time / PILLARS.sinkSeconds);
      } else {
        const t = Math.min(1, pillar.time / PILLARS.riseSeconds);
        height = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // overshoots, then settles at 1
      }
      projection.toScreen(pillar.x, pillar.y, 0, screen);
      prop.body
        .setVisible(true)
        .setPosition(screen.x, screen.y)
        .setScale(1 / this.pillarBody.scale, height / this.pillarBody.scale)
        .setDepth(depthAt(pillar.x, pillar.y));
      prop.shadow
        .setVisible(true)
        .setPosition(screen.x, screen.y)
        .setScale(height / this.pillarShadow.scale)
        .setAlpha(RENDER.shadowAlpha)
        .setDepth(DEPTH.shadows);
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
      if (prop.pending) {
        if (!(b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1)) continue;
        this.showProp(prop);
      }
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
      slot.marks.setVisible(visible);
      slot.glow.setVisible(visible);
      slot.holes.setVisible(visible);
    }
  }

  // Moves the props the simulation knocked over. cones: ChaseSimulation.cones.
  syncCones(cones) {
    for (const cone of cones) {
      const prop = this.bySource.get(cone.item);
      if (!prop) continue;
      if (prop.pending) {
        if (cone.state === 'standing') continue;
        this.showProp(prop); // knocked over off screen: it needs its drawing now
      }
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
      const t = Math.min(1, cone.timer / cone.flySeconds);
      const bounces = Math.abs(Math.sin(Math.PI * t * 3)) * (1 - t) * cone.hop;
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
    const random = createRng(data.seed + 78);
    const patch = this.map.patch;
    const patches = patch ? Math.round(patch.perCell * (size / WORLD.cell) ** 2) : 0;
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
          if (mark.track) {
            if (mark.x >= x0 && mark.x < x1 && mark.y >= y0 && mark.y < y1) {
              const p = mark.pts;
              g.fillStyle(PALETTE.track, mark.alpha);
              g.fillTriangle(p[0], p[1], p[2], p[3], p[4], p[5]);
              g.fillTriangle(p[0], p[1], p[4], p[5], p[6], p[7]);
            }
            continue;
          }
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
          if (mark.poly) {
            const points = clipToRect(mark.poly, x0 - 1, y0 - 1, x1 + 1, y1 + 1);
            if (points.length === 0) continue;
            g.fillStyle(groundColor(mark), mark.alpha);
            g.fillPoints(points, true);
            continue;
          }
          const px0 = Math.max(mark.x, x0 - 1);
          const py0 = Math.max(mark.y, y0 - 1);
          const px1 = Math.min(mark.x + mark.w, x1 + 1);
          const py1 = Math.min(mark.y + mark.h, y1 + 1);
          if (px1 <= px0 || py1 <= py0) continue;
          g.fillStyle(groundColor(mark), mark.alpha);
          g.fillRect(px0, py0, px1 - px0, py1 - py0);
        }
        // Tufts of grass on the ground. Soft patches are images: see drawMarks.
        for (let i = 0; i < patches; i += 1) {
          const r = patch.size[0] + random() * (patch.size[1] - patch.size[0]);
          const x = x0 + 40 + random() * (size - 80);
          const y = y0 + 40 + random() * (size - 80);
          const color = patch.colors[i % patch.colors.length];
          if (patch.lotOnly && onRoad(x, y, r)) continue;
          g.fillStyle(PALETTE[color], patch.alpha);
          for (let blade = -2; blade <= 2; blade += 1) g.fillTriangle(x + blade * 4 - 2, y, x + blade * 4 + 2, y, x + blade * 6, y - r * (1 - Math.abs(blade) * 0.18));
        }
        square.x0 = x0;
        square.y0 = y0;
      }
    }

    this.drawMarks(slot, data);
    this.drawLampLight(slot, data);
    this.measureSlot(slot, data);
  }

  // Takes the next image from a set belonging to a chunk's floor, making it the first time it is needed.
  nextImage(list, holder, used, texture, blend) {
    let image = list[used];
    if (!image) {
      image = this.scene.add.image(0, 0, texture);
      if (blend) image.setBlendMode(blend);
      holder.add(image);
      list.push(image);
    }
    return image.setTexture(texture).setVisible(true);
  }

  // Soft patches on the ground: worn road, snowdrifts, dunes.
  drawMarks(slot, data) {
    const marks = groundMarksFor(data, this.map, CHUNKS.size, WORLD.cell, WORLD.margin);
    marks.forEach((mark, i) => {
      this.nextImage(slot.markImages, slot.marks, i, mark.drift ? 'fx-drift' : 'fx-blob')
        .setPosition(mark.x, mark.y)
        .setRotation(mark.angle)
        .setScale(mark.rx / (MARK_TEXTURE / 2), mark.ry / (MARK_TEXTURE / 2))
        .setTint(PALETTE[mark.color])
        .setAlpha(mark.alpha);
    });
    for (let i = marks.length; i < slot.markImages.length; i += 1) slot.markImages[i].setVisible(false);
  }

  // Warm light on the ground under the street lamps, fading away with no edge.
  drawLampLight(slot, data) {
    const random = createRng(data.seed + 79);
    let used = 0;
    for (const item of data.items) {
      if (item.kind !== 'lamp') continue;
      const hx = item.x + Math.sin(item.heading) * LAMP_REACH;
      const hy = item.y - Math.cos(item.heading) * LAMP_REACH;
      this.nextImage(slot.lampImages, slot.glow, used, 'fx-pool', Phaser.BlendModes.ADD)
        .setPosition(hx, hy)
        .setRotation(random() * Math.PI * 2)
        .setScale((EFFECTS.lampPoolRadius * (0.9 + random() * 0.25)) / 64)
        .setTint(PALETTE.lampGlow)
        .setAlpha(EFFECTS.lampPoolAlpha);
      used += 1;
    }
    for (let i = used; i < slot.lampImages.length; i += 1) slot.lampImages[i].setVisible(false);
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
    // Ice, soft sand and rivers first: they lie on the ground, under any hole.
    for (const shape of surfacePaint(data)) {
      g.fillStyle(shape.color, shape.alpha);
      g.fillPoints(shape.points, true);
    }
    for (const hole of data.voids) {
      if (hole.water) continue; // drawn with its river
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
// layer is drawn in the order it was added, so all floors come first, then all soft marks, then all lamp
// light together. Mixing them would cost an extra draw call per blend change.
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
    slots.push({ squares, marks: null, markImages: [], glow: null, lampImages: [], holes: null, bounds: null });
  }
  for (const slot of slots) {
    slot.marks = scene.add.container(0, 0).setVisible(false);
    layers.ground.add(slot.marks);
  }
  for (const slot of slots) {
    slot.glow = scene.add.container(0, 0).setVisible(false);
    layers.ground.add(slot.glow);
  }
  for (const slot of slots) {
    slot.holes = scene.add.graphics().setVisible(false);
    layers.ground.add(slot.holes);
  }
  return slots;
}

const MARK_TEXTURE = 128;

function onRoad(x, y, reach) {
  const margin = WORLD.margin + reach;
  return Math.abs(x - Math.round(x / WORLD.cell) * WORLD.cell) < margin || Math.abs(y - Math.round(y / WORLD.cell) * WORLD.cell) < margin;
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
