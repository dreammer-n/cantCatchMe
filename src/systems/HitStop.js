import { HITSTOP } from '../config/tuning.js';

// A tiny freeze of the action when something big happens: the arcade "punch". Works in real
// milliseconds, so it is the same length at any frame rate. The cooldown stops a pile-up in a swarm
// from turning into constant stutter. Pure logic; the game scene simply skips the simulation
// while update() says it is frozen.
export class HitStop {
  constructor() {
    this.reset();
  }

  reset() {
    this.remaining = 0;
    this.cooldown = 0;
    this.fresh = false;
  }

  // Returns true if the freeze started (false while still cooling down from the last one).
  trigger(ms) {
    if (this.cooldown > 0) return false;
    this.remaining = ms;
    this.fresh = true;
    this.cooldown = HITSTOP.cooldownMs;
    return true;
  }

  // Call once a frame. Returns true if this frame is frozen. The first frame always is, so a slow
  // device whose frames last longer than the freeze still gets its punch.
  update(ms) {
    this.cooldown = Math.max(0, this.cooldown - ms);
    if (this.remaining <= 0) return false;
    this.remaining -= ms;
    if (this.fresh) {
      this.fresh = false;
      return true;
    }
    return this.remaining > 0;
  }
}
