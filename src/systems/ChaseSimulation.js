import { Car } from '../entities/Car.js';
import { Helicopter } from '../entities/Helicopter.js';
import { PoliceCar } from '../entities/PoliceCar.js';
import { BEARCAT, COLLISION, CONES, CRASH, EXPLOSION, FLAT_TIRE, FREEZE, GIANT, NEAR_MISS, PHYSICS, PILLARS, POLICE, ROADBLOCK, START, VOID, WRECK } from '../config/tuning.js';
import { createRng } from '../utils/math.js';
import { ChunkManager, resetCone } from './ChunkManager.js';
import { CAR_REACH, StaticWorld, carContact, collideCars, collideWithWorld, keepInsideHole } from './CollisionSystem.js';
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
    this.world = new StaticWorld();
    this.chunks = new ChunkManager(layout, this.world);
    this.player = new Car(handling);
    this.playerBody = { model: this.player, isPlayer: true };
    this.police = [];
    this.bodies = []; // player + police on the map, kept sorted by x for the collision sweep
    this.spawner = new SpawnDirector();
    this.powerUps = new PowerUps();
    this.helicopter = new Helicopter();
    this.shattering = [];
    this.spikeStrips = Array.from({ length: ROADBLOCK.maxSpikes }, () => ({ active: false, x: 0, y: 0, northSouth: true, time: 0, shape: null }));
    this.stats = new RunStats();
    this.events = [];
    this.result = { impact: 0, shape: null };
    this.explosions = [];
    this.touchingCar = null;
    this.onConeTouch = (shape) => this.knockCone(shape, this.touchingCar);
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
    this.chunks.update(START.x, START.y);
    for (const cone of this.cones) resetCone(cone);
    this.spawner.reset();
    this.powerUps.reset(this);
    this.helicopter.reset(this);
    for (const strip of this.spikeStrips) this.removeSpikeStrip(strip);
    this.stats.reset();
    this.events.length = 0;
  }

  // Every breakable prop on the loaded chunks.
  get cones() {
    return this.chunks.cones;
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

  // Police actually chasing the player: not parked roadblocks. This is what HEAT.police counts.
  get pursuers() {
    let count = 0;
    for (const police of this.police) if (police.alive && !police.parked) count += 1;
    return count;
  }

  get bearcats() {
    let count = 0;
    for (const police of this.police) if (police.alive && police.armored) count += 1;
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
    if (input.activatePowerUp && this.state === 'running' && !this.player.isFalling) this.powerUps.activate(this);
    for (let i = 0; i < count; i += 1) this.substep(dt, input.steer, view);
    return this.events;
  }

  substep(dt, steer, view) {
    const running = this.state === 'running';
    const player = this.player;

    // 1. Driving.
    if (player.isFalling) {
      player.fall(dt, VOID.fallSeconds, VOID.fallFriction);
      keepInsideHole(player, VOID.fallInset);
    } else if (running) player.stepFor(steer, dt, PHYSICS.maxStepSeconds);
    else player.slide(dt, WRECK.friction, WRECK.spinFriction);
    this.chunks.update(player.x, player.y);
    this.powerUps.tick(this, dt);
    this.helicopter.update(this, dt);
    for (const police of this.police) {
      if (police.alive) {
        this.drivePolice(police, dt);
      } else if (police.state === 'wreck') {
        if (police.model.isFalling) {
          police.model.fall(dt, VOID.fallSeconds, VOID.fallFriction);
          keepInsideHole(police.model, VOID.fallInset);
        } else {
          police.model.slide(dt, WRECK.friction, WRECK.spinFriction);
        }
        police.wreckTime += dt;
      }
    }

    // 2. Cars against props and holes.
    if (player.isFalling) {
      if (running && player.fallProgress >= 1) this.crashPlayer('void');
    } else {
      this.collidePlayerWithWorld(running);
    }
    for (const police of this.police) {
      if (!police.active || police.model.isFalling) continue;
      this.touchingCar = police.model;
      collideWithWorld(police.model, this.world, this.result, this.onConeTouch);
      if (this.result.voidShape) {
        police.model.startFall(this.result.voidShape);
        this.wreckPolice(police, 'void');
      } else if (police.alive && this.result.impact > this.obstacleLimit(police, this.result.shape)) {
        this.wreckPolice(police, 'obstacle');
      }
    }

    // 3. Cars against each other (sweep along x: only neighbours are tested).
    this.collideBodies();
    this.runExplosions();

    // 4. Rules that look at the whole run. A falling player's clock has stopped.
    if (this.state === 'running' && !player.isFalling) {
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
    this.updateCones(dt, view);
    this.updateSpikeStrips(dt, view);
  }

  drivePolice(police, dt) {
    const car = police.model;
    const burning = police.burning > 0;
    if (police.frozen > 0) {
      car.halt();
      police.frozen -= dt;
      if (police.frozen <= 0) police.thaw();
    } else if (police.parked) {
      car.slide(dt, WRECK.friction, WRECK.spinFriction);
    } else if (burning) {
      car.stepFor(police.burnSteer, dt, PHYSICS.maxStepSeconds);
    } else {
      steerPolice(police, this.player, dt, this.rng, this.world);
      car.stepFor(police.steer, dt, PHYSICS.maxStepSeconds);
    }
    police.age += dt;
    if (burning) {
      police.burning -= dt;
      if (police.burning <= 0) this.wreckPolice(police, 'fire');
    }
  }

  collidePlayerWithWorld(running) {
    const player = this.player;
    this.touchingCar = player;
    collideWithWorld(player, this.world, this.result, this.onConeTouch);
    if (!running) return;
    if (this.result.voidShape) {
      player.startFall(this.result.voidShape);
      this.emit('fall', { x: player.x, y: player.y });
      return;
    }
    if (this.result.spikes && player.flatTime <= 0) {
      player.puncture(FLAT_TIRE.seconds, this.rng() < 0.5 ? -1 : 1);
      this.emit('flat', { x: player.x, y: player.y });
    }
    if (this.result.impact > CRASH.playerImpact) this.crashPlayer('obstacle');
    else if (this.result.impact > 60) this.emit('bump', { x: player.x, y: player.y, impact: this.result.impact, player: true });
    else if (this.result.impact > CRASH.scrapeImpact) this.emit('scrape', { x: player.x, y: player.y, impact: this.result.impact });
    if (this.result.curbHit) this.emit('curb', { x: player.x, y: player.y });
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
    const player = this.player;
    // The largest two cars there can be: a Giant player and a Bearcat, or two Bearcats.
    const reach = (CAR_REACH * (Math.max(player.scale, BEARCAT.scale) + BEARCAT.scale)) / 2;
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i];
      if (a.model.isFalling) continue;
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j];
        if (b.model.x - a.model.x > reach) break;
        if (b.model.isFalling || Math.abs(b.model.y - a.model.y) > reach) continue;
        const ice = this.frozenAgainstPlayer(a, b);
        const { vx, vy, heading, angularVelocity } = player;
        const impact = collideCars(a.model, b.model);
        if (carContact.touched && player.crushing && (a.isPlayer || b.isPlayer)) {
          this.crush(a.isPlayer ? b : a);
        } else if (ice && impact > FREEZE.shatterImpact) {
          // The ice gives way, so the player doesn't bounce off it: undo the collision's shove.
          player.vx = vx * FREEZE.shatterKeep;
          player.vy = vy * FREEZE.shatterKeep;
          player.heading = heading;
          player.angularVelocity = angularVelocity;
          this.shattering.push(ice);
        } else if (impact > 0) {
          this.onCarsTouch(a, b, impact);
        }
      }
    }
    // Removed after the loop, which is still walking the list of bodies.
    while (this.shattering.length) this.shatter(this.shattering.pop());
  }

  // The frozen police car in this pair, if the other one is the player, in a run still going.
  frozenAgainstPlayer(a, b) {
    if (this.state !== 'running') return null;
    if (a.isPlayer) return b.alive && b.frozen > 0 ? b : null;
    if (b.isPlayer) return a.alive && a.frozen > 0 ? a : null;
    return null;
  }

  // A frozen police car smashed to bits. No wreck is left in the way and nothing explodes.
  shatter(police) {
    const { x, y } = police.model;
    police.wreck('shatter');
    const combo = this.stats.addWreck();
    this.emit('shatter', { x, y, combo });
    if (combo >= 2) this.emit('combo', { count: combo, x, y });
    this.removePolice(police, 'wreckGone');
  }

  // The Giant car flattens any police car it touches, and throws it clear.
  crush(police) {
    if (!police.alive) return;
    const car = police.model;
    const dx = car.x - this.player.x;
    const dy = car.y - this.player.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    car.vx += (dx / distance) * GIANT.crushFling;
    car.vy += (dy / distance) * GIANT.crushFling;
    this.emit('crush', { x: car.x, y: car.y });
    this.wreckPolice(police, 'giant');
  }

  onCarsTouch(a, b, impact) {
    if (a.isPlayer || b.isPlayer) {
      const police = a.isPlayer ? b : a;
      police.lastTouch = this.time;
      police.nearArmed = false;
      if (this.state !== 'running') return;
      if (police.alive && police.armored && police.frozen <= 0 && impact > BEARCAT.fatalImpact) {
        this.crashPlayer('bearcat');
      } else if (impact > CRASH.playerImpact) {
        if (!police.alive) this.crashPlayer('wreck');
        else this.crashPlayer(police.parked ? 'roadblock' : 'police');
        if (police.alive && impact > CRASH.policeCarImpact) this.wreckPolice(police, 'player');
      } else if (impact > 40) {
        this.emit('bump', { x: this.player.x, y: this.player.y, impact, player: true });
      }
      return;
    }
    if (impact <= CRASH.policeCarImpact) return;
    // A Bearcat shrugs off all but the hardest hits. Whatever hits it comes off worse.
    const hard = impact > BEARCAT.carImpact;
    if (a.alive && (!a.armored || hard)) this.wreckPolice(a, b.alive ? 'police' : 'wreck');
    if (b.alive && (!b.armored || hard)) this.wreckPolice(b, a.alive ? 'police' : 'wreck');
  }

  crashPlayer(cause) {
    if (this.state !== 'running') return;
    const player = this.player;
    this.state = 'crashed';
    player.crushing = false;
    player.flatTime = 0;
    player.mass = COLLISION.wreckMass;
    this.crash = { cause, x: player.x, y: player.y, time: this.time };
    if (cause !== 'void') this.throwWreck(player);
    this.emit('crash', { cause, x: player.x, y: player.y });
    if (cause !== 'void') this.explosions.push({ x: player.x, y: player.y, source: this.playerBody, player: true });
  }

  // A police car is destroyed: it becomes a burning wreck, and it explodes (which can take
  // nearby police with it). One that fell into a hole just drops out of sight, and still counts.
  wreckPolice(police, cause) {
    if (!police.alive) return;
    police.wreck(cause);
    if (cause !== 'void') this.throwWreck(police.model);
    const combo = this.state === 'running' ? this.stats.addWreck() : 0;
    this.emit('wreck', { police, cause, x: police.model.x, y: police.model.y, combo });
    if (combo >= 2) this.emit('combo', { count: combo, x: police.model.x, y: police.model.y });
    if (cause !== 'void') this.explosions.push({ x: police.model.x, y: police.model.y, source: police, player: false });
  }

  // A wreck doesn't just stop: it is shoved and spun, and slides to rest.
  throwWreck(car) {
    const angle = this.rng() * Math.PI * 2;
    car.vx += Math.cos(angle) * WRECK.kick;
    car.vy += Math.sin(angle) * WRECK.kick;
    car.angularVelocity += (this.rng() * 2 - 1) * WRECK.spinKick;
  }

  runExplosions() {
    // Each explosion can wreck nearby police, which queue their own explosions (chain reactions).
    // Every car explodes at most once, so this always ends.
    for (let i = 0; i < this.explosions.length; i += 1) {
      const blast = this.explosions[i];
      this.emit('explosion', { x: blast.x, y: blast.y, player: blast.player });
      for (const police of this.police) {
        if (!police.active || police === blast.source || police.model.isFalling) continue;
        const car = police.model;
        const dx = car.x - blast.x;
        const dy = car.y - blast.y;
        const distance = Math.hypot(dx, dy);
        if (distance > EXPLOSION.radius) continue;
        if (police.alive && !police.armored && distance < EXPLOSION.chainRadius) {
          this.wreckPolice(police, 'explosion');
          continue;
        }
        const push = (EXPLOSION.push * (1 - distance / EXPLOSION.radius)) / car.mass;
        car.vx += (dx / Math.max(1, distance)) * push;
        car.vy += (dy / Math.max(1, distance)) * push;
      }
      if (!blast.player && this.state === 'running' && !this.player.isFalling && !this.player.crushing) {
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
      if (!police.active || police.model.isFalling) continue;
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

  // How hard a police car must hit this prop to be wrecked. Pillars are deadly; Bearcats are tough.
  obstacleLimit(police, shape) {
    if (shape && shape.item.isPillar) return PILLARS.lethalImpact;
    return police.armored ? BEARCAT.obstacleImpact : CRASH.policeObstacleImpact;
  }

  // ---- Spike strips, laid across roadblocks ----------------------------------------------------

  addSpikeStrip(x, y, northSouth) {
    const strip = this.spikeStrips.find((candidate) => !candidate.active);
    if (!strip) return;
    strip.active = true;
    strip.x = x;
    strip.y = y;
    strip.northSouth = northSouth;
    strip.time = 0;
    strip.shape = this.world.add({
      kind: 'spikes',
      isSpikes: true,
      x,
      y,
      heading: northSouth ? 0 : Math.PI / 2,
      collider: { type: 'box', hw: ROADBLOCK.spikeHalfLength, hl: ROADBLOCK.spikeHalfDepth },
      breakable: false,
    });
  }

  removeSpikeStrip(strip) {
    if (strip.shape) this.world.remove(strip.shape);
    strip.shape = null;
    strip.active = false;
  }

  updateSpikeStrips(dt, view) {
    for (const strip of this.spikeStrips) {
      if (!strip.active) continue;
      strip.time += dt;
      const offScreen = !isOnScreen(strip.x, strip.y, view, 100);
      if (offScreen && (strip.time > ROADBLOCK.spikeSeconds || !this.chunks.contains(strip.x, strip.y))) this.removeSpikeStrip(strip);
    }
  }

  // The Freeze power-up: every police car close around the player stops dead.
  freezePolice(x, y, radius, seconds) {
    for (const police of this.police) {
      if (!police.alive || police.model.isFalling) continue;
      if (Math.hypot(police.model.x - x, police.model.y - y) <= radius) police.freeze(seconds);
    }
  }

  // Boxed in by police (or stuck against something) for too long: busted.
  checkPinned(dt) {
    if (this.time < CRASH.pinnedGrace || this.player.speed >= CRASH.pinnedSpeed || this.player.crushing) {
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

  // Police that are stuck, left behind on an unloaded chunk or burnt out leave the map (and return
  // to the pool). Those that finished falling into a hole too.
  updatePoliceLife(dt, view) {
    for (const police of this.police) {
      if (!police.active) continue;
      const car = police.model;
      if (car.isFalling) {
        if (car.fallProgress >= 1) this.removePolice(police, 'wreckGone');
        continue;
      }
      const far = !this.chunks.contains(car.x, car.y);
      if (police.alive) {
        police.stuckTime = !police.parked && police.frozen <= 0 && car.speed < POLICE.stuckSpeed ? police.stuckTime + dt : 0;
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

  // Breakable props: knocked flying when a car touches them; back in place a while later, out of sight.
  knockCone(shape, car) {
    if (shape.item.isPillar) {
      this.powerUps.crumblePillar(this, shape.item.pillar);
      return;
    }
    if (shape.item.isDrop) {
      this.helicopter.crumble(this, shape.item.drop);
      return;
    }
    const cone = shape.cone || this.chunks.makeBreakable(shape);
    if (!cone || cone.state !== 'standing') return;
    cone.state = 'flying';
    cone.timer = 0;
    if (cone.wasSolid) shape.solid = false;
    const feel = cone.wasSolid ? CONES.kinds.crushed : CONES.kinds[cone.item.kind] || CONES;
    cone.flySeconds = feel.flySeconds || CONES.flySeconds;
    cone.hop = feel.hop || CONES.hop;
    const jitter = (this.rng() - 0.5) * 80;
    cone.vx = car.vx * feel.knockSpeed + jitter;
    cone.vy = car.vy * feel.knockSpeed - jitter;
    if (feel.sideKick) {
      // Shoved off to whichever side of the car's path it was on, so it clears the way.
      const speed = Math.max(1, Math.hypot(car.vx, car.vy));
      const rightX = -car.vy / speed;
      const rightY = car.vx / speed;
      const side = (cone.x - car.x) * rightX + (cone.y - car.y) * rightY < 0 ? -1 : 1;
      cone.vx += rightX * side * feel.sideKick;
      cone.vy += rightY * side * feel.sideKick;
    }
    cone.spin = (this.rng() - 0.5) * feel.spin;
    if (!car.plowing) {
      car.vx *= feel.slowdown;
      car.vy *= feel.slowdown;
    }
    this.emit('cone', { cone, x: cone.x, y: cone.y, player: car === this.player });
  }

  updateCones(dt, view) {
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
        if (cone.timer > cone.flySeconds) {
          cone.state = 'gone';
          cone.timer = 0;
        }
      } else if (cone.timer > CONES.respawnSeconds && !isOnScreen(cone.item.x, cone.item.y, view, 100)) {
        resetCone(cone);
      }
    }
  }
}
