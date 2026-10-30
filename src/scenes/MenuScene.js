import * as Phaser from 'phaser';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Records } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { MenuScreen } from '../ui/Screens.js';

// Title screen (HTML) over the world, where the player's car turns slowly on the start ring.
// Play with the button, Enter / Space or gamepad A.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    if (!this.screen) {
      this.screen = new MenuScreen({ onPlay: () => this.play(), onSound: () => this.toggleSound() });
    }
    const touch = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    this.screen.show({ best: Records.best, totals: Records.totals, soundOn: Settings.sound, touch });
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    const close = () => this.close();
    this.game.events.once('run-started', close);
    this.events.once('shutdown', () => this.game.events.off('run-started', close));
    hideBootScreen();
    PlatformManager.gameReady(); // first moment the player can interact
  }

  update(time) {
    if (time >= this.readyAt && this.controls.getCommand().confirmPressed) this.play();
  }

  play() {
    if (!this.screen || this.screen.node.hidden) return;
    this.audio.unlock();
    this.audio.play('click');
    this.scene.get('GameScene').startRun(); // emits 'run-started', which closes this screen
  }

  close() {
    this.screen.hide();
    this.scene.stop();
  }

  toggleSound() {
    this.audio.unlock();
    Settings.setSound(!Settings.sound);
    this.audio.setSoundOn(Settings.sound);
    this.screen.sound.setSound(Settings.sound);
    this.audio.play('click');
  }
}

function hideBootScreen() {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('done')) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 400);
}
