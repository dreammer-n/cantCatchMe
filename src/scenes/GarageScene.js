import * as Phaser from 'phaser';
import { CARS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Progress } from '../systems/Progress.js';
import { Garage } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { Tips } from '../systems/Tips.js';
import { Guide } from '../ui/Guide.js';
import { GarageScreen } from '../ui/Screens.js';

// Browse, buy and choose cars. Opened as the first step after PLAY (flow: the big button reads NEXT, on to the
// map), or from the results, where the chosen car's button reads DRIVE and leads on to the map just the same.
// Steer left and right to browse, Enter / Space / gamepad A for the big button, P to go back, so it works on any
// device.
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
    this.leadOn = false; // the guide's last pointer on this visit: NEXT, once the arrow to the next car is pressed
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

  // One-time pointers (GUIDE), each staying until what it points at is pressed: the free upgrade (UPGRADES, then
  // FREE), then on to the maps (the car's DRIVE, or NEXT on the way into a run, after SELECT if it isn't the chosen
  // one); the map step then points at START. On the way into a run, once those are done: the arrow to the next car,
  // then NEXT. Called again whenever what is on show changes.
  guide() {
    const screen = this.screen;
    const car = CARS[this.index];
    if (!Tips.has('guide-garage')) {
      if (!Garage.owns(car.id)) {
        Guide.hide(); // browsing a car not owned: the pointer comes back on one that is
        return;
      }
      if (Progress.isFree('engine', car.id)) {
        if (screen.upgrades.hidden) Guide.point(screen.toggle);
        else Guide.point(screen.upgradeRows.find((row) => row.kind === 'engine').buy); // it reads FREE
      } else if (screen.carPanel.hidden) Guide.point(screen.toggle); // CARS: back to the car
      else Guide.point(screen.action); // SELECT, then DRIVE (NEXT on the way into a run): on to the maps
      return;
    }
    if (!this.flow) return;
    if (!Tips.has('guide-car')) {
      Guide.point(screen.nextArrow, () => {
        Tips.mark('guide-car');
        this.leadOn = true; // then on to NEXT, this time
      });
    }
    else if (this.leadOn && Garage.owns(car.id) && !screen.carPanel.hidden) Guide.point(screen.action); // NEXT
    else Guide.hide();
  }

  browse(step) {
    Guide.hide();
    if (this.flow && !Tips.has('guide-car')) {
      Tips.mark('guide-car');
      this.leadOn = true; // then on to NEXT, this time
    }
    this.audio.play('click');
    this.index = (this.index + step + CARS.length) % CARS.length;
    this.showCar();
    if (this.flow) this.world.previewCar(CARS[this.index].id); // the car itself, in the world
    this.guide();
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
    if (!this.flow && Garage.selected === car.id) {
      this.driveToMaps();
      return;
    }
    Garage.select(car.id);
    this.audio.play('click');
    if (this.flow) this.toMap();
    else this.guide(); // chosen: the guide, if on, moves to DRIVE
  }

  // DRIVE from the results' garage: the results go, the world is set back as on the title, and the camera pulls
  // back over the map, as if PLAY had been pressed and this car chosen. BACK from the map comes back here (now as
  // PLAY's car step), and BACK again to the title.
  driveToMaps() {
    if (this.screen.leaving) return;
    Guide.hide();
    Tips.mark('guide-garage');
    this.audio.unlock();
    this.audio.play('click');
    this.scene.stop('GameOverScene');
    this.world.enterAttract();
    this.from = 'MenuScene';
    this.flow = true;
    this.screen.setFlow(true, Settings.hardStart);
    this.scene.launch('MenuScene', { behind: true }); // the title waits under PLAY's steps, unseen
    this.toMap();
  }

  // On to the map: the camera pulls back over it.
  toMap() {
    if (this.screen.leaving) return;
    Guide.hide();
    if (!Progress.isFree('engine', CARS[this.index].id)) Tips.mark('guide-garage');
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
    const guided = !Tips.has('guide-garage') && Progress.isFree(kind, id);
    if (!Progress.upgrade(kind, id)) return;
    this.audio.play('click');
    PlatformManager.sendEvent('upgrade_bought', { kind, tier: Progress.tier(kind, id), car: id });
    this.showCar();
    // The free upgrade the guide pointed at: back to the car, where its specs show what it added, and DRIVE.
    if (guided) this.screen.showCarsPanel();
    this.guide(); // on to the maps
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
