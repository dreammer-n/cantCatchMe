import { FLAT_TIRE } from '../config/tuning.js';
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
    this.scale = 1; // size: 1 = normal, bigger while Giant. Physics: collisions use it too
    this.scaleVelocity = 0;
    this.scaleTarget = 1;
    this.crushing = false; // Giant: nothing can hurt it, and it flattens what it touches
    this.plowing = false; // SWAT Bearcat: light props and curbs don't slow it
    this.flatTime = 0; // seconds of flat tire left
    this.flatSeconds = 0; // how long it lasts in all
    this.flatSide = 1; // the corner that has gone: -1 left, 1 right
    this.isFalling = false; // over a hole: no steering, no engine (see fall)
    this.fallProgress = 0; // 0 at the edge .. 1 fully fallen
    this.fallShape = null; // the hole it went into
  }

  setHandling(handling) {
    this.handling = handling;
  }

  // One physics step. steer: -1 left, 0 straight, 1 right (police use values in between).
  // dt in seconds (keep it small, see stepFor).
  step(steerInput, dt) {
    const h = this.handling;
    let steer = steerInput;
    if (this.flatTime > 0) this.flatTime = Math.max(0, this.flatTime - dt);
    const flat = this.flatness;
    if (flat > 0) {
      // The flat corner drags the car toward it all the time, and the steering only half answers. The
      // driver can just about hold it straight against the pull, but can't turn away from it.
      const shimmy = Math.sin(this.flatTime * FLAT_TIRE.shimmyRate) * FLAT_TIRE.shimmy;
      const answer = 1 - (1 - FLAT_TIRE.steerShare) * flat;
      steer = Math.max(-1, Math.min(1, steer * answer + this.flatSide * (FLAT_TIRE.pull + shimmy) * flat));
    }
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
    const targetGrip = (h.gripStraight + (h.gripTurning - h.gripStraight) * lock) * (1 - h.slideGripLoss * slide) * (1 - (1 - FLAT_TIRE.gripShare) * flat);
    this.grip += (targetGrip - this.grip) * smoothFactor(h.gripChangeRate, dt);

    // Tires kill sideways motion; sliding scrubs a little forward speed, deep slides a bit more.
    lateral *= Math.exp(-this.grip * dt);
    const slip = Math.atan2(Math.abs(lateral), Math.max(1, Math.abs(forward)));
    const deepSlide = Math.min(1, Math.max(0, (slip - degToRad(h.deepSlideStartDeg)) / degToRad(h.deepSlideRangeDeg)));
    forward -= (h.slideScrub * Math.abs(lateral) + h.deepSlideScrub * deepSlide) * dt;

    // Engine always drives toward top speed (no brake, no reverse). Tires on a curb find little traction.
    const drive = (this.onCurb ? h.acceleration * h.curbEngineShare : h.acceleration) * (1 - (1 - FLAT_TIRE.accelShare) * flat);
    const topSpeed = h.topSpeed * (1 - (1 - FLAT_TIRE.topSpeedShare) * flat);
    if (forward < topSpeed) forward = Math.min(topSpeed, forward + drive * dt);
    else forward = topSpeed + (forward - topSpeed) * Math.exp(-h.overspeedDrag * dt);

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

  // Size follows its target on a spring: elastic on the way up, smooth on the way down.
  updateScale(dt, stiffness, damping) {
    if (this.scale === this.scaleTarget && this.scaleVelocity === 0) return;
    const shrinking = this.scaleTarget < this.scale;
    const drag = shrinking ? 2 * Math.sqrt(stiffness) : damping;
    this.scaleVelocity += ((this.scaleTarget - this.scale) * stiffness - this.scaleVelocity * drag) * dt;
    this.scale += this.scaleVelocity * dt;
    if (Math.abs(this.scale - this.scaleTarget) < 0.002 && Math.abs(this.scaleVelocity) < 0.01) {
      this.scale = this.scaleTarget;
      this.scaleVelocity = 0;
    }
  }

  // Spikes: one corner goes flat for a while, with a jolt toward it. side: -1 left, 1 right.
  puncture(seconds, side) {
    this.flatTime = seconds;
    this.flatSeconds = seconds;
    this.flatSide = side;
    this.angularVelocity += side * FLAT_TIRE.jolt * Math.min(1, Math.max(0, this.forwardSpeed) / this.handling.fullTurnSpeed);
  }

  // How flat the tire is right now: 0 fine, 1 flat. It goes quickly and comes back gradually.
  get flatness() {
    if (this.flatTime <= 0) return 0;
    return Math.min(1, (this.flatSeconds - this.flatTime) / FLAT_TIRE.attackSeconds, this.flatTime / FLAT_TIRE.releaseSeconds);
  }

  // Stopped dead: a frozen car.
  halt() {
    this.vx = 0;
    this.vy = 0;
    this.angularVelocity = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAngle = 0;
    this.chassisRoll = 0;
  }

  // The car has gone over a hole: from now on only fall() moves it.
  startFall(hole = null) {
    this.flatTime = 0;
    this.isFalling = true;
    this.fallShape = hole;
    this.fallProgress = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAngle = 0;
    this.chassisRoll = 0;
    this.onCurb = false;
  }

  // No engine, no steering: it carries its speed across the hole while it drops. The drop itself is only
  // drawn (CarView reads fallProgress); on the flat map the car just stays in the hole.
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
