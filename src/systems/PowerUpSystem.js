import { POWERUP } from '../config/tuning.js';
import { degToRad, headingOf, lerp } from '../utils/math.js';

// The Shockwave crate (our one power-up). States:
//   no crate -> crate on the map -> held by the player -> used (shockwave) -> no crate ...
// A new crate only appears while the player isn't holding one, ahead of the player.
export class PowerUps {
  reset() {
    this.crate = { active: false, x: 0, y: 0, age: 0 };
    this.held = false;
    this.timer = POWERUP.firstAt;
  }

  update(sim, dt) {
    const crate = this.crate;
    const player = sim.player;
    if (crate.active) {
      crate.age += dt;
      const distance = Math.hypot(crate.x - player.x, crate.y - player.y);
      if (distance < POWERUP.collectRadius) {
        crate.active = false;
        this.held = true;
        sim.emit('pickup', { x: crate.x, y: crate.y });
      } else if (distance > POWERUP.despawnDistance) {
        crate.active = false;
        this.timer = 3;
        sim.emit('crateGone', {});
      }
      return;
    }
    if (this.held) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.place(sim)) {
      this.timer = POWERUP.interval;
      sim.emit('crateSpawn', { x: crate.x, y: crate.y });
    } else {
      this.timer = 1;
    }
  }

  place(sim) {
    const player = sim.player;
    const travel = Math.hypot(player.vx, player.vy) > 1 ? headingOf(player.vx, player.vy) : player.heading;
    for (let i = 0; i < POWERUP.attempts; i += 1) {
      const heading = travel + (sim.rng() * 2 - 1) * degToRad(POWERUP.aheadAngleDeg);
      const distance = lerp(POWERUP.minDistance, POWERUP.maxDistance, sim.rng());
      const x = player.x + Math.sin(heading) * distance;
      const y = player.y - Math.cos(heading) * distance;
      if (sim.world.isClear(x, y, POWERUP.clearance)) {
        Object.assign(this.crate, { active: true, x, y, age: 0 });
        return true;
      }
    }
    return false;
  }

  // Uses the held Shockwave. Returns true if one was used.
  activate(sim) {
    if (!this.held) return false;
    this.held = false;
    const player = sim.player;
    sim.emit('pulse', { x: player.x, y: player.y, radius: POWERUP.pulseRadius });
    sim.shockwave(player.x, player.y, POWERUP.pulseRadius);
    return true;
  }
}
