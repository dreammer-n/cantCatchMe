import { Car } from '../entities/Car.js';
import { PoliceCar } from '../entities/PoliceCar.js';
import { COLLISION, CONES, CRASH, EXPLOSION, NEAR_MISS, PHYSICS, POLICE, START, WRECK } from '../config/tuning.js';
import { createRng } from '../utils/math.js';
import { CAR_REACH, StaticWorld, collideCars, collideWithWorld } from './CollisionSystem.js';
import { steerPolice } from './PoliceAI.js';
import { PowerUps } from './PowerUpSystem.js';
import { RunStats } from './ScoreSystem.js';
import { SpawnDirector, isOnScreen } from './SpawnSystem.js';

// One chase, as pure game logic (no Phaser, no drawing, no sound), so it can be tested and
// tuned in plain JavaScript. The game scene calls step() every frame and turns the returned
// events (wrecks, crashes, pickups ...) into effects and sounds.
//
// Run states: 'running' -> 'crashed' (the player's car is wrecked; police keep moving).
const MAX_SUBSTEP = 1 / 60;

export class ChaseSimulation {
  constructor({ layout, handling }) {
    this.layout = layout;
    this.world = new StaticWorld(layout.items);
    this.player = new Car(handling);
    this.playerBody = { model: this.player, isPlayer: true };
    this.police = [];
    this.bodies = []; // player + police on the map, kept sorted by x for the collision sweep
    this.spawner = new SpawnDirector();
    this.powerUps = new PowerUps();
    this.stats = new RunStats();
    this.events = [];
    this.result = { impact: 0, shape: null };
    this.explosions = [];
    this.touchingCar = null;
    this.onConeTouch = (shape) => this.knockCone(shape, this.touchingCar);

    const coneShapes = new Map(this.world.shapes.filter((s) => !s.solid).map((s) => [s.item, s]));
    this.cones = layout.cones.map((item) => ({ item, shape: coneShapes.get(item), x: item.x, y: item.y, angle: 0 }));
    this.reset(1);
  }

  reset(seed) {
    this.rng = createRng(seed);
    this.time = 0;
    this.state = 'running';
    this.crash = null;
    this.pinnedTime = 0;
    this.player.reset(START.x, START.y, 0);
    this.player.mass = COLLISION.playerMass;
    for (const police of this.police) police.release();
    this.bodies.length = 0;
    this.bodies.push(this.playerBody);
    for (const cone of this.cones) this.resetCone(cone);
    this.spawner.reset();
    this.powerUps.reset();
    this.stats.reset();
    this.events.length = 0;
  }

  emit(type, data) {
    data.type = type;
    this.events.push(data);
    return data;
  }

  get alivePolice() {
    let count = 0;
    for (const police of this.police) if (police.alive) count += 1;
    return count;
  }

  get activeCars() {
    return this.bodies.length - 1;
  }

  // input: { steer, activatePowerUp }. view: { cx, cy, halfW, halfH } (camera, screen units).
  // Returns this frame's events (the array is reused next frame).
  step(frameSeconds, input, view) {
    this.events.length = 0;
    const count = Math.max(1, Math.ceil(frameSeconds / MAX_SUBSTEP));
    const dt = frameSeconds / count;
    if (input.activatePowerUp && this.state === 'running') this.powerUps.activate(this);
    for (let i = 0; i < count; i += 1) this.substep(dt, input.steer, view);
    return this.events;
  }

  substep(dt, steer, view) {
    const running = this.state === 'running';
    const player = this.player;

    // 1. Driving.
    if (running) player.stepFor(steer, dt, PHYSICS.maxStepSeconds);
    else player.slide(dt, WRECK.friction, WRECK.spinFriction);
    for (const police of this.police) {
      if (police.alive) {
        steerPolice(police, player, dt, this.rng, this.world);
        police.model.stepFor(police.steer, dt, PHYSICS.maxStepSeconds);
        police.age += dt;
      } else if (police.state === 'wreck') {
        police.model.slide(dt, WRECK.friction, WRECK.spinFriction);
        police.wreckTime += dt;
      }
    }

    // 2. Cars against props and the arena edge.
    this.touchingCar = player;
    collideWithWorld(player, this.world, this.result, this.onConeTouch);
    if (running) {
      if (this.result.impact > CRASH.playerImpact) this.crashPlayer(this.result.shape === 'wall' ? 'wall' : 'obstacle');
      else if (this.result.impact > 60) this.emit('bump', { x: player.x, y: player.y, impact: this.result.impact, player: true });
    }
    for (const police of this.police) {
      if (!police.active) continue;
      this.touchingCar = police.model;
      collideWithWorld(police.model, this.world, this.result, this.onConeTouch);
      if (police.alive && this.result.impact > CRASH.policeObstacleImpact) this.wreckPolice(police, 'obstacle');
    }

    // 3. Cars against each other (sweep along x: only neighbours are tested).
    this.collideBodies();
    this.runExplosions();

    // 4. Rules that look at the whole run.
    if (this.state === 'running') {
      this.time += dt;
      this.stats.time = this.time;
      this.stats.distance += player.speed * dt;
      this.checkPinned(dt);
      this.checkNearMisses(dt);
      this.powerUps.update(this, dt);
      this.spawner.update(this, dt, view);
    }
    this.stats.update(dt);
    this.updatePoliceLife(dt, view);
    this.updateCones(dt);
  }

  collideBodies() {
    const bodies = this.bodies;
    // Insertion sort: the order barely changes between steps, so this is nearly free.
    for (let i = 1; i < bodies.length; i += 1) {
      const body = bodies[i];
      let j = i - 1;
      while (j >= 0 && bodies[j].model.x > body.model.x) {
        bodies[j + 1] = bodies[j];
        j -= 1;
      }
      bodies[j + 1] = body;
    }
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j];
        if (b.model.x - a.model.x > CAR_REACH) break;
        if (Math.abs(b.model.y - a.model.y) > CAR_REACH) continue;
        const impact = collideCars(a.model, b.model);
        if (impact > 0) this.onCarsTouch(a, b, impact);
      }
    }
  }

  onCarsTouch(a, b, impact) {
    if (a.isPlayer || b.isPlayer) {
      const police = a.isPlayer ? b : a;
      police.lastTouch = this.time;
      police.nearArmed = false;
      if (this.state !== 'running') return;
      if (impact > CRASH.playerImpact) {
        this.crashPlayer(police.alive ? 'police' : 'wreck');
        if (police.alive && impact > CRASH.policeCarImpact) this.wreckPolice(police, 'player');
      } else if (impact > 40) {
        this.emit('bump', { x: this.player.x, y: this.player.y, impact, player: true });
      }
      return;
    }
    if (impact <= CRASH.policeCarImpact) return;
    if (a.alive && b.alive) {
      this.wreckPolice(a, 'police');
      this.wreckPolice(b, 'police');
    } else if (a.alive) {
      this.wreckPolice(a, 'wreck');
    } else if (b.alive) {
      this.wreckPolice(b, 'wreck');
    }
  }

  crashPlayer(cause) {
    if (this.state !== 'running') return;
    const player = this.player;
    this.state = 'crashed';
    player.mass = COLLISION.wreckMass;
    this.crash = { cause, x: player.x, y: player.y, time: this.time };
    this.emit('crash', { cause, x: player.x, y: player.y });
    this.explosions.push({ x: player.x, y: player.y, source: this.playerBody, player: true });
  }

  // A police car is destroyed: it becomes a burning wreck, and it explodes (which can take
  // nearby police with it).
  wreckPolice(police, cause) {
    if (!police.alive) return;
    police.wreck(cause);
    const combo = this.state === 'running' ? this.stats.addWreck() : 0;
    this.emit('wreck', { police, cause, x: police.model.x, y: police.model.y, combo });
    if (combo >= 2) this.emit('combo', { count: combo, x: police.model.x, y: police.model.y });
    this.explosions.push({ x: police.model.x, y: police.model.y, source: police, player: false });
  }

  runExplosions() {
    // Each explosion can wreck nearby police, which queue their own explosions (chain reactions).
    // Every car explodes at most once, so this always ends.
    for (let i = 0; i < this.explosions.length; i += 1) {
      const blast = this.explosions[i];
      this.emit('explosion', { x: blast.x, y: blast.y, player: blast.player });
      for (const police of this.police) {
        if (!police.active || police === blast.source) continue;
        const car = police.model;
        const dx = car.x - blast.x;
        const dy = car.y - blast.y;
        const distance = Math.hypot(dx, dy);
        if (distance > EXPLOSION.radius) continue;
        if (police.alive && distance < EXPLOSION.chainRadius) {
          this.wreckPolice(police, 'explosion');
          continue;
        }
        const push = (EXPLOSION.push * (1 - distance / EXPLOSION.radius)) / car.mass;
        car.vx += (dx / Math.max(1, distance)) * push;
        car.vy += (dy / Math.max(1, distance)) * push;
      }
      if (!blast.player && this.state === 'running') {
        const dx = this.player.x - blast.x;
        const dy = this.player.y - blast.y;
        const distance = Math.hypot(dx, dy);
        if (distance < EXPLOSION.radius && distance > 1) {
          const push = EXPLOSION.push * EXPLOSION.playerPush * (1 - distance / EXPLOSION.radius);
          this.player.vx += (dx / distance) * push;
          this.player.vy += (dy / distance) * push;
        }
      }
    }
    this.explosions.length = 0;
  }

  // The Shockwave power-up: every police car close around the player is wrecked.
  shockwave(x, y, radius) {
    this.stats.shockwaves += 1;
    for (const police of this.police) {
      if (!police.active) continue;
      const car = police.model;
      const distance = Math.hypot(car.x - x, car.y - y);
      if (distance > radius) continue;
      if (police.alive) this.wreckPolice(police, 'pulse');
      const push = 260 / car.mass;
      car.vx += ((car.x - x) / Math.max(1, distance)) * push;
      car.vy += ((car.y - y) / Math.max(1, distance)) * push;
    }
    this.runExplosions();
  }

  // Boxed in by police (or stuck against something) for too long: busted.
  checkPinned(dt) {
    if (this.time < CRASH.pinnedGrace || this.player.speed >= CRASH.pinnedSpeed) {
      this.pinnedTime = 0;
      return;
    }
    this.pinnedTime += dt;
    if (this.pinnedTime > CRASH.pinnedSeconds) this.crashPlayer('pinned');
  }

  // A close call: a police car passes very close at speed without touching.
  checkNearMisses(dt) {
    const player = this.player;
    for (const police of this.police) {
      if (!police.alive) continue;
      police.nearCooldown -= dt;
      const car = police.model;
      const distance = Math.hypot(car.x - player.x, car.y - player.y);
      if (distance < NEAR_MISS.distance) {
        const relative = Math.hypot(car.vx - player.vx, car.vy - player.vy);
        if (relative > NEAR_MISS.minRelativeSpeed && police.nearCooldown <= 0 && this.time - police.lastTouch > 0.4) {
          police.nearArmed = true;
        }
      } else if (police.nearArmed && distance > NEAR_MISS.distance + 25) {
        police.nearArmed = false;
        police.nearCooldown = NEAR_MISS.cooldown;
        this.stats.nearMisses += 1;
        this.emit('nearMiss', { x: car.x, y: car.y, police });
      }
    }
  }

  // Police that are stuck, far behind or burnt out leave the map (and return to the pool).
  updatePoliceLife(dt, view) {
    const player = this.player;
    for (const police of this.police) {
      if (!police.active) continue;
      const car = police.model;
      const far = Math.hypot(car.x - player.x, car.y - player.y) > POLICE.despawnDistance;
      if (police.alive) {
        police.stuckTime = car.speed < POLICE.stuckSpeed ? police.stuckTime + dt : 0;
        const onScreen = isOnScreen(car.x, car.y, view, 60);
        if (police.stuckTime > POLICE.stuckSeconds) {
          if (onScreen) this.wreckPolice(police, 'stuck');
          else this.removePolice(police, 'despawn');
        } else if (far && !onScreen) {
          this.removePolice(police, 'despawn');
        }
      } else if (police.wreckTime > WRECK.lifetime || (far && !isOnScreen(car.x, car.y, view, 60))) {
        this.removePolice(police, 'wreckGone');
      }
    }
    if (this.explosions.length) this.runExplosions();
  }

  spawnPolice(x, y, heading, options) {
    let police = this.police.find((candidate) => !candidate.active);
    if (!police) {
      police = new PoliceCar(this.police.length);
      this.police.push(police);
    }
    police.spawn(x, y, heading, options);
    this.bodies.push(police);
    this.emit('spawn', { police, x, y });
    return police;
  }

  removePolice(police, reason) {
    police.release();
    const index = this.bodies.indexOf(police);
    if (index >= 0) this.bodies.splice(index, 1);
    this.emit(reason, { police });
  }

  isNearCar(x, y, distance) {
    for (const body of this.bodies) {
      if (Math.hypot(body.model.x - x, body.model.y - y) < distance) return true;
    }
    return false;
  }

  // Cones: knocked flying when a car touches them; back in place a while later, out of sight.
  resetCone(cone) {
    cone.state = 'standing';
    cone.x = cone.item.x;
    cone.y = cone.item.y;
    cone.vx = 0;
    cone.vy = 0;
    cone.angle = 0;
    cone.spin = 0;
    cone.timer = 0;
  }

  knockCone(shape, car) {
    const cone = this.cones.find((c) => c.shape === shape);
    if (!cone || cone.state !== 'standing') return;
    cone.state = 'flying';
    cone.timer = 0;
    const jitter = (this.rng() - 0.5) * 80;
    cone.vx = car.vx * CONES.knockSpeed + jitter;
    cone.vy = car.vy * CONES.knockSpeed - jitter;
    cone.spin = (this.rng() - 0.5) * 18;
    car.vx *= CONES.slowdown;
    car.vy *= CONES.slowdown;
    this.emit('cone', { cone, x: cone.x, y: cone.y });
  }

  updateCones(dt) {
    for (const cone of this.cones) {
      if (cone.state === 'standing') continue;
      cone.timer += dt;
      if (cone.state === 'flying') {
        const keep = Math.exp(-2.5 * dt);
        cone.vx *= keep;
        cone.vy *= keep;
        cone.x += cone.vx * dt;
        cone.y += cone.vy * dt;
        cone.angle += cone.spin * dt;
        if (cone.timer > CONES.flySeconds) {
          cone.state = 'gone';
          cone.timer = 0;
        }
      } else if (cone.timer > CONES.respawnSeconds) {
        const d = Math.hypot(cone.item.x - this.player.x, cone.item.y - this.player.y);
        if (d > 1100) this.resetCone(cone);
      }
    }
  }
}
