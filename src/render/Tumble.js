import { TUMBLE } from '../config/tuning.js';
import { degToRad, lerp } from '../utils/math.js';

// How a wrecked car is thrown about, as plain numbers (no Phaser). This is drawing only: on the flat
// map a wreck stays where the physics puts it, and nothing here feeds back into the simulation.
//
// The blast lifts the car, turns it a little and drops it, and it bounces once. It stays the same solid car all
// the way: turning it picks another drawing of the model, and it is never flattened to fake a roll.
export class Tumble {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.time = 0;
    this.z = 0; // height above the road (world units)
    this.spin = 0; // how far it has turned (radians); it keeps this once it lands
    this.tilt = 0; // lean on screen while it is up (radians)
    this.targetSpin = 0;
    this.tiltSide = 1;
    this.hop = 0;
    this.bounce = 0;
  }

  // random: returns 0..1.
  start(random) {
    this.reset();
    this.active = true;
    this.hop = lerp(TUMBLE.hopMin, TUMBLE.hopMax, random());
    this.bounce = this.hop * TUMBLE.bounceShare;
    this.targetSpin = (random() * 2 - 1) * TUMBLE.spin;
    this.tiltSide = random() < 0.5 ? -1 : 1;
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const air = Math.min(1, this.time / TUMBLE.airSeconds);
    const late = Math.min(1, Math.max(0, (this.time - TUMBLE.airSeconds) / TUMBLE.bounceSeconds));
    this.spin = this.targetSpin * (1 - (1 - air) * (1 - air));
    this.z = late > 0 ? this.bounce * 4 * late * (1 - late) : this.hop * 4 * air * (1 - air);
    this.tilt = (this.tiltSide * degToRad(TUMBLE.tiltDeg) * this.z) / this.hop;
    if (late >= 1) {
      this.z = 0;
      this.tilt = 0;
      this.active = false;
    }
  }
}

// Where the near lip of a hole is, on screen, in line with a point sx across the screen: anything
// that has dropped below this line is hidden by the road. outline: the hole's edge in world units.
// Returns Infinity if the hole doesn't reach that far across.
export function holeLipY(outline, sx, proj) {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  let lip = -Infinity;
  for (let i = 0; i < outline.length; i += 1) {
    proj.toScreen(outline[i].x, outline[i].y, 0, a);
    const next = outline[(i + 1) % outline.length];
    proj.toScreen(next.x, next.y, 0, b);
    if ((a.x <= sx && b.x >= sx) || (b.x <= sx && a.x >= sx)) {
      const span = b.x - a.x;
      const y = span === 0 ? Math.max(a.y, b.y) : a.y + ((sx - a.x) / span) * (b.y - a.y);
      lip = Math.max(lip, y);
    }
  }
  return lip === -Infinity ? Infinity : lip;
}

// One step of a flying debris chunk { x, y, z, vx, vy, vz, spin, angle }: it arcs under gravity and bounces
// when it lands. Friction with the road takes speed in proportion to how hard the piece is pressed against it
// (grip x the push of the road), so a hard landing stops it far more than a light touch.
export function stepChunk(chunk, dt, gravity, bounce, grip) {
  chunk.vz -= gravity * dt;
  chunk.x += chunk.vx * dt;
  chunk.y += chunk.vy * dt;
  chunk.z += chunk.vz * dt;
  chunk.angle += chunk.spin * dt;
  if (chunk.z <= 0) {
    chunk.z = 0;
    const impact = Math.max(0, -chunk.vz);
    chunk.vz = impact * bounce;
    if (chunk.vz < 30) chunk.vz = 0;
    const speed = Math.hypot(chunk.vx, chunk.vy);
    if (speed > 0) {
      const keep = Math.max(0, speed - grip * (impact + chunk.vz)) / speed;
      chunk.vx *= keep;
      chunk.vy *= keep;
      chunk.spin *= keep;
    }
  }
}

const TURN = Math.PI * 2;

// Turns a flying piece over. { tumble, tumbleSpeed, z, vx, vy, tire }. In the air it keeps turning. On the road it
// settles: a panel onto one flat side; a tire stands up and rolls while it has the speed, then falls over.
export function stepChunkTurn(chunk, dt, rollSpeed = 70) {
  if (chunk.z > 0) {
    chunk.tumble += chunk.tumbleSpeed * dt;
    return;
  }
  const rolling = chunk.tire && Math.hypot(chunk.vx, chunk.vy) > rollSpeed;
  // Lying flat means a whole number of half turns; standing, an odd number of quarter turns.
  const target = rolling ? (Math.round((chunk.tumble - TURN / 4) / (TURN / 2)) * TURN) / 2 + TURN / 4 : (Math.round(chunk.tumble / (TURN / 2)) * TURN) / 2;
  chunk.tumble += (target - chunk.tumble) * Math.min(1, dt * 12);
}

// Which of a sheet's drawings shows a piece at this point of its turn.
export function chunkPose(tumble, poses) {
  return ((Math.round((tumble / TURN) * poses) % poses) + poses) % poses;
}

// One step of a car's little bounce after a knock { z, v }: up, down, and a smaller bounce or two.
export function stepHop(hop, dt, gravity, bounce) {
  hop.v -= gravity * dt;
  hop.z += hop.v * dt;
  if (hop.z <= 0) {
    hop.z = 0;
    hop.v = -hop.v * bounce;
    if (hop.v < 30) hop.v = 0;
  }
}
