import { CHUNKS } from '../config/tuning.js';
import { chunkCoord } from './WorldLayout.js';

// Keeps the grid of chunks around the player loaded: as the player crosses into a new chunk, the
// ones now out of range give their collision shapes back and new ones come in ahead. Pure logic,
// no Phaser; render/Scenery.js watches `active` and `version` and draws whatever is loaded.
export class ChunkManager {
  constructor(layout, world) {
    this.layout = layout;
    this.world = world;
    this.active = new Map(); // "cx,cy" -> { key, cx, cy, data, shapes, cones }
    this.cones = []; // every breakable prop in the loaded chunks
    this.cx = null;
    this.cy = null;
    this.version = 0; // goes up whenever the set of loaded chunks changes
  }

  // Returns true if the set of loaded chunks changed.
  update(x, y) {
    const cx = chunkCoord(x);
    const cy = chunkCoord(y);
    if (cx === this.cx && cy === this.cy) return false;
    this.cx = cx;
    this.cy = cy;
    const r = CHUNKS.activeRadius;
    for (const [key, chunk] of this.active) {
      if (Math.abs(chunk.cx - cx) > r || Math.abs(chunk.cy - cy) > r) this.unload(key, chunk);
    }
    for (let j = cy - r; j <= cy + r; j += 1) {
      for (let i = cx - r; i <= cx + r; i += 1) {
        const key = `${i},${j}`;
        if (!this.active.has(key)) this.load(key, i, j);
      }
    }
    this.cones = [];
    for (const chunk of this.active.values()) for (const cone of chunk.cones) this.cones.push(cone);
    this.version += 1;
    return true;
  }

  load(key, cx, cy) {
    const data = this.layout.chunkAt(cx, cy);
    const shapes = [];
    const cones = [];
    for (const item of data.voids) shapes.push(this.world.add(item));
    for (const item of data.items) {
      if (!item.collider) continue;
      const shape = this.world.add(item);
      shapes.push(shape);
      if (item.breakable) {
        const cone = { item, shape };
        resetCone(cone);
        shape.cone = cone;
        cones.push(cone);
      }
    }
    this.active.set(key, { key, cx, cy, data, shapes, cones });
  }

  unload(key, chunk) {
    for (const shape of chunk.shapes) this.world.remove(shape);
    this.active.delete(key);
  }

  // A solid prop flattened by the Giant car: it now behaves like a breakable one, until it comes back.
  makeBreakable(shape) {
    const chunk = this.active.get(`${chunkCoord(shape.x)},${chunkCoord(shape.y)}`);
    if (!chunk) return null;
    const cone = { item: shape.item, shape, wasSolid: true };
    resetCone(cone);
    shape.cone = cone;
    chunk.cones.push(cone);
    this.cones.push(cone);
    return cone;
  }

  // Is this point on a loaded chunk?
  contains(x, y) {
    const r = CHUNKS.activeRadius;
    return Math.abs(chunkCoord(x) - this.cx) <= r && Math.abs(chunkCoord(y) - this.cy) <= r;
  }
}

// Breakable props: standing where the layout put them until a car touches one.
export function resetCone(cone) {
  cone.state = 'standing';
  cone.x = cone.item.x;
  cone.y = cone.item.y;
  cone.vx = 0;
  cone.vy = 0;
  cone.angle = 0;
  cone.spin = 0;
  cone.timer = 0;
  cone.flySeconds = 0;
  cone.hop = 0;
  if (cone.wasSolid) cone.shape.solid = true;
}
