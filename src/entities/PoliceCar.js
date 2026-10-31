import { Car } from './Car.js';
import { BEARCAT, COLLISION, FREEZE, POLICE_HANDLING, ROADBLOCK, SPAWN } from '../config/tuning.js';

// One police car: the shared driving model plus pursuit state. No drawing here; the game scene
// attaches a CarView while the car is on the map (`view`). Objects are reused (pooled).
//
// States: 'idle' (in the pool), 'chasing', 'wreck' (burnt out, an obstacle for a few seconds).
// Roles: 'chaser' (follows the player), 'interceptor' (aims where the player is going),
// 'bearcat' (a heavy SWAT truck) or 'roadblock' (parked across a crossing; never moves unless something
// hits it).
export class PoliceCar {
  constructor(id) {
    this.id = id;
    this.handling = { ...POLICE_HANDLING };
    this.model = new Car(this.handling);
    this.state = 'idle';
    this.role = 'chaser';
    this.view = null;
  }

  get alive() {
    return this.state === 'chasing';
  }

  get active() {
    return this.state !== 'idle';
  }

  get parked() {
    return this.role === 'roadblock';
  }

  get armored() {
    return this.role === 'bearcat';
  }

  get baseMass() {
    if (this.armored) return BEARCAT.mass;
    return this.parked ? ROADBLOCK.mass : 1;
  }

  // launchShare: how fast it is already going, as a share of its top speed.
  // reaction: multiplies its time between decisions (lower = sharper).
  spawn(x, y, heading, { role, speedFactor, turnDeg, aimSide, launchShare = SPAWN.speedMin, reaction = 1 }) {
    this.handling.topSpeed = POLICE_HANDLING.topSpeed * speedFactor;
    this.handling.maxTurnRateDeg = turnDeg;
    const armored = role === 'bearcat';
    this.handling.acceleration = armored ? BEARCAT.acceleration : POLICE_HANDLING.acceleration;
    this.handling.steerResponse = armored ? BEARCAT.steerResponse : POLICE_HANDLING.steerResponse;
    this.handling.gripStraight = armored ? BEARCAT.gripStraight : POLICE_HANDLING.gripStraight;
    this.handling.gripTurning = armored ? BEARCAT.gripTurning : POLICE_HANDLING.gripTurning;
    this.model.reset(x, y, heading);
    this.model.launch(this.handling.topSpeed * launchShare);
    this.state = 'chasing';
    this.role = role;
    this.model.mass = this.baseMass;
    this.model.scale = armored ? BEARCAT.scale : 1;
    this.model.scaleTarget = this.model.scale;
    this.model.plowing = armored;
    this.reaction = reaction;
    this.frozen = 0; // seconds of being frozen solid left
    this.burning = 0; // seconds until it explodes, once on fire
    this.burnSteer = 0; // on fire, it locks over one way and spins out
    this.aimSide = aimSide; // -1..1: which side of the player this car aims for
    this.retarget = 0;
    this.targetX = x;
    this.targetY = y;
    this.steer = 0;
    this.avoid = 0;
    this.age = 0;
    this.stuckTime = 0;
    this.nearArmed = false;
    this.nearCooldown = 0;
    this.lastTouch = -10; // run time of the last contact with the player
    this.wreckTime = 0;
    this.cause = null;
  }

  freeze(seconds) {
    this.frozen = seconds;
    this.model.mass = FREEZE.mass;
  }

  thaw() {
    this.frozen = 0;
    this.model.mass = this.baseMass;
  }

  ignite(seconds, steer) {
    this.burning = seconds;
    this.burnSteer = steer;
  }

  wreck(cause) {
    this.frozen = 0;
    this.burning = 0;
    this.model.plowing = false;
    this.state = 'wreck';
    this.cause = cause;
    this.wreckTime = 0;
    this.model.mass = COLLISION.wreckMass;
  }

  release() {
    this.state = 'idle';
  }
}
