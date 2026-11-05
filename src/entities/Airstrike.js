import { AIRSTRIKE } from '../config/tuning.js';
import { headingOf, lerp } from '../utils/math.js';

// The jet airstrike, as pure logic (no Phaser; render/JetView.js draws it). From AIRSTRIKE.firstAt into a run,
// now and then, a jet bombs a line across the road ahead of the car. Red circles mark every spot first. The line
// crosses the car's path at a slant, to one side of where the car is heading, so there is always a way out.
//
// A strike goes: 'warning' (the circles show, the jet comes in) -> the bombs land one after another -> 'done'.
// Each bomb wrecks police inside its blast, and the player too unless Giant, a ghost or armoured.
export class Airstrike {
  constructor() {
    this.bombs = Array.from({ length: AIRSTRIKE.bombs }, () => ({ x: 0, y: 0, landAt: 0, landed: false }));
    this.reset();
  }

  reset() {
    this.active = false;
    this.time = 0;
    this.nextAt = AIRSTRIKE.firstAt;
    this.dirX = 1; // the jet's line, as a unit vector
    this.dirY = 0;
    this.heading = 0;
    for (const bomb of this.bombs) bomb.landed = false;
  }

  // Where the jet is now (drawing): it passes over each bomb as it falls, on a straight line.
  jetPosition(out) {
    const first = this.bombs[0];
    const speed = AIRSTRIKE.spacing / AIRSTRIKE.bombGap;
    const along = (this.time - (first.landAt - AIRSTRIKE.fallSeconds)) * speed;
    out.x = first.x + this.dirX * along;
    out.y = first.y + this.dirY * along;
    return out;
  }

  update(sim, dt) {
    if (!this.active) {
      if (sim.state === 'running' && sim.time >= this.nextAt) this.start(sim);
      return;
    }
    this.time += dt;
    for (const bomb of this.bombs) {
      if (!bomb.landed && this.time >= bomb.landAt) {
        bomb.landed = true;
        sim.bombLands(bomb.x, bomb.y);
      }
    }
    if (this.time >= this.bombs[this.bombs.length - 1].landAt + AIRSTRIKE.leaveSeconds) {
      this.active = false;
      this.nextAt = sim.time + lerp(AIRSTRIKE.everyMin, AIRSTRIKE.everyMax, sim.rng());
    }
  }

  start(sim) {
    const player = sim.player;
    const speed = Math.max(AIRSTRIKE.minTargetSpeed, player.speed);
    const travel = player.speed > 1 ? headingOf(player.vx, player.vy) : player.heading;
    const fx = Math.sin(travel);
    const fy = -Math.cos(travel);
    // Where the car will be, and a point beside it: the line runs through that point at a slant.
    const side = sim.rng() < 0.5 ? -1 : 1;
    const ahead = speed * (AIRSTRIKE.warningSeconds + AIRSTRIKE.aheadSeconds);
    const offset = side * lerp(AIRSTRIKE.sideMin, AIRSTRIKE.sideMax, sim.rng());
    const cx = player.x + fx * ahead - fy * offset;
    const cy = player.y + fy * ahead + fx * offset;
    // The line: the car's way, turned by the slant toward that side.
    const lineHeading = travel + side * AIRSTRIKE.slant;
    this.dirX = Math.sin(lineHeading);
    this.dirY = -Math.cos(lineHeading);
    this.heading = lineHeading;
    const count = this.bombs.length;
    this.bombs.forEach((bomb, i) => {
      const along = (i - (count - 1) / 2) * AIRSTRIKE.spacing;
      bomb.x = cx + this.dirX * along;
      bomb.y = cy + this.dirY * along;
      bomb.landAt = AIRSTRIKE.warningSeconds + i * AIRSTRIKE.bombGap;
      bomb.landed = false;
    });
    this.active = true;
    this.time = 0;
    sim.emit('airstrike', { x: cx, y: cy });
  }
}
