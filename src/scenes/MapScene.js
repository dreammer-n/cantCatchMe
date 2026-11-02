import * as Phaser from 'phaser';
import { MAPS } from '../config/tuning.js';
import { Maps } from '../systems/ScoreSystem.js';
import { MapScreen } from '../ui/Screens.js';

// Choosing a map, from the title. Steer left and right to browse, Enter / Space / gamepad A to start, Esc to
// go back.
export class MapScene extends Phaser.Scene {
  constructor() {
    super('MapScene');
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    if (!this.screen) {
      this.screen = new MapScreen({
        onPrev: () => this.browse(-1),
        onNext: () => this.browse(1),
        onAction: () => this.start(),
        onBack: () => this.close(),
      });
    }
    this.index = MAPS.findIndex((map) => map.id === Maps.selected);
    this.lastSteer = 0;
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    this.screen.show();
    this.showMap();
    this.events.once('shutdown', () => this.screen.hide());
  }

  update(time) {
    this.screen.drawMap();
    if (time < this.readyAt) return;
    const command = this.controls.getCommand();
    if (command.steer !== 0 && command.steer !== this.lastSteer) this.browse(command.steer);
    this.lastSteer = command.steer;
    if (command.confirmPressed) this.start();
    else if (command.pausePressed) this.close();
  }

  showMap() {
    this.screen.showMap(MAPS[this.index], this.index);
  }

  browse(step) {
    this.audio.play('click');
    this.index = (this.index + step + MAPS.length) % MAPS.length;
    this.showMap();
  }

  start() {
    const map = MAPS[this.index];
    if (!Maps.select(map.id)) return;
    this.audio.unlock();
    this.audio.play('click');
    this.scene.stop();
    this.scene.get('GameScene').startRun(); // emits 'run-started', which closes the title behind this
  }

  close() {
    this.audio.play('click');
    this.scene.stop();
    this.scene.resume('MenuScene');
    this.scene.get('MenuScene').onGarageClosed();
  }
}
