import * as Phaser from 'phaser';
import { DEBUG } from '../config/debug.js';
import { COLORS, PALETTE, POWERUP, REVIVE, UI, WARNING } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Garage, Maps } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { SandstormOverlay } from '../render/SandstormOverlay.js';
import { Hud } from '../ui/Hud.js';
import { PauseScreen, ReviveScreen, simulateAd } from '../ui/Screens.js';
import { getPixelRatio, getSafeAreaInsets } from '../utils/screen.js';

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
    this.sandstorm = new SandstormOverlay(this); // under the warning arrows
    this.zones = this.add.graphics();

    this.hud = new Hud({ onPause: () => this.controls.press('pause') });
    this.pauseScreen = new PauseScreen({
      onResume: () => this.setPaused(false),
      onRestart: () => this.restartRun(),
      onMenu: () => this.toMenu(),
      onSound: () => this.toggleSound(),
      onMusic: () => this.toggleMusic(),
    });

    this.reviveScreen = new ReviveScreen({
      onPay: () => this.revive(true),
      onAd: () => this.reviveWithAd(),
      onDecline: () => this.closeOffer(false),
    });
    this.offer = null;

    const on = (name, handler) => {
      this.game.events.on(name, handler, this);
      this.events.once('shutdown', () => this.game.events.off(name, handler, this));
    };
    on('toast', (text, kind) => this.hud.toast(text, kind));
    on('power-ready', (name) => this.hud.toast(`${name}! ${this.touch ? 'DOUBLE TAP' : 'SPACE'}`, 'ready', 2600));
    on('run-started', () => this.onRunStarted());
    on('revive-offer', (offer) => this.openOffer(offer));
    on('shields', (left, max) => this.hud.setShields(left, max));
    on('countdown', (value) => this.hud.setCount(value));
    on('run-over', () => this.hud.show(false));
    on('platform-pause', () => {
      if (this.world.running && !this.paused) this.setPaused(true);
    });

    if (import.meta.env.MODE !== 'production' && DEBUG) import('../dev/devToolbar.js').then(({ attachDevToolbar }) => (this.devTools = attachDevToolbar(this)));
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  onRunStarted() {
    this.hud.setCount(null);
    this.setPaused(false);
    this.closeOffer(null);
    this.hud.clearToasts();
    this.hud.setRecord(Maps.bestTime(Maps.selected));
    this.hud.show(true);
  }

  update(time, delta) {
    const command = this.controls.getCommand();
    if (this.offer) this.updateOffer(time, command);
    const running = this.world.running;
    if (running || this.paused) {
      if (command.pausePressed) this.setPaused(!this.paused);
      else if (this.paused && command.confirmPressed) this.setPaused(false);
      else if (command.restartPressed) this.restartRun();
    }
    const sim = this.world.sim;
    if (running || this.world.mode === 'crashed') this.hud.update(sim.stats.time, sim.stats.distance, sim.stats.wrecks);
    const effect = running ? sim.powerUps.activeEffect() : null;
    this.hud.setPower(effect ? POWERUP.names[effect.kind] : null, effect ? effect.share : 0);
    this.drawOverlay(running && !this.paused);
    const weather = this.world.weather;
    this.sandstorm.update(weather ? weather.storm : 0, weather ? weather.wind : 0, this.scale.width, this.scale.height, this.paused ? 0 : delta / 1000);
    if (this.devTools) this.devTools.update(time);
  }

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.scene.pause('GameScene');
      this.controls.releaseHeld();
      this.pauseScreen.show({ soundOn: Settings.sound, musicOn: Settings.music });
      this.audio.setPaused(true);
      PlatformManager.runPaused();
    } else {
      this.scene.resume('GameScene');
      this.pauseScreen.hide();
      this.audio.setPaused(false);
      PlatformManager.runResumed();
    }
  }

  // ---- The second chance ----

  openOffer(offer) {
    this.offer = { ...offer, endsAt: this.time.now + REVIVE.offerSeconds * 1000, busy: false };
    this.controls.releaseHeld();
    this.reviveScreen.show({ ...offer, coins: Garage.coins });
  }

  // Counts down while nothing is loading; at zero, or on a key, it moves on.
  updateOffer(time, command) {
    const offer = this.offer;
    if (offer.busy) {
      offer.endsAt = time + REVIVE.offerSeconds * 1000;
      return;
    }
    const left = (offer.endsAt - time) / 1000;
    this.reviveScreen.setCount(left);
    if (left <= 0) this.closeOffer(false);
    else if (command.confirmPressed) {
      if (offer.canPay) this.revive(true);
      else this.reviveWithAd();
    }
  }

  revive(paid) {
    if (!this.offer || this.offer.busy) return;
    this.audio.play('click');
    this.closeOffer(true, paid);
  }

  async reviveWithAd() {
    const offer = this.offer;
    if (!offer || offer.busy) return;
    this.audio.play('click');
    offer.busy = true;
    this.reviveScreen.setAdState('busy');
    const earned = offer.adMode === 'simulated' ? await simulateAd() : await PlatformManager.showRewardedAd('revive');
    if (this.offer !== offer) return;
    offer.busy = false;
    if (earned) this.closeOffer(true, false);
    else this.reviveScreen.setAdState('failed');
  }

  // revive: true = carry on, false = the results, null = just close it (a new run has begun).
  closeOffer(revive, paid = false) {
    if (!this.offer) return;
    this.offer = null;
    this.reviveScreen.hide();
    if (revive === true) this.world.acceptRevive(paid);
    else if (revive === false) {
      this.audio.play('click');
      this.world.declineRevive();
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
    this.pauseScreen.sound.setOn(Settings.sound);
  }

  toggleMusic() {
    Settings.setMusic(!Settings.music);
    this.audio.setMusicOn(Settings.music);
    this.pauseScreen.music.setOn(Settings.music);
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
    const size = (WARNING.size + Math.sin(this.time.now / WARNING.pulseMs) * WARNING.pulse) * this.uiScale;
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
        g.lineStyle(size * thickness, color, alpha * threat.level * WARNING.alpha);
        g.lineBetween(ax, ay, tipX, tipY);
        g.lineBetween(bx, by, tipX, tipY);
      }
    }
  }
}

// Dark edge first, so the chevron shows up on any background. [colour, thickness x size, opacity]
const THREAT_STROKES = [
  [COLORS.warningBack, 0.75, 0.7],
  [COLORS.warning, 0.42, 1],
];
