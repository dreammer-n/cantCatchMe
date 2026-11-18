import * as Phaser from 'phaser';
import { PRIZE } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Garage } from '../systems/ScoreSystem.js';
import { Guide } from '../ui/Guide.js';
import { boardAvailable, boardOpen, openLeaderboard } from '../ui/Leaderboard.js';
import { GameOverScreen, simulateAd } from '../ui/Screens.js';

// Results after a crash: survival time, best, police wrecked, close calls, best combo, coins earned, with
// the offer to double them by watching an ad.
// Retry with the button, Enter / Space / R or gamepad A.
export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  init(data) {
    this.result = data;
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    if (!this.screen) {
      this.screen = new GameOverScreen({
        onRetry: () => this.retry(),
        onMenu: () => this.toMenu(),
        onGarage: () => this.openGarage(),
        onDouble: () => this.doubleCoins(),
        onFeedback: (choice) => this.feedback(choice),
        onPrize: () => this.openGarage({ show: Garage.prize && Garage.prize.id }),
        onBoard: () => this.openBoard(),
      });
    }
    this.adBusy = false;
    this.screen.show({ ...this.result, balance: Garage.coins, adMode: PlatformManager.rewardedAdMode(), boardShown: boardAvailable() });
    // A short delay, so a key or tap meant for steering doesn't skip the results by accident.
    this.readyAt = this.time.now + 600;
    this.pointAtGarage();
    // The Hypercar just won: HYPERCAR WON! for a moment, then straight to it in the garage, chosen (PRIZE).
    // BACK there comes back here, to the coins and RETRY.
    if (this.result.carWonId && !this.result.handedOver) {
      this.result.handedOver = true;
      this.time.delayedCall(PRIZE.revealSeconds * 1000, () => this.openGarage({ show: this.result.carWonId, won: true }));
    }
    this.events.once('shutdown', () => {
      Guide.hide();
      this.screen.hide();
    });
  }

  // A new player's results: an arrow on GARAGE until they have been in it (GUIDE). It stays until GARAGE is pressed.
  pointAtGarage() {
    if (this.result.garagePointer) Guide.point(this.screen.garageButton, null, { below: true });
  }

  update(time) {
    if (time < this.readyAt || this.adBusy || boardOpen() || this.screen.node.hidden) return;
    const command = this.controls.getCommand();
    if (command.confirmPressed || command.restartPressed) this.retry();
  }

  // The reward is given only if the ad was really earned, and only once for a run.
  async doubleCoins() {
    const result = this.result;
    if (this.adBusy || result.doubled) return;
    this.adBusy = true;
    this.audio.play('click');
    this.screen.setDoubleState('busy');
    const earned = PlatformManager.rewardedAdMode() === 'simulated' ? await simulateAd() : await PlatformManager.showRewardedAd();
    this.adBusy = false;
    if (!earned) {
      this.screen.setDoubleState('failed', PlatformManager.rewardedOutcome);
      return;
    }
    result.doubled = true;
    Garage.award(result.coins.total);
    PlatformManager.flush();
    this.screen.showDoubled(result.coins.total, Garage.coins);
  }

  // The one question (FEEDBACK): the answer goes to Playgama's stats, with the run's number, and nothing else.
  feedback(choice) {
    this.audio.play('click');
    PlatformManager.sendEvent('feedback', { choice, run_number: Math.min(this.result.runNumber || 0, 50) });
    PlatformManager.flush();
    this.screen.thankFeedback();
  }

  // The HARD START leaderboard (ui/Leaderboard.js), over the results; BACK comes back to them.
  openBoard() {
    if (this.adBusy || this.screen.node.hidden) return;
    Guide.hide();
    openLeaderboard({
      under: this.screen,
      audio: this.audio,
      onClosed: () => {
        this.readyAt = this.time.now + 400;
        this.pointAtGarage();
      },
    });
  }

  // options: show (a car to open on), won (it has just been won).
  openGarage(options = {}) {
    if (this.adBusy || !this.scene.isActive() || boardOpen()) return;
    this.audio.play('click');
    Guide.hide();
    this.result.garagePointer = false;
    this.screen.hide();
    this.scene.launch('GarageScene', { from: 'GameOverScene', ...options });
    this.scene.pause();
  }

  onGarageClosed() {
    this.screen.node.hidden = false;
    this.screen.showCoins(Garage.coins);
    this.readyAt = this.time.now + 400;
  }

  retry() {
    if (this.adBusy) return;
    this.audio.play('click');
    this.screen.hide();
    this.scene.get('GameScene').startRun();
    this.scene.stop();
  }

  toMenu() {
    if (this.adBusy) return;
    this.audio.play('click');
    this.screen.hide();
    this.scene.get('GameScene').enterAttract();
    this.scene.launch('MenuScene');
    this.scene.stop();
  }
}
