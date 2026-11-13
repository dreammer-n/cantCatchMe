import * as Phaser from 'phaser';
import { DISPLAY, QUALITY } from './config/tuning.js';
import { getPixelRatio, setPixelRatioCap } from './utils/screen.js';
import { InputManager } from './systems/InputManager.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { Records, Garage, Maps } from './systems/ScoreSystem.js';
import { Settings } from './systems/Settings.js';
import { Tips } from './systems/Tips.js';
import { Missions } from './systems/Missions.js';
import { Progress } from './systems/Progress.js';
import { PlatformManager } from './platform/PlatformManager.js';
import { PerformanceSampler } from './systems/PerformanceSampler.js';
import { AutoQuality } from './systems/AutoQuality.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';
import { GarageScene } from './scenes/GarageScene.js';
import { MapScene } from './scenes/MapScene.js';

const container = document.getElementById('game');

// The canvas is drawn at real device pixels (capped) but displayed at the window's size,
// so the game stays sharp on high-density phone screens and fills any screen shape.
function measureCanvas() {
  const ratio = getPixelRatio();
  return {
    ratio,
    width: Math.max(1, Math.round(container.clientWidth * ratio)),
    height: Math.max(1, Math.round(container.clientHeight * ratio)),
  };
}

// Phaser (scale mode NONE) only writes the canvas's on-screen size when its zoom changes, so after any change the
// canvas is set to exactly the window's size here: it always fills the screen, with no bars and no stretching.
function fitCanvasToWindow(game) {
  const { ratio, width, height } = measureCanvas();
  if (width !== game.scale.width || height !== game.scale.height) game.scale.resize(width, height);
  if (game.scale.zoom !== 1 / ratio) game.scale.setZoom(1 / ratio);
  game.canvas.style.width = `${container.clientWidth}px`;
  game.canvas.style.height = `${container.clientHeight}px`;
}

function watchWindowSize(game) {
  let queued = false;
  const queueFit = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fitCanvasToWindow(game);
    });
  };
  // Covers window resizing, phone rotation, browser zoom and on-screen browser bars.
  new ResizeObserver(queueFit).observe(container);
  window.addEventListener('resize', queueFit);
}

// Loading milestones, readable in the browser's performance timeline (ccm:*): how long each step of the start takes.
const mark = (name) => performance.mark && performance.mark(`ccm:${name}`);

async function start() {
  mark('start');
  await PlatformManager.initialize();
  mark('platform');
  await Promise.all([Records.load(), Settings.load(), Garage.load(), Tips.load(), Progress.load()]);
  Progress.adopt(Garage.unlocked); // upgrades from an older save go to every car owned
  await Maps.load(); // after the records, which older saves take their first best time from
  await Missions.load(); // after the maps: a new mission may name an open map
  mark('save');
  // A weak phone keeps the level it stepped down to last time (AutoQuality).
  const quality = new AutoQuality(Settings.quality);
  setPixelRatioCap(QUALITY.levels[quality.level].pixelRatio);

  const input = new InputManager(container);
  const audio = new AudioSystem();
  audio.setSoundOn(Settings.sound);
  audio.setMusicOn(Settings.music);
  audio.setPlatformAllowed(PlatformManager.isAudioEnabled());
  PlatformManager.onAudioEnabledChange((enabled) => audio.setPlatformAllowed(enabled));
  // Browsers only allow sound after the player interacts.
  for (const type of ['pointerdown', 'keydown', 'touchend']) {
    window.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
  }

  const { ratio, width, height } = measureCanvas();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    backgroundColor: DISPLAY.backgroundColor,
    banner: false,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.NONE,
      width,
      height,
      zoom: 1 / ratio,
      expandParent: false,
      autoRound: false,
    },
    // InputManager reads every device itself; menus and HUD are HTML buttons.
    input: { keyboard: false, gamepad: false, mouse: false, touch: false },
    render: { antialias: true, powerPreference: 'high-performance' },
    audio: { noAudio: true }, // the game plays its own sound (AudioSystem); Phaser's would only slow the start
    scene: [BootScene, GameScene, UIScene, MenuScene, GarageScene, MapScene, GameOverScene],
  });

  // Phaser asks for the next frame only after a frame has run, so one error inside a frame would stop the game for
  // good, leaving a half-drawn picture (seen once on a phone). A frame that fails is skipped and the game goes on;
  // the failure is counted in the frame-rate report (PerformanceSampler) and logged once to the console.
  // game.step is wrapped before the loop starts (that waits for Phaser's own textures to load).
  const runFrame = game.step.bind(game);
  let frameErrors = 0;
  game.step = (time, delta) => {
    try {
      runFrame(time, delta);
    } catch (error) {
      frameErrors += 1;
      const sampler = game.registry.get('sampler');
      if (sampler) sampler.errors += 1;
      if (frameErrors === 1 || frameErrors % 600 === 0) console.error(`Frame failed (${frameErrors}):`, error);
    }
  };

  game.registry.set('input', input);
  game.registry.set('audio', audio);
  // Read all devices once per frame, before any scene runs.
  game.events.on(Phaser.Core.Events.PRE_STEP, () => input.update());

  // Frame timings while a run is on screen (not paused, not crashed out to a menu), sent about every 30 s of play;
  // and on a weak phone, a step down in quality when play is too slow.
  const sampler = new PerformanceSampler();
  sampler.watchErrors(game.canvas);
  sampler.quality = quality.level;
  game.registry.set('quality', QUALITY.levels[quality.level]);
  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    const world = game.scene.getScene('GameScene');
    const active = Boolean(world && world.sys.isActive() && (world.mode === 'playing' || world.mode === 'crashed'));
    const now = performance.now();
    const sample = sampler.frame(now, active);
    if (sample) PlatformManager.sendEvent('performance_sample', sample);
    const level = quality.frame(now, active);
    if (level !== null) {
      Settings.setQuality(level);
      sampler.quality = level;
      setPixelRatioCap(QUALITY.levels[level].pixelRatio);
      fitCanvasToWindow(game);
      game.registry.set('quality', QUALITY.levels[level]);
      sampler.gap(); // the resize itself is not a slow frame
      quality.gap();
    }
  });
  const gap = () => {
    sampler.gap();
    quality.gap();
  };
  game.events.on(Phaser.Core.Events.HIDDEN, gap);
  game.events.on(Phaser.Core.Events.VISIBLE, gap);
  game.registry.set('sampler', sampler);

  // Platform pause (tab hidden, YouTube pause ...) stops the whole game loop and the sound.
  // A run in progress comes back on the pause menu, so the player is never thrown straight in.
  PlatformManager.onPause(() => {
    game.events.emit('platform-pause');
    input.clear();
    audio.setPlatformPaused(true);
    game.loop.sleep();
  });
  PlatformManager.onResume(() => {
    audio.setPlatformPaused(false);
    gap();
    game.loop.wake();
  });

  watchWindowSize(game);
}

start();
