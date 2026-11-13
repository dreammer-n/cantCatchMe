import * as Phaser from 'phaser';
import { CARS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Progress } from '../systems/Progress.js';
import { Garage } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { Tips } from '../systems/Tips.js';
import { Guide } from '../ui/Guide.js';
import { GarageScreen } from '../ui/Screens.js';

// Browse, buy and choose cars. Opened as the last step after PLAY (flow: from the map step, the big button reads
// DRIVE), or from the results. Steer left and right to browse, Enter / Space / gamepad A for the big button, P to
// go back, so it works on any device.
export class GarageScene extends Phaser.Scene {
  constructor() {
    super('GarageScene');
  }

  init(data) {
    this.from = data.from;
    this.flow = Boolean(data.flow);
    this.hint = data.hint || null;
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    if (!this.screen) {
      this.screen = new GarageScreen({
        onPrev: () => this.browse(-1),
        onNext: () => this.browse(1),
        onAction: () => this.act(),
        onBack: () => this.close(),
        onUpgrade: (kind) => this.upgrade(kind),
        onHardStart: () => this.toggleHardStart(),
        onToggle: () => this.guide(),
      });
    }
    this.screen.setFlow(this.flow, Settings.hardStart, this.hint);
    this.screen.showCarsPanel(); // opens on the car, not the upgrades left open last time
    Tips.mark('garage-visit');
    this.index = CARS.findIndex((car) => car.id === Garage.selected);
    this.lastSteer = 0;
    this.readyAt = this.time.now + 250; // ignore a key still held from the previous screen
    this.driving = false;
    this.world = this.scene.get('GameScene');
    this.screen.show();
    this.screen.forget();
    this.showCar(); // drawn first (the map behind and the car), then the move starts
    this.screen.zoom();
    this.stopWatching = Garage.onChange(() => this.showCar());
    this.guide();
    this.events.once('shutdown', () => {
      Guide.hide();
      this.stopWatching();
      this.screen.leave(!this.driving);
    });
  }

  update(time) {
    this.screen.drawCar();
    if (time < this.readyAt) return;
    const command = this.controls.getCommand();
    if (command.steer !== 0 && command.steer !== this.lastSteer) this.browse(command.steer);
    this.lastSteer = command.steer;
    if (command.confirmPressed) this.act();
    else if (command.pausePressed) this.close();
  }

  showCar() {
    this.screen.showCar(CARS[this.index], this.index, CARS.length);
  }

  // One-time pointers (GUIDE), each only once: the free upgrade (UPGRADES, then its button), then the next car to
  // save for; on the way into a run, if those are done, where to pick a car. A tap anywhere else ends the guide.
  guide() {
    const screen = this.screen;
    const done = (id) => () => Tips.mark(id);
    if (!Tips.has('guide-garage')) {
      const car = CARS[this.index];
      if (Progress.isFree('engine', car.id)) {
        const onTap = (hit) => {
          if (!hit) Tips.mark('guide-garage');
        };
        if (screen.upgrades.hidden) Guide.point(screen.toggle, onTap);
        else Guide.point(screen.upgradeRows.find((row) => row.kind === 'engine').buy, onTap); // it reads FREE
        return;
      }
      const next = CARS.filter((c) => !Garage.owns(c.id) && !c.challenge).sort((a, b) => a.price - b.price)[0];
      if (next) {
        Guide.point(screen.nextArrow, done('guide-garage')); // the next car shows its price
        return;
      }
      Tips.mark('guide-garage');
    }
    if (this.flow && !Tips.has('guide-car')) Guide.point(screen.nextArrow, done('guide-car'));
  }

  browse(step) {
    Guide.hide();
    if (this.flow) Tips.mark('guide-car');
    this.audio.play('click');
    this.index = (this.index + step + CARS.length) % CARS.length;
    this.showCar();
    if (this.flow) this.world.previewCar(CARS[this.index].id); // the car itself, in the world
  }

  // Buys or selects the car on show. A car you have just paid for is the one you want to drive.
  act() {
    const car = CARS[this.index];
    if (!Garage.owns(car.id)) {
      if (!Garage.buy(car.id)) return;
      Garage.select(car.id);
      this.audio.play('click');
      return; // bought: the button now reads DRIVE
    }
    Garage.select(car.id);
    this.audio.play('click');
    if (this.flow) this.toMap();
  }

  // On to the map: the camera pulls back over it.
  toMap() {
    if (this.screen.leaving) return;
    Guide.hide();
    this.audio.unlock();
    this.screen.leave();
    this.world.menuShot('map');
    this.scene.launch('MapScene', { flow: true });
    this.scene.pause();
  }

  // Back from the map: the camera closes in on the car again.
  onMapClosed() {
    this.screen.show();
    this.showCar();
    this.screen.zoom(true);
    this.world.menuShot('car');
    this.readyAt = this.time.now + 250;
    this.guide();
  }

  toggleHardStart() {
    Settings.setHardStart(!Settings.hardStart);
    this.screen.hard.setOn(Settings.hardStart);
    this.audio.play('click');
  }

  // An upgrade for every car, if the player's level and coins allow it.
  upgrade(kind) {
    const id = CARS[this.index].id; // the car on show
    if (!Progress.upgrade(kind, id)) return;
    this.audio.play('click');
    PlatformManager.sendEvent('upgrade_bought', { kind, tier: Progress.tier(kind, id), car: id });
    this.showCar();
    this.guide(); // on to the next car to save for
  }

  close() {
    if (this.driving || this.screen.leaving) return;
    this.audio.play('click');
    const parent = this.scene.get(this.from);
    this.scene.stop();
    this.scene.resume(this.from);
    parent.onGarageClosed();
  }
}
