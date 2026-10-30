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
    this.slipAngle = 0; // radians, signed: + = moving to the right of where the nose points
    this.chassisRoll = 0; // radians, visual only: nothing in the physics reads it
    this.onCurb = false; // set by the collision system
    this.isFalling = false; // over a hole: no steering, no engine (see fall)
    this.fallProgress = 0; // 0 at the edge .. 1 fully fallen
  }

  setHandling(handling) {
    this.handling = handling;
  }

  // One physics step. steer: -1 left, 0 straight, 1 right (police use values in between).
  // dt in seconds (keep it small, see stepFor).
  step(steer, dt) {
    const h = this.handling;
    const slide = Math.min(1, Math.abs(this.lateralSpeed) / h.slideFullSlip);

    // Steering toward the direction of the slide (counter-steering) turns the nose faster.
    const counterSteer = steer * this.lateralSpeed > 0 ? slide * Math.abs(steer) : 0;

    // Turning needs speed: no spinning on the spot at the start.
    const turnAuthority = Math.min(1, Math.max(0, this.forwardSpeed) / h.fullTurnSpeed);
    const targetTurn = steer * degToRad(h.maxTurnRateDeg) * turnAuthority * (1 + h.counterSteerBonus * counterSteer);
    this.angularVelocity += (targetTurn - this.angularVelocity) * smoothFactor(h.steerResponse, dt);
    this.heading = wrapAngle(this.heading + this.angularVelocity * dt);

    // Split velocity into "along the nose" (forward) and "sideways" (lateral) parts.
    const fx = Math.sin(this.heading);
    const fy = -Math.cos(this.heading);
    const rx = -fy;
    const ry = fx;
    let forward = this.vx * fx + this.vy * fy;
    let lateral = this.vx * rx + this.vy * ry;

    // Grip drops while steering and while already sliding, and recovers gradually afterwards.
    // Part-steering (police) blends between the two; for the player (-1/0/1) it is one or the other.
    const lock = Math.min(1, Math.abs(steer));
    const targetGrip = (h.gripStraight + (h.gripTurning - h.gripStraight) * lock) * (1 - h.slideGripLoss * slide);
    this.grip += (targetGrip - this.grip) * smoothFactor(h.gripChangeRate, dt);

    // Tyres kill sideways motion; sliding scrubs a little forward speed, deep slides a bit more.
    lateral *= Math.exp(-this.grip * dt);
    const slip = Math.atan2(Math.abs(lateral), Math.max(1, Math.abs(forward)));
    const deepSlide = Math.min(1, Math.max(0, (slip - degToRad(h.deepSlideStartDeg)) / degToRad(h.deepSlideRangeDeg)));
    forward -= (h.slideScrub * Math.abs(lateral) + h.deepSlideScrub * deepSlide) * dt;

    // Engine always drives toward top speed (no brake, no reverse). Tyres on a curb find little traction.
    const drive = this.onCurb ? h.acceleration * h.curbEngineShare : h.acceleration;
    if (forward < h.topSpeed) forward = Math.min(h.topSpeed, forward + drive * dt);
    else forward = h.topSpeed + (forward - h.topSpeed) * Math.exp(-h.overspeedDrag * dt);

    this.vx = fx * forward + rx * lateral;
    this.vy = fy * forward + ry * lateral;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.forwardSpeed = forward;
    this.lateralSpeed = lateral;
    this.slipAngle = Math.atan2(lateral, forward);
    const targetRoll = Math.max(-1, Math.min(1, lateral / h.slideFullSlip)) * degToRad(h.rollMaxDeg);
    this.chassisRoll += (targetRoll - this.chassisRoll) * smoothFactor(h.rollResponse, dt);
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
    this.slipAngle = 0;
    this.chassisRoll = 0;
  }

  // The car has gone over a hole: from now on only fall() moves it.
  startFall() {
    this.isFalling = true;
    this.fallProgress = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAngle = 0;
    this.chassisRoll = 0;
    this.onCurb = false;
  }

  // No engine, no steering: momentum dies away while it drops. The drop itself is only drawn
  // (CarView reads fallProgress); on the flat map the car just stays in the hole.
  fall(dt, seconds, friction) {
    this.fallProgress = Math.min(1, this.fallProgress + dt / seconds);
    const keep = Math.exp(-friction * dt);
    this.vx *= keep;
    this.vy *= keep;
    this.heading = wrapAngle(this.heading + this.angularVelocity * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  // Starts moving at `speed` straight ahead.
  launch(speed) {
    this.vx = Math.sin(this.heading) * speed;
    this.vy = -Math.cos(this.heading) * speed;
    this.forwardSpeed = speed;
    this.lateralSpeed = 0;
  }
}
