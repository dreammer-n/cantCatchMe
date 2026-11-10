import * as Phaser from 'phaser';
import { MAPS } from '../config/tuning.js';
import { Maps } from '../systems/ScoreSystem.js';
import { MapScreen } from '../ui/Screens.js';

// Step one after PLAY: choosing a map. Steer left and right to browse, Enter / Space / gamepad A for NEXT
// (choosing the car, GarageScene), P to go back to the title.
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
    this.screen.show(); // laid out (no frame is shown before zoom() takes over), so the map can be drawn
    this.showMap(); // drawn first, then the move starts
    this.screen.zoom();
    this.events.once('shutdown', () => this.screen.leave(true));
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
    if (this.screen.node.hidden || this.screen.leaving) return;
    const map = MAPS[this.index];
    if (!Maps.select(map.id)) return;
    this.audio.unlock();
    this.audio.play('click');
    this.screen.leave();
    this.scene.launch('GarageScene', { from: 'MapScene', flow: true });
    this.scene.pause();
  }

  // Back from choosing the car.
  onGarageClosed() {
    this.screen.show();
    this.showMap();
    this.screen.zoom(true);
    this.readyAt = this.time.now + 250;
  }

  close() {
    if (this.screen.leaving) return;
    this.audio.play('click');
    this.scene.stop();
    this.scene.resume('MenuScene');
    this.scene.get('MenuScene').onGarageClosed();
  }
}
