import * as Phaser from 'phaser';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Garage } from '../systems/ScoreSystem.js';
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
      });
    }
    this.adBusy = false;
    this.screen.show({ ...this.result, balance: Garage.coins, adMode: PlatformManager.rewardedAdMode() });
    // A short delay, so a key or tap meant for steering doesn't skip the results by accident.
    this.readyAt = this.time.now + 600;
    this.events.once('shutdown', () => this.screen.hide());
  }

  update(time) {
    if (time < this.readyAt || this.adBusy) return;
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
      this.screen.setDoubleState('failed');
      return;
    }
    result.doubled = true;
    Garage.award(result.coins.total);
    PlatformManager.flush();
    this.audio.play('pickup');
    this.screen.showDoubled(result.coins.total, Garage.coins);
  }

  openGarage() {
    if (this.adBusy) return;
    this.audio.play('click');
    this.screen.hide();
    this.scene.launch('GarageScene', { from: 'GameOverScene' });
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
