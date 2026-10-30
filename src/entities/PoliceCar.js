import { Car } from './Car.js';
import { COLLISION, POLICE_HANDLING } from '../config/tuning.js';

// One police car: the shared driving model plus pursuit state. No drawing here; the game scene
// attaches a CarView while the car is on the map (`view`). Objects are reused (pooled).
//
// States: 'idle' (in the pool), 'chasing', 'wreck' (burnt out, an obstacle for a few seconds).
// Roles: 'chaser' (follows the player) or 'interceptor' (aims where the player is going).
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

  spawn(x, y, heading, { role, speedFactor, turnDeg, aimSide }) {
    this.handling.topSpeed = POLICE_HANDLING.topSpeed * speedFactor;
    this.handling.maxTurnRateDeg = turnDeg;
    this.model.reset(x, y, heading);
    this.model.launch(this.handling.topSpeed * 0.85);
    this.model.mass = 1;
    this.state = 'chasing';
    this.role = role;
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

  wreck(cause) {
    this.state = 'wreck';
    this.cause = cause;
    this.wreckTime = 0;
    this.model.mass = COLLISION.wreckMass;
  }

  release() {
    this.state = 'idle';
  }
}
