import { degToRad, smoothFactor, wrapAngle } from '../utils/math.js';

// Arcade driving model shared by the player and (from Milestone 2) the police.
// Pure maths, no Phaser, so it can be tested on its own.
//
// Angles: heading 0 points "up" (north), positive turns clockwise, matching sprite rotation.
// The car has two directions:
//   heading  - where the nose points (steering turns this)
//   velocity - where the car is actually moving
// Steering turns the nose first; grip then pulls the velocity round to match.
// The gap between the two is the drift.
export class Car {
  constructor(handling) {
    this.handling = handling;
    this.mass = 1; // used by car-to-car collisions
    this.reset(0, 0, 0);
  }

  reset(x, y, heading) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.vx = 0;
    this.vy = 0;
    this.angularVelocity = 0;
    this.grip = this.handling.gripStraight;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
  }

  setHandling(handling) {
    this.handling = handling;
  }

  // One physics step. steer: -1 left, 0 straight, 1 right (police use values in between).
  // dt in seconds (keep it small, see stepFor).
  step(steer, dt) {
    const h = this.handling;

    // Turning needs speed: no spinning on the spot at the start.
    const turnAuthority = Math.min(1, Math.max(0, this.forwardSpeed) / h.fullTurnSpeed);
    const targetTurn = steer * degToRad(h.maxTurnRateDeg) * turnAuthority;
    this.angularVelocity += (targetTurn - this.angularVelocity) * smoothFactor(h.steerResponse, dt);
    this.heading = wrapAngle(this.heading + this.angularVelocity * dt);

    // Split velocity into "along the nose" (forward) and "sideways" (lateral) parts.
    const fx = Math.sin(this.heading);
    const fy = -Math.cos(this.heading);
    const rx = -fy;
    const ry = fx;
    let forward = this.vx * fx + this.vy * fy;
    let lateral = this.vx * rx + this.vy * ry;

    // Grip drops while steering (lets the car slide) and recovers gradually when released.
    // Part-steering (police) blends between the two; for the player (-1/0/1) it is one or the other.
    const lock = Math.min(1, Math.abs(steer));
    const targetGrip = h.gripStraight + (h.gripTurning - h.gripStraight) * lock;
    this.grip += (targetGrip - this.grip) * smoothFactor(h.gripChangeRate, dt);

    // Tyres kill sideways motion; sliding also scrubs a little forward speed.
    lateral *= Math.exp(-this.grip * dt);
    forward -= h.slideScrub * Math.abs(lateral) * dt;

    // Engine always drives toward top speed (no brake, no reverse).
    if (forward < h.topSpeed) forward = Math.min(h.topSpeed, forward + h.acceleration * dt);
    else forward = h.topSpeed + (forward - h.topSpeed) * Math.exp(-h.overspeedDrag * dt);

    this.vx = fx * forward + rx * lateral;
    this.vy = fy * forward + ry * lateral;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.forwardSpeed = forward;
    this.lateralSpeed = lateral;
  }

  // Advances by any frame time using equal small steps, so results barely depend on frame rate.
  stepFor(steer, frameSeconds, maxStep) {
    const count = Math.max(1, Math.ceil(frameSeconds / maxStep));
    const dt = frameSeconds / count;
    for (let i = 0; i < count; i += 1) this.step(steer, dt);
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  // Angle between where the nose points and where the car moves, in degrees.
  get driftAngleDeg() {
    return (Math.atan2(Math.abs(this.lateralSpeed), Math.max(1, Math.abs(this.forwardSpeed))) * 180) / Math.PI;
  }

  // A wrecked car: no engine, no steering; it slides and spins to a stop.
  slide(dt, friction, spinFriction) {
    const keep = Math.exp(-friction * dt);
    this.vx *= keep;
    this.vy *= keep;
    this.angularVelocity *= Math.exp(-spinFriction * dt);
    this.heading = wrapAngle(this.heading + this.angularVelocity * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
  }

  // Starts moving at `speed` straight ahead.
  launch(speed) {
    this.vx = Math.sin(this.heading) * speed;
    this.vy = -Math.cos(this.heading) * speed;
    this.forwardSpeed = speed;
    this.lateralSpeed = 0;
  }
}
