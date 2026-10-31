import * as Phaser from 'phaser';
import { DEFAULT_HANDLING_PRESET } from '../config/tuning.js';
import { ensureCarAtlas } from '../render/carAtlas.js';
import { makeEffectTextures } from '../render/Effects.js';
import { buildLayout } from '../systems/WorldLayout.js';

// Prepares everything before the first frame. All art is built in code from low-poly models
// (car drawings in 64 directions, props, particles), so the download contains no image files.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    makeEffectTextures(this);
    for (const name of ['player', 'police', 'interceptor', 'bearcat', 'helicopter', 'wreck', 'wreckRoof']) ensureCarAtlas(this, name);
    this.registry.set('handlingPreset', DEFAULT_HANDLING_PRESET);
    this.registry.set('layout', buildLayout());
    this.scene.start('GameScene');
    this.scene.launch('UIScene');
    this.scene.launch('MenuScene');
  }
}
