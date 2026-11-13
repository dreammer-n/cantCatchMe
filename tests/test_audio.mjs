// Checks for the sound files: that every one the game asks for is really there, under exactly that name.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO, POWERUP, STORAGE_KEYS } from '../src/config/tuning.js';
import { PlatformManager } from '../src/platform/PlatformManager.js';
import { Settings } from '../src/systems/Settings.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const paths = [...Object.values(AUDIO.music), ...Object.values(AUDIO.files).map((f) => f.path)];

// Exact spelling, capitals included: this computer forgives a wrong capital, but a web server may not.
const exists = (path) => {
  const [folder, name] = path.split('/');
  return readdirSync(join(ASSETS, folder)).includes(name);
};
const missing = paths.filter((p) => !exists(p));
check('every sound file is there, spelt exactly', missing.length === 0, missing.join());
// Portals want plain names: lowercase letters, numbers and underscores only, for every folder and file in public/assets.
const allAssets = readdirSync(ASSETS).flatMap((folder) => [folder, ...readdirSync(join(ASSETS, folder))]);
const badNames = allAssets.filter((name) => !/^[a-z0-9_]+(\.[a-z0-9]+)?$/.test(name));
check('asset folders and files use only lowercase letters, numbers and underscores', badNames.length === 0, badNames.join());

const listed = new Set(paths);
const unused = readdirSync(ASSETS).flatMap((folder) => readdirSync(join(ASSETS, folder)).map((name) => `${folder}/${name}`)).filter((p) => !listed.has(p));
check('no sound file sits unused, adding to the download', unused.length === 0, unused.join());

const bytes = paths.reduce((sum, p) => sum + statSync(join(ASSETS, p)).size, 0);
check('all the sound together fits well inside the 15 MB target', bytes < 8e6, `${(bytes / 1e6).toFixed(2)} MB`);

check('every sound a power-up asks for is a real file', Object.keys(POWERUP.kinds).every((kind) => Array.isArray(POWERUP.sounds[kind]) && POWERUP.sounds[kind].every((s) => AUDIO.files[s])));
check('the first five power-ups have their sounds (the newer five wait for the owner\'s files)', ['shockwave', 'giant', 'freeze', 'pillars', 'flamer'].every((kind) => POWERUP.sounds[kind].length > 0));
check('only KABOOM and TITAN have voices', POWERUP.sounds.shockwave.includes('kaboom') && POWERUP.sounds.giant.includes('titan') && Object.values(POWERUP.sounds).flat().filter((s) => s === 'kaboom' || s === 'titan').length === 2);
check('TITAN is its voice and nothing under it', POWERUP.sounds.giant.length === 1);
check('the engine is back, from the owner\'s own file, quiet under the music', AUDIO.files.engine_loop && AUDIO.engine.volume < AUDIO.chaseMusic && AUDIO.engine.pitch[1] > AUDIO.engine.pitch[0]);
check('a combo makes no sound, on the owner\'s word', AUDIO.files.combo === undefined);
check('the music is silent on the pause menu', AUDIO.musicDim === 0);
check('sounds load in the order they are needed: the menu music and the click first', AUDIO.loadOrder[0] === 'menu' && AUDIO.loadOrder[1] === 'click' && AUDIO.loadOrder.every((name) => name === 'menu' || AUDIO.files[name]) && AUDIO.loadAtOnce >= 2);
check('BLACKOUT has its sound file', POWERUP.sounds.blackout.includes('blackout') && AUDIO.files.blackout.path === 'sound_effects/blackout.mp3');
check('the chase music starts loading as soon as the menu music and click are in', AUDIO.chaseAfter.length > 0 && AUDIO.chaseAfter.every((name) => name === 'menu' || AUDIO.files[name]));
check('the police radio can\'t talk over itself', AUDIO.files.police_radio.cooldown >= 5);
check('the music sits under the effects', AUDIO.chaseMusic < Math.min(...Object.values(POWERUP.sounds).flat().map((s) => AUDIO.files[s].volume)));
const crashFile = AUDIO.files.carCrash;
check('the crash varies each time, so it doesn\'t get tiring', crashFile.vary > 0 && crashFile.cooldown > 0);

// Playgama turns down sound made in code: every sound is a file, and none falls back to a made-up one.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'systems', 'AudioSystem.js'), 'utf8');
check('no sound is synthesised', !/createOscillator|createBiquadFilter|getChannelData/.test(source));
check('no file falls back to a synthesised sound', Object.values(AUDIO.files).every((f) => f.fallback === undefined));
const played = new Set();
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.js') && [...readFileSync(join(dir, d.name), 'utf8').matchAll(/audio\.play\('([a-zA-Z_]+)'/g)].forEach((m) => played.add(m[1]))));
walk(SRC);
const unknown = [...played].filter((name) => !AUDIO.files[name]);
check('every sound the game plays has its file', unknown.length === 0, unknown.join());

// Two settings, saved apart.
Settings.setSound(false);
Settings.setMusic(true);
Settings.sound = true;
Settings.music = false;
await Settings.load();
check('effects and music are saved on their own', Settings.sound === false && Settings.music === true);
Settings.setSound(true);
Settings.setMusic(false);
Settings.sound = false;
Settings.music = true;
await Settings.load();
check('either way round', Settings.sound === true && Settings.music === false);
await PlatformManager.setStoredValue(STORAGE_KEYS.settings, { sound: false });
await Settings.load();
check('a save from when one button did both: all off stays all off', Settings.sound === false && Settings.music === false);
await PlatformManager.setStoredValue(STORAGE_KEYS.settings, { sound: true });
await Settings.load();
check('and all on stays all on', Settings.sound === true && Settings.music === true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
