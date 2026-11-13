import * as Phaser from 'phaser';
import { MAPS } from '../config/tuning.js';
import { Maps } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { Tips } from '../systems/Tips.js';
import { Guide } from '../ui/Guide.js';
import { MapScreen } from '../ui/Screens.js';

// The last step after PLAY (title > car > map): choosing a map, shown by the world itself, the camera pulled back over
// it (GameScene.menuShot, previewMap). Steer left and right to browse, Enter / Space / gamepad A to START (the camera
// glides down into play as the car drives off), P to go back to the car.
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
        onHardStart: () => this.toggleHardStart(),
      });
    }
    this.world = this.scene.get('GameScene');
    this.starting = false;
    this.index = MAPS.findIndex((map) => map.id === Maps.selected);
    this.lastSteer = 0;
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    this.screen.show(); // laid out (no frame is shown before zoom() takes over), so the map can be drawn
    this.showMap(); // drawn first, then the move starts
    this.screen.zoom();
    this.guide();
    this.events.once('shutdown', () => {
      Guide.hide();
      this.screen.leave(!this.starting);
    });
  }

  update(time) {
    if (time < this.readyAt) return;
    const command = this.controls.getCommand();
    if (command.steer !== 0 && command.steer !== this.lastSteer) this.browse(command.steer);
    this.lastSteer = command.steer;
    if (command.confirmPressed) this.start();
    else if (command.pausePressed) this.close();
  }

  showMap() {
    this.screen.showMap(MAPS[this.index], this.index, Settings.hardStart);
  }

  // Once: the arrow on the next map (which shows the stars it needs), or on START when every map is open.
  guide() {
    if (Tips.has('guide-map')) return;
    const done = () => Tips.mark('guide-map');
    Guide.point(Maps.nextLocked() ? this.screen.nextArrow : this.screen.action, done);
  }

  browse(step) {
    Guide.hide();
    Tips.mark('guide-map');
    this.audio.play('click');
    this.index = (this.index + step + MAPS.length) % MAPS.length;
    this.showMap();
    this.world.previewMap(MAPS[this.index]); // the world itself becomes that map
  }

  toggleHardStart() {
    Settings.setHardStart(!Settings.hardStart);
    this.screen.hard.setOn(Settings.hardStart);
    this.audio.play('click');
  }

  // START: the menus go and the camera glides down into play as the car drives off.
  start() {
    if (this.screen.node.hidden || this.screen.leaving || this.starting) return;
    const map = MAPS[this.index];
    if (!Maps.select(map.id)) return;
    this.starting = true;
    Guide.hide();
    Tips.mark('guide-map');
    this.audio.unlock();
    this.audio.play('click');
    this.scene.stop('GarageScene');
    this.scene.stop();
    this.world.startRun(); // emits 'run-started', which closes the title
  }

  // Back to the car: the map chosen before stays, and the camera closes in on the car.
  close() {
    if (this.screen.leaving || this.starting) return;
    this.audio.play('click');
    this.world.previewMap(Maps.current());
    this.scene.stop();
    this.scene.resume('GarageScene');
    this.scene.get('GarageScene').onMapClosed();
  }
}
