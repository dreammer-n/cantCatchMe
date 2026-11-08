import * as Phaser from 'phaser';
import { makeEffectTextures } from '../render/Effects.js';
import { applyMapPalette } from '../config/tuning.js';
import { Maps } from '../systems/ScoreSystem.js';
import { buildLayout } from '../systems/WorldLayout.js';

// Prepares what the title screen needs, as fast as possible. All art is built in code from low-poly models
// (car drawings in 64 directions, props, particles), so the download contains no image files. The police,
// wrecks, helicopter, jet and the map's other props are drawn after the title is up (GameScene.warmUp).
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    performance.mark && performance.mark('ccm:phaser');
    makeEffectTextures(this);
    this.registry.set('handlingPreset', 'car');
    applyMapPalette(Maps.current());
    this.registry.set('layout', buildLayout(undefined, Maps.current()));
    this.scene.start('GameScene');
    this.scene.launch('UIScene');
    this.scene.launch('MenuScene');
  }
}
