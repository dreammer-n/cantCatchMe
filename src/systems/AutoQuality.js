// Keeps play smooth on weak phones. While a run is on screen it times the frames; after QUALITY.checkMs of play,
// if the typical frame (the median, so one-off hitches don't count) came slower than QUALITY.minFps, it moves
// down one level (less sharp, then fewer particles) and measures again, down to the last level. A phone that
// keeps up is never touched. Pure: the caller passes the time and says whether play is active, then applies the
// level it hands back.
import { QUALITY } from '../config/tuning.js';

const KEPT = 2048; // frame times kept for the median (8 s at 240 Hz fits)

export class AutoQuality {
  constructor(level = 0) {
    this.level = Math.min(Math.max(0, level), QUALITY.levels.length - 1);
    this.times = new Float32Array(KEPT);
    this.last = null;
    this.reset();
  }

  reset() {
    this.ms = 0;
    this.frames = 0;
  }

  // Play stopped for a moment (paused, hidden, a menu): the gap is not a frame.
  gap() {
    this.last = null;
  }

  // Once a frame. Returns the new level when the game should step down, otherwise null.
  frame(now, active) {
    if (!active) {
      this.last = null;
      return null;
    }
    if (this.last !== null) {
      const ms = now - this.last;
      this.ms += ms;
      if (this.frames < KEPT) this.times[this.frames] = ms;
      this.frames += 1;
    }
    this.last = now;
    if (this.ms < QUALITY.checkMs) return null;
    const kept = Math.min(this.frames, KEPT);
    const median = this.times.slice(0, kept).sort()[Math.floor(kept / 2)];
    this.reset();
    if (median <= 1000 / QUALITY.minFps || this.level >= QUALITY.levels.length - 1) return null;
    this.level += 1;
    return this.level;
  }
}
