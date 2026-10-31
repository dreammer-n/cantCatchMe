import * as Phaser from 'phaser';
import { DEBUG } from '../config/debug.js';
import { COLORS, DEV_PANEL, HANDLING_PRESETS, HANDLING_PRESET_ORDER, PALETTE, POWERUP, RENDER, STORAGE_KEYS, UI, WARNING } from '../config/tuning.js';
import { DevPanel } from '../dev/DevPanel.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { findView, projection } from '../render/projection.js';
import { Records } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { Hud } from '../ui/Hud.js';
import { PauseScreen } from '../ui/Screens.js';
import { getPixelRatio, getSafeAreaInsets } from '../utils/screen.js';

const cratePoint = { x: 0, y: 0 };
const threatPoint = { x: 0, y: 0 };
const edge = { x: 0, y: 0, dx: 0, dy: 0 };

// Everything drawn over the world during a run: the HUD (HTML), the pause menu (HTML), the
// arrow pointing at an off-screen Shockwave crate and the red warning
// chevrons for police arriving from out of sight (canvas).
export class UIScene extends Phaser.Scene {
  constructor() {
    super('UIScene');
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    this.world = this.scene.get('GameScene');
    this.paused = false;
    this.touch = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    this.zones = this.add.graphics();

    this.hud = new Hud({ onPause: () => this.controls.press('pause'), onPower: () => this.controls.press('power') });
    this.pauseScreen = new PauseScreen({
      onResume: () => this.setPaused(false),
      onRestart: () => this.restartRun(),
      onMenu: () => this.toMenu(),
      onSound: () => this.toggleSound(),
    });

    const on = (name, handler) => {
      this.game.events.on(name, handler, this);
      this.events.once('shutdown', () => this.game.events.off(name, handler, this));
    };
    on('toast', (text, kind) => this.hud.toast(text, kind));
    on('power-ready', (name) => this.hud.toast(`${name} READY! - ${this.touch ? 'DOUBLE TAP' : 'SPACE'} TO USE`, 'ready', 2600));
    on('run-started', () => this.onRunStarted());
    on('run-crashed', () => this.hud.hideHint());
    on('run-over', () => this.hud.show(false));
    on('platform-pause', () => {
      if (this.world.running && !this.paused) this.setPaused(true);
    });

    if (DEBUG) this.createDevPanel();
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  onRunStarted() {
    this.setPaused(false);
    this.hud.clearToasts();
    this.hud.setBest(Records.best.time);
    this.hud.show(true);
    if (Records.totals.runs < 3) {
      this.hud.hint(this.touch ? 'Hold the left or right side to steer' : 'Steer with ← → or A D · lure the police into crashes', 4500);
    }
  }

  update(time) {
    const command = this.controls.getCommand();
    const running = this.world.running;
    if (running || this.paused) {
      if (command.pausePressed) this.setPaused(!this.paused);
      else if (this.paused && command.confirmPressed) this.setPaused(false);
      else if (command.restartPressed) this.restartRun();
    }
    const sim = this.world.sim;
    if (running || this.world.mode === 'crashed') this.hud.update(sim.stats.time, sim.stats.wrecks, running ? sim.powerUps.label : null);
    this.drawOverlay(running && !this.paused);
    if (this.devPanel && time >= this.nextReadoutAt) {
      this.nextReadoutAt = time + DEV_PANEL.readoutRefreshMs;
      this.devPanel.setReadout(this.describeRun());
    }
  }

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.scene.pause('GameScene');
      this.controls.releaseHeld();
      this.pauseScreen.show({ soundOn: Settings.sound });
      this.audio.setPaused(true);
      PlatformManager.runPaused();
    } else {
      this.scene.resume('GameScene');
      this.pauseScreen.hide();
      this.audio.setPaused(false);
      PlatformManager.runResumed();
    }
  }

  restartRun() {
    this.audio.play('click');
    if (this.paused) {
      this.paused = false;
      this.pauseScreen.hide();
      this.audio.setPaused(false);
      this.scene.resume('GameScene');
    }
    this.scene.stop('GameOverScene');
    this.world.startRun();
  }

  toMenu() {
    this.audio.play('click');
    this.setPaused(false);
    this.hud.show(false);
    this.scene.stop('GameOverScene');
    this.world.enterAttract();
    this.scene.launch('MenuScene');
  }

  toggleSound() {
    Settings.setSound(!Settings.sound);
    this.audio.setSoundOn(Settings.sound);
    this.pauseScreen.sound.setSound(Settings.sound);
  }

  // ------------------------------------------------------------------------------------------
  // Canvas overlay
  // ------------------------------------------------------------------------------------------

  // Grows a little on big screens and shrinks a little on small ones, always in real device pixels.
  getUiScale() {
    const ratio = getPixelRatio();
    const cssShortSide = Math.min(this.scale.width, this.scale.height) / ratio;
    return ratio * Phaser.Math.Clamp(cssShortSide / UI.referenceShortSide, UI.minScale, UI.maxScale);
  }

  layout() {
    const { width, height } = this.scale;
    const ratio = getPixelRatio();
    const insets = getSafeAreaInsets();
    this.uiScale = this.getUiScale();
    const margin = UI.margin * this.uiScale;
    this.safe = {
      left: insets.left * ratio + margin,
      top: insets.top * ratio + margin,
      right: width - insets.right * ratio - margin,
      bottom: height - insets.bottom * ratio - margin,
    };
    this.cameras.main.setSize(width, height);
  }

  drawOverlay(active) {
    const g = this.zones;
    g.clear();
    if (!active) return;
    const { width, height } = this.scale;
    this.drawCrateArrow(g, width, height);
    this.drawThreats(g, width, height);
  }

  // Where the line from the screen centre to p leaves the area kept clear of the HUD. Written into
  // `edge`, with the line's direction. Returns false if p is inside that area.
  edgeToward(p, width, height) {
    const inset = 34 * this.uiScale;
    const left = this.safe.left + inset;
    const right = this.safe.right - inset;
    const top = this.safe.top + inset * 2.2; // stay clear of the timer
    const bottom = this.safe.bottom - inset * 2.6; // and of the Shockwave button
    const cx = width / 2;
    const cy = height / 2;
    const angle = Math.atan2(p.y - cy, p.x - cx);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const t = Math.min(dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity, dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity);
    edge.x = cx + dx * t;
    edge.y = cy + dy * t;
    edge.dx = dx;
    edge.dy = dy;
    return !(p.x > left && p.x < right && p.y > top && p.y < bottom);
  }

  // A red chevron at the screen edge for each police car arriving from out of sight. It points
  // where the car will come from, and fades as the car comes into view.
  drawThreats(g, width, height) {
    const size = (WARNING.size + Math.sin(this.time.now / WARNING.pulseMs) * 1.5) * this.uiScale;
    for (const threat of this.world.radar.threats) {
      this.edgeToward(this.world.pointOnCanvas(threat.x, threat.y, 0, threatPoint), width, height);
      const { x, y, dx, dy } = edge;
      const tipX = x + dx * size;
      const tipY = y + dy * size;
      const wing = size * 0.9;
      const backX = x - dx * size * 0.2;
      const backY = y - dy * size * 0.2;
      const ax = backX - dy * wing;
      const ay = backY + dx * wing;
      const bx = backX + dy * wing;
      const by = backY - dx * wing;
      for (const [color, thickness, alpha] of THREAT_STROKES) {
        g.lineStyle(size * thickness, color, alpha * threat.level);
        g.lineBetween(ax, ay, tipX, tipY);
        g.lineBetween(bx, by, tipX, tipY);
      }
    }
  }

  // When the crate is off screen, a pulsing teal arrow at the screen edge points to it.
  drawCrateArrow(g, width, height) {
    const p = this.world.crateOnCanvas(cratePoint);
    if (!p || !this.edgeToward(p, width, height)) return;
    const { x, y, dx, dy } = edge;
    const size = (13 + Math.sin(this.time.now / 160) * 2) * this.uiScale;
    g.fillStyle(PALETTE.crateArrow, 0.95);
    g.fillTriangle(
      x + dx * size,
      y + dy * size,
      x - dx * size * 0.7 - dy * size * 0.8,
      y - dy * size * 0.7 + dx * size * 0.8,
      x - dx * size * 0.7 + dy * size * 0.8,
      y - dy * size * 0.7 - dx * size * 0.8,
    );
  }

  // ------------------------------------------------------------------------------------------
  // Debug toolbar (?debug only)
  // ------------------------------------------------------------------------------------------

  createDevPanel() {
    this.nextReadoutAt = 0;
    this.devPanel = new DevPanel({
      presets: HANDLING_PRESET_ORDER.map((id) => ({ id, label: HANDLING_PRESETS[id].label })),
      onSelectPreset: (id) => this.selectPreset(id),
      onRestart: () => this.restartRun(),
      onCycleView: () => this.cycleView(),
      onTurntable: () => this.toggleTurntable(),
      powers: Object.entries(POWERUP.names).map(([id, label]) => ({ id, label })),
      onGivePower: (kind) => this.world.givePower(kind),
      onSummon: (kind) => this.world.summon(kind),
    });
    this.devPanel.setActivePreset(this.registry.get('handlingPreset'));
    this.devPanel.setViewLabel(projection.viewLabel);
    this.events.once('shutdown', () => this.devPanel.destroy());
    PlatformManager.getStoredValue(STORAGE_KEYS.handlingPreset, null).then((saved) => {
      if (saved && HANDLING_PRESETS[saved]) this.selectPreset(saved, false);
    });
    PlatformManager.getStoredValue(STORAGE_KEYS.view, null).then((viewId) => {
      if (findView(viewId)) this.setView(viewId, false);
    });
  }

  cycleView() {
    const views = RENDER.views;
    const index = views.findIndex((view) => view.id === projection.viewId);
    this.setView(views[(index + 1) % views.length].id, true);
  }

  setView(viewId, save) {
    const view = findView(viewId);
    if (projection.viewId !== view.id) projection.setView(view);
    this.devPanel.setViewLabel(view.label);
    if (save) PlatformManager.setStoredValue(STORAGE_KEYS.view, view.id);
  }

  selectPreset(id, save = true) {
    this.registry.set('handlingPreset', id);
    this.devPanel.setActivePreset(id);
    if (save) PlatformManager.setStoredValue(STORAGE_KEYS.handlingPreset, id);
  }

  toggleTurntable() {
    this.world.setTurntable(!this.world.turntable);
    this.devPanel.setTurntable(this.world.turntable);
  }

  describeRun() {
    const state = this.world.getDebugState();
    if (state.turntable) {
      const deg = Math.round(((state.heading * 180) / Math.PI + 360) % 360);
      return `Turntable · facing ${deg}° (${compassName(deg)}) · hold ← → to turn · T to drive`;
    }
    return [
      HANDLING_PRESETS[state.preset]?.label ?? state.preset,
      state.mode,
      `speed ${Math.round(state.speed)}`,
      `police ${state.police}`,
      `${Math.round(this.game.loop.actualFps)} fps`,
    ].join(' · ');
  }
}

// Dark edge first, so the chevron shows up on any background. [colour, thickness x size, opacity]
const THREAT_STROKES = [
  [COLORS.warningBack, 0.75, 0.7],
  [COLORS.warning, 0.42, 1],
];

function compassName(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
