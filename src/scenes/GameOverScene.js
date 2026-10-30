import * as Phaser from 'phaser';
import { GameOverScreen } from '../ui/Screens.js';

// Results after a crash: survival time, best, police wrecked, close calls, best combo.
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
    if (!this.screen) this.screen = new GameOverScreen({ onRetry: () => this.retry(), onMenu: () => this.toMenu() });
    this.screen.show(this.result);
    // A short delay, so a key or tap meant for steering doesn't skip the results by accident.
    this.readyAt = this.time.now + 600;
    this.events.once('shutdown', () => this.screen.hide());
  }

  update(time) {
    if (time < this.readyAt) return;
    const command = this.controls.getCommand();
    if (command.confirmPressed || command.restartPressed) this.retry();
  }

  retry() {
    this.audio.play('click');
    this.screen.hide();
    this.scene.get('GameScene').startRun();
    this.scene.stop();
  }

  toMenu() {
    this.audio.play('click');
    this.screen.hide();
    this.scene.get('GameScene').enterAttract();
    this.scene.launch('MenuScene');
    this.scene.stop();
  }
}
