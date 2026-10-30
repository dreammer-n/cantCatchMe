import { TUMBLE } from '../config/tuning.js';
import { lerp } from '../utils/math.js';

// How a wrecked car is thrown about, as plain numbers (no Phaser). This is drawing only: on the flat
// map a wreck stays where the physics puts it, and nothing here feeds back into the simulation.
//
// The car leaves the ground, rolls over and lands, on its roof or back on its wheels, then bounces once.
export class Tumble {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.time = 0;
    this.z = 0; // height above the road (world units)
    this.roll = 0; // radians about the car's length: 0 = on its wheels, PI = on its roof
    this.spin = 0; // extra turn on screen (radians)
    this.targetRoll = 0;
    this.targetSpin = 0;
    this.hop = 0;
    this.bounce = 0;
  }

  // random: returns 0..1.
  start(random) {
    this.reset();
    this.active = true;
    this.hop = lerp(TUMBLE.hopMin, TUMBLE.hopMax, random());
    this.bounce = this.hop * TUMBLE.bounceShare;
    const halfTurns = random() < TUMBLE.roofChance ? 1 : 2;
    this.targetRoll = Math.PI * halfTurns * (random() < 0.5 ? -1 : 1);
    this.targetSpin = (random() * 2 - 1) * TUMBLE.spin;
  }

  get upsideDown() {
    return Math.cos(this.roll) < 0;
  }

  // How flat the drawing looks mid-roll: 1 on its wheels or roof, thinnest when side-on.
  get squash() {
    return Math.max(TUMBLE.minSquash, Math.abs(Math.cos(this.roll)));
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const air = Math.min(1, this.time / TUMBLE.airSeconds);
    const late = Math.min(1, Math.max(0, (this.time - TUMBLE.airSeconds) / TUMBLE.bounceSeconds));
    this.roll = this.targetRoll * air;
    this.spin = this.targetSpin * (1 - (1 - air) * (1 - air));
    this.z = late > 0 ? this.bounce * 4 * late * (1 - late) : this.hop * 4 * air * (1 - air);
    if (late >= 1) {
      this.z = 0;
      this.active = false;
    }
  }
}

// One step of a flying debris chunk { x, y, z, vx, vy, vz, spin, angle }: it arcs under gravity,
// bounces when it lands, and scrapes to a stop along the road.
export function stepChunk(chunk, dt, gravity, bounce, scrape) {
  chunk.vz -= gravity * dt;
  chunk.x += chunk.vx * dt;
  chunk.y += chunk.vy * dt;
  chunk.z += chunk.vz * dt;
  chunk.angle += chunk.spin * dt;
  if (chunk.z <= 0) {
    chunk.z = 0;
    chunk.vz = Math.abs(chunk.vz) * bounce;
    if (chunk.vz < 18) chunk.vz = 0;
    const keep = Math.exp(-scrape * dt);
    chunk.vx *= keep;
    chunk.vy *= keep;
    chunk.spin *= keep;
  }
}
