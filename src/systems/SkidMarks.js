import { SKIDS } from '../config/tuning.js';

// Tire marks left while cars slide. A fixed pool of short strips is reused (oldest first),
// so the number of marks can never grow past SKIDS.maxMarks.
export class SkidMarks {
  // parent: the ground-layer container, so marks lie flat on the tilted ground.
  constructor(scene, parent) {
    this.scene = scene;
    this.parent = parent;
    this.marks = [];
    this.next = 0;
    this.trackEnds = []; // last mark position per tire, or null when that tire isn't marking
  }

  // Call each frame for each tire. trackIndex identifies the tire.
  addPoint(trackIndex, x, y, skidding) {
    if (!skidding) {
      this.trackEnds[trackIndex] = null;
      return;
    }
    const last = this.trackEnds[trackIndex];
    if (!last) {
      this.trackEnds[trackIndex] = { x, y };
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    const length = Math.hypot(dx, dy);
    if (length < SKIDS.minSegmentLength) return;

    const mark = this.takeMark();
    mark.setPosition((x + last.x) / 2, (y + last.y) / 2);
    mark.setSize(length + 1, SKIDS.width); // +1 avoids hairline gaps between strips (stays centred)
    mark.setRotation(Math.atan2(dy, dx));
    mark.setAlpha(SKIDS.alpha).setVisible(true);
    mark.age = 0;
    last.x = x;
    last.y = y;
  }

  takeMark() {
    if (this.marks.length < SKIDS.maxMarks) {
      const mark = this.scene.add.rectangle(0, 0, 1, 1, SKIDS.color);
      this.parent.add(mark);
      this.marks.push(mark);
      return mark;
    }
    const mark = this.marks[this.next];
    this.next = (this.next + 1) % SKIDS.maxMarks;
    return mark;
  }

  // Removes every mark (new run).
  clear() {
    for (const mark of this.marks) mark.setVisible(false);
    this.trackEnds.length = 0;
  }

  update(deltaMs) {
    for (const mark of this.marks) {
      if (!mark.visible) continue;
      mark.age += deltaMs;
      if (mark.age >= SKIDS.lifetimeMs) mark.setVisible(false);
      else mark.setAlpha(SKIDS.alpha * (1 - mark.age / SKIDS.lifetimeMs));
    }
  }

  get activeCount() {
    let count = 0;
    for (const mark of this.marks) if (mark.visible) count += 1;
    return count;
  }
}
