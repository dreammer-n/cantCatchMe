import { Garage, Maps } from '../systems/ScoreSystem.js';

// Test hooks for the browser checks (window.__carChaseDebug), only with ?debug in the address and never in the
// version players get: GameScene loads this file on demand, and `npm run build` leaves it out.
export function installDebugHooks(scene) {
  const hook = () => scene.getDebugState();
  hook.scenery = () => scene.scenery.describe();
  hook.sim = () => scene.sim;
  hook.scene = () => scene;
  hook.startRun = (seed) => scene.startRun(seed);
  hook.garage = Garage;
  hook.maps = Maps;
  hook.spawnPolice = (x, y, heading, options) => {
    const police = scene.sim.spawnPolice(x, y, heading, { role: 'chaser', speedFactor: 1.1, turnDeg: 125, aimSide: 0, ...options });
    scene.acquireView(police, scene.lookFor(police));
    return police.id;
  };
  hook.teleport = (x, y, heading = 0, freeze = false) => {
    const car = scene.sim.player;
    car.reset(x, y, heading);
    car.launch(car.handling.topSpeed);
    scene.snapCamera();
    scene.playerView.update(car, scene.view, 0);
    if (freeze) scene.scene.pause();
  };
  hook.unfreeze = () => scene.scene.resume();
  hook.crash = (cause = 'obstacle') => {
    scene.sim.crashPlayer(cause);
    scene.sim.runExplosions();
    scene.handleEvents(scene.sim.events.splice(0));
  };
  hook.scenes = () => scene.game.scene.getScenes(true).map((s) => s.scene.key);
  hook.sceneInfo = (key) => {
    const other = scene.scene.get(key);
    return { now: other.time.now, readyAt: other.readyAt, active: other.scene.isActive() };
  };
  hook.perf = installPerfProbe(scene.game);
  window.__carChaseDebug = hook;
}

// Average time the game spends per frame (update + draw submission) and the number of draw calls sent to the
// graphics card. Draw calls are the main cost on phones.
function installPerfProbe(game) {
  if (game.perfProbe) return game.perfProbe;
  const samples = [];
  let start = 0;
  let calls = 0;
  let lastCalls = 0;
  const gl = game.renderer.gl;
  if (gl) {
    for (const name of ['drawArrays', 'drawElements']) {
      const original = gl[name].bind(gl);
      gl[name] = (...args) => {
        calls += 1;
        return original(...args);
      };
    }
  }
  game.events.on('prestep', () => {
    start = performance.now();
    calls = 0;
  });
  game.events.on('postrender', () => {
    samples.push(performance.now() - start);
    if (samples.length > 120) samples.shift();
    lastCalls = calls;
  });
  game.perfProbe = () => ({
    frameMs: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
    drawCalls: lastCalls,
  });
  return game.perfProbe;
}
