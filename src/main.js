import * as Phaser from 'phaser';
import { DISPLAY } from './config/tuning.js';
import { getPixelRatio } from './utils/screen.js';
import { InputManager } from './systems/InputManager.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { Records } from './systems/ScoreSystem.js';
import { Settings } from './systems/Settings.js';
import { PlatformManager } from './platform/PlatformManager.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';

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

function fitCanvasToWindow(game) {
  const { ratio, width, height } = measureCanvas();
  if (game.scale.zoom !== 1 / ratio) game.scale.setZoom(1 / ratio);
  if (width !== game.scale.width || height !== game.scale.height) game.scale.resize(width, height);
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

async function start() {
  await PlatformManager.initialize();
  await Promise.all([Records.load(), Settings.load()]);

  const input = new InputManager(container);
  const audio = new AudioSystem();
  audio.setSoundOn(Settings.sound);
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
    scene: [BootScene, GameScene, UIScene, MenuScene, GameOverScene],
  });

  game.registry.set('input', input);
  game.registry.set('audio', audio);
  // Read all devices once per frame, before any scene runs.
  game.events.on(Phaser.Core.Events.PRE_STEP, () => input.update());

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
    game.loop.wake();
  });

  watchWindowSize(game);
}

start();
