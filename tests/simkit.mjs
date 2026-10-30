// Shared helpers for the Node simulation tests: a camera stand-in and a simple bot driver.
const SRC = new URL('../src', import.meta.url).href;
export const { ChaseSimulation } = await import(`${SRC}/systems/ChaseSimulation.js`);
export const { buildLayout } = await import(`${SRC}/systems/WorldLayout.js`);
export const { Car } = await import(`${SRC}/entities/Car.js`);
export const T = await import(`${SRC}/config/tuning.js`);
export const { projection } = await import(`${SRC}/render/projection.js`);
export const { CameraRig } = await import(`${SRC}/render/CameraRig.js`);
export const { isOnScreen, difficultyAt } = await import(`${SRC}/systems/SpawnSystem.js`);
export const CS = await import(`${SRC}/systems/CollisionSystem.js`);
export const { createRng } = await import(`${SRC}/utils/math.js`);

export const SCREENS = {
  portrait: { w: 780, h: 1688 },
  landscape: { w: 1280, h: 720 },
  desktop: { w: 1600, h: 900 },
};

// Camera stand-in: the game's own CameraRig, without the drawing.
export class Camera {
  constructor(screen) {
    const zoom = Math.min(screen.w, screen.h) / T.VIEW.shortSideWorldUnits;
    this.baseHalfW = screen.w / zoom / 2;
    this.baseHalfH = screen.h / zoom / 2;
    this.rig = new CameraRig();
    this.rig.reset(T.START.x, T.START.y);
    this.view = { cx: 0, cy: 0, halfW: this.baseHalfW, halfH: this.baseHalfH };
    this.p = { x: 0, y: 0 };
  }
  snap(car) {
    this.rig.reset(car.x, car.y);
  }
  follow(car, dt) {
    this.rig.update(car, dt, this.baseHalfW, this.baseHalfH);
    projection.toScreen(this.rig.x, this.rig.y, 0, this.p);
    this.view.cx = this.p.x;
    this.view.cy = this.p.y;
    this.view.halfW = this.baseHalfW / this.rig.zoom;
    this.view.halfH = this.baseHalfH / this.rig.zoom;
    return this.view;
  }
}

function cloneCar(src) {
  const c = new Car(src.handling);
  Object.assign(c, { x: src.x, y: src.y, heading: src.heading, vx: src.vx, vy: src.vy, angularVelocity: src.angularVelocity, grip: src.grip, forwardSpeed: src.forwardSpeed, lateralSpeed: src.lateralSpeed });
  return c;
}

// A simple driver: every 0.1 s it tries left / straight / right for 0.7 s ahead and picks the
// option that stays clear of props and police longest. Much worse than a person, but steady.
export class Bot {
  constructor(seed, skill = 1) {
    this.rng = createRng(seed);
    this.steer = 0;
    this.timer = 0;
    this.skill = skill; // 1 = looks 0.7 s ahead; lower = shorter sight
  }
  decide(sim, dt) {
    this.timer -= dt;
    if (this.timer > 0) return this.steer;
    this.timer = 0.1;
    const horizon = 0.7 * this.skill;
    let best = -Infinity;
    let choice = 0;
    for (const steer of [-1, 0, 1]) {
      const car = cloneCar(sim.player);
      let score = 0;
      let t = 0;
      let ok = true;
      while (t < horizon && ok) {
        car.stepFor(steer, 0.05, 1 / 120);
        t += 0.05;
        if (!sim.world.isClear(car.x, car.y, 30, 10)) ok = false;
        for (const p of sim.police) {
          if (!p.active) continue;
          const px = p.model.x + p.model.vx * t;
          const py = p.model.y + p.model.vy * t;
          if (Math.hypot(px - car.x, py - car.y) < 70) ok = false;
        }
      }
      score = t * 10 + (steer === this.steer ? 0.3 : 0) + this.rng() * 0.2;
      // Prefer staying near the middle of the arena.
      score -= Math.hypot(car.x - 3000, car.y - 3000) / 4000;
      if (score > best) {
        best = score;
        choice = steer;
      }
    }
    this.steer = choice;
    return choice;
  }
}

// Runs one game. Returns the summary plus fairness data.
export function playRun(sim, { seed, screen = SCREENS.portrait, maxSeconds = 240, skill = 1, dt = 1 / 60, onStep } = {}) {
  sim.reset(seed);
  const cam = new Camera(screen);
  const bot = new Bot(seed * 7 + 1, skill);
  const spawns = [];
  const crashInfo = { cause: null, policeAge: null };
  let wall = 0;
  let simSeconds = 0;
  let maxAlive = 0;
  let activatePending = false;
  const t0 = process.hrtime.bigint();
  while (sim.state === 'running' && sim.time < maxSeconds) {
    const view = cam.follow(sim.player, dt);
    const steer = bot.decide(sim, dt);
    // The bot uses its shockwave as soon as 3 police are close.
    if (sim.powerUps.held) {
      const close = sim.police.filter((p) => p.alive && Math.hypot(p.model.x - sim.player.x, p.model.y - sim.player.y) < 250).length;
      activatePending = close >= 3;
    }
    const events = sim.step(dt, { steer, activatePowerUp: activatePending }, view);
    activatePending = false;
    simSeconds += dt;
    for (const e of events) {
      if (e.type === 'spawn') {
        spawns.push({
          onScreen: isOnScreen(e.x, e.y, view, 0),
          distance: Math.hypot(e.x - sim.player.x, e.y - sim.player.y),
        });
      }
      if (e.type === 'crash') crashInfo.cause = e.cause;
    }
    if (onStep) onStep(sim, events, view);
    maxAlive = Math.max(maxAlive, sim.alivePolice);
    wall += 1;
  }
  // Which police caused the crash, and how long had it been on the map?
  if (crashInfo.cause === 'police') {
    let nearest = null;
    let nd = Infinity;
    for (const p of sim.police) {
      if (!p.active) continue;
      const d = Math.hypot(p.model.x - sim.player.x, p.model.y - sim.player.y);
      if (d < nd) {
        nd = d;
        nearest = p;
      }
    }
    crashInfo.policeAge = nearest ? nearest.age : null;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ...sim.stats.summary(), cause: crashInfo.cause || 'timeout', policeAge: crashInfo.policeAge, spawns, maxAlive, msPerSimSecond: ms / Math.max(1e-6, simSeconds), steps: wall };
}

export function newSim() {
  const layout = buildLayout();
  return new ChaseSimulation({ layout, handling: T.HANDLING_PRESETS[T.DEFAULT_HANDLING_PRESET] });
}
