import * as Phaser from 'phaser';
import { ARENA, CONES, DEPTH, PALETTE, RENDER, SCENERY, START, WORLD } from '../config/tuning.js';
import { createRng } from '../utils/math.js';
import { depthAt } from './layers.js';
import { bakeMesh } from './lowpoly.js';
import { projection } from './projection.js';
import { LAMP_REACH, barrier, concreteBlock, island, lampPost, leafyTree, pineTree, trafficCone } from './propModels.js';

const DEG = Math.PI / 180;
const screen = { x: 0, y: 0 };
const CULL_MARGIN = 40;

// Draws the arena from the shared layout (systems/WorldLayout.js):
//   floor   painted asphalt in the ground layer (world coordinates), split into squares so the
//           squares off screen are skipped;
//   props   low-poly models drawn once per camera setup into images, depth-sorted by where they
//           stand, hidden while off screen.
// Cones are the only props that move (knocked flying); the simulation tells us where they are.
export class Scenery {
  constructor(scene, layers, layout) {
    this.scene = scene;
    this.items = layout.items.map((item) => ({ ...item, source: item, mesh: meshFor(item) }));
    this.bySource = new Map(this.items.map((item) => [item.source, item]));
    for (const item of this.items) {
      item.shadow = scene.add.image(0, 0, '__DEFAULT').setAlpha(RENDER.shadowAlpha);
      item.body = scene.add.image(0, 0, '__DEFAULT');
      item.bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
    }
    this.buildFloor(layers, layout);
    this.redraw();
  }

  // Called at start and whenever the camera setup changes: redraws each prop for the new view.
  redraw() {
    const scale = 1 / RENDER.bakeScale;
    for (const item of this.items) {
      const key = `prop:${item.model}:${Math.round(item.heading / DEG)}:${projection.key}`;
      const body = bakeMesh(this.scene, key, item.mesh, item.heading, projection, 'body');
      const shadow = bakeMesh(this.scene, `${key}:shadow`, item.mesh, item.heading, projection, 'shadow');
      item.body.setTexture(body.key).setOrigin(body.originX, body.originY).setScale(scale);
      item.shadow.setTexture(shadow.key).setOrigin(shadow.originX, shadow.originY).setScale(scale);
      this.place(item, item.x, item.y, 0);
      item.body.setDepth(this.depthFor(item));
      item.shadow.setDepth(item.band === 'raised' ? DEPTH.raised - 1 : DEPTH.shadows);
    }
    for (const chunk of this.chunks) chunk.bounds = projectedBox(chunk.x0, chunk.y0, chunk.x1, chunk.y1);
  }

  place(item, x, y, lift) {
    projection.toScreen(x, y, 0, screen);
    item.shadow.setPosition(screen.x, screen.y);
    item.body.setPosition(screen.x, screen.y - lift * projection.lift);
    // Screen box around body and shadow, for culling.
    const b = item.bounds;
    b.x0 = Infinity;
    b.y0 = Infinity;
    b.x1 = -Infinity;
    b.y1 = -Infinity;
    for (const image of [item.body, item.shadow]) {
      const w = image.width * image.scaleX;
      const h = image.height * image.scaleY;
      const left = image.x - image.originX * w;
      const top = image.y - image.originY * h;
      b.x0 = Math.min(b.x0, left);
      b.y0 = Math.min(b.y0, top);
      b.x1 = Math.max(b.x1, left + w);
      b.y1 = Math.max(b.y1, top + h);
    }
  }

  depthFor(item) {
    if (item.band === 'raised') return DEPTH.raised;
    if (item.band === 'wall') {
      // Arena edges: the walls on the far side are always behind everything inside the arena,
      // the near-side walls always in front. So long walls never sort wrongly against cars.
      const towardViewer = item.normal.x * projection.sinA + item.normal.y * projection.cosA;
      return towardViewer > 1e-6 ? DEPTH.effects - 10 : DEPTH.objects - 100;
    }
    return depthAt(item.x, item.y);
  }

  // view: the camera's visible rectangle (camera.worldView). Hides everything outside it.
  cull(view) {
    const x0 = view.x - CULL_MARGIN;
    const y0 = view.y - CULL_MARGIN;
    const x1 = view.right + CULL_MARGIN;
    const y1 = view.bottom + CULL_MARGIN;
    for (const item of this.items) {
      if (item.gone) continue;
      const b = item.bounds;
      const visible = b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
      if (item.body.visible !== visible) {
        item.body.setVisible(visible);
        item.shadow.setVisible(visible);
      }
    }
    for (const chunk of this.chunks) {
      const b = chunk.bounds;
      const visible = b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1;
      chunk.floor.setVisible(visible);
      if (chunk.glow) chunk.glow.setVisible(visible);
    }
  }

  // Moves the cones the simulation knocked over. cones: ChaseSimulation.cones.
  syncCones(cones) {
    for (const cone of cones) {
      const item = this.bySource.get(cone.item);
      if (!item) continue;
      if (cone.state === 'standing') {
        if (item.moved) {
          item.moved = false;
          item.gone = false;
          item.body.setRotation(0).setAlpha(1).setVisible(true);
          item.shadow.setAlpha(RENDER.shadowAlpha).setVisible(true);
          this.place(item, item.x, item.y, 0);
          item.body.setDepth(depthAt(item.x, item.y));
        }
        continue;
      }
      item.moved = true;
      if (cone.state === 'gone') {
        item.gone = true;
        item.body.setVisible(false);
        item.shadow.setVisible(false);
        continue;
      }
      // Flying: a hop and a spin, fading out at the end.
      const t = Math.min(1, cone.timer / CONES.flySeconds);
      this.place(item, cone.x, cone.y, Math.sin(Math.PI * Math.min(1, t * 1.6)) * 26);
      item.body.setRotation(cone.angle).setAlpha(1 - t * t).setDepth(depthAt(cone.x, cone.y));
      item.shadow.setAlpha(RENDER.shadowAlpha * (1 - t));
    }
  }

  // ------------------------------------------------------------------------------------------
  // Floor
  // ------------------------------------------------------------------------------------------

  buildFloor(layers, layout) {
    const size = SCENERY.floorChunk;
    const t = ARENA.wallThickness;
    this.chunks = [];
    for (let y = -t; y < ARENA.height + t; y += size) {
      for (let x = -t; x < ARENA.width + t; x += size) {
        const chunk = {
          x0: x,
          y0: y,
          x1: Math.min(x + size, ARENA.width + t),
          y1: Math.min(y + size, ARENA.height + t),
          floor: this.scene.add.graphics(),
          glow: null,
        };
        chunk.floor.fillStyle(PALETTE.asphalt, 1);
        // Overlap neighbours by a unit so no seam shows between squares.
        chunk.floor.fillRect(chunk.x0 - 1, chunk.y0 - 1, chunk.x1 - chunk.x0 + 2, chunk.y1 - chunk.y0 + 2);
        layers.ground.add(chunk.floor);
        this.chunks.push(chunk);
      }
    }
    const chunkAt = (x, y) => {
      const col = Math.floor((x + t) / size);
      const row = Math.floor((y + t) / size);
      const cols = Math.ceil((ARENA.width + t * 2) / size);
      return this.chunks[Math.max(0, Math.min(this.chunks.length - 1, row * cols + col))];
    };

    // Block surfaces and painted lines (stalls, crossings, lane dashes). Each rectangle is cut
    // at square borders, so a square never draws outside itself (culling stays exact).
    for (const mark of layout.paint) {
      const color = mark.color === 'lot' ? PALETTE.lot : PALETTE.paintWhite;
      for (const chunk of this.chunks) {
        const x0 = Math.max(mark.x, chunk.x0);
        const y0 = Math.max(mark.y, chunk.y0);
        const x1 = Math.min(mark.x + mark.w, chunk.x1);
        const y1 = Math.min(mark.y + mark.h, chunk.y1);
        if (x1 <= x0 || y1 <= y0) continue;
        chunk.floor.fillStyle(color, mark.alpha);
        chunk.floor.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    // Worn asphalt patches: give the eye something to track at speed.
    const random = createRng(WORLD.seed + 77);
    const cells = (ARENA.width / WORLD.cell) * (ARENA.height / WORLD.cell);
    for (let i = 0; i < cells * SCENERY.patchesPerCell; i += 1) {
      const x = 60 + random() * (ARENA.width - 120);
      const y = 60 + random() * (ARENA.height - 120);
      const r = 10 + random() * 30;
      const angle = random() * Math.PI * 2;
      const g = chunkAt(x, y).floor;
      g.fillStyle(i % 3 === 0 ? PALETTE.asphaltPatchLight : PALETTE.asphaltPatchDark, 0.8);
      const corner = (k) => [x + Math.cos(angle + k * 2.2) * r, y + Math.sin(angle + k * 2.2) * r * 0.7];
      const [a, b, c] = [corner(0), corner(1), corner(2)];
      g.fillTriangle(a[0], a[1], b[0], b[1], c[0], c[1]);
    }

    // Start ring.
    const start = chunkAt(START.x, START.y).floor;
    start.lineStyle(4, PALETTE.paintWhite, 0.35);
    start.strokeCircle(START.x, START.y, SCENERY.startMarkRadius);

    // Warm light pools under the street lamps (additive blend = glow).
    for (const item of this.items) {
      if (item.kind !== 'lamp') continue;
      const hx = item.x + Math.sin(item.heading) * LAMP_REACH;
      const hy = item.y - Math.cos(item.heading) * LAMP_REACH;
      const chunk = chunkAt(hx, hy);
      if (!chunk.glow) {
        chunk.glow = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
        layers.ground.add(chunk.glow);
      }
      chunk.glow.fillStyle(PALETTE.lampGlow, 0.13);
      chunk.glow.fillCircle(hx, hy, 115);
      chunk.glow.fillStyle(PALETTE.lampGlow, 0.15);
      chunk.glow.fillCircle(hx, hy, 65);
    }
  }

  describe() {
    return this.items.map((item) => ({ name: item.name, kind: item.kind, x: item.x, y: item.y, depth: item.body.depth, visible: item.body.visible }));
  }
}

function meshFor(item) {
  const p = item.params;
  switch (item.kind) {
    case 'wall':
      return barrier({ length: p.length, width: p.width, height: p.height });
    case 'island':
      return island(p.length);
    case 'tree':
      return p.treeKind === 'pine' ? pineTree(p.size) : leafyTree(p.size);
    case 'lamp':
      return lampPost();
    case 'block':
      return concreteBlock(p);
    case 'barrier':
      return barrier({ length: p.length });
    case 'cone':
      return trafficCone();
    default:
      throw new Error(`No model for ${item.kind}`);
  }
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
