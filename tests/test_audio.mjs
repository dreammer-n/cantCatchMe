// Checks for the sound files: that every one the game asks for is really there, under exactly that name.
import { readdirSync, statSync } from 'node:fs';
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
check('file names are all lowercase, apart from the first-word style the owner chose', paths.every((p) => !/^[A-Z]/.test(p.split('/')[1])));

const listed = new Set(paths);
const unused = readdirSync(ASSETS).flatMap((folder) => readdirSync(join(ASSETS, folder)).map((name) => `${folder}/${name}`)).filter((p) => !listed.has(p));
check('no sound file sits unused, adding to the download', unused.length === 0, unused.join());

const bytes = paths.reduce((sum, p) => sum + statSync(join(ASSETS, p)).size, 0);
check('all the sound together fits well inside the 15 MB target', bytes < 8e6, `${(bytes / 1e6).toFixed(2)} MB`);

check('every power-up has a sound', Object.keys(POWERUP.kinds).every((kind) => POWERUP.sounds[kind]?.length > 0 && POWERUP.sounds[kind].every((s) => AUDIO.files[s])));
check('only KABOOM and TITAN have voices', POWERUP.sounds.shockwave.includes('kaboom') && POWERUP.sounds.giant.includes('titan') && Object.values(POWERUP.sounds).flat().filter((s) => s === 'kaboom' || s === 'titan').length === 2);
check('TITAN is its voice and nothing under it', POWERUP.sounds.giant.length === 1);
check('the engine sound has gone', AUDIO.engine === undefined);
check('a combo makes no sound, on the owner\'s word', AUDIO.files.combo === undefined);
check('the music dips subtly on the pause menu: a little, not a lot', AUDIO.musicDim >= 0.5 && AUDIO.musicDim < 0.85);
check('the police radio can\'t talk over itself', AUDIO.files.police_radio.cooldown >= 5);
check('the music sits under the effects', AUDIO.chaseMusic < Math.min(...Object.values(POWERUP.sounds).flat().map((s) => AUDIO.files[s].volume)));
const crashFile = AUDIO.files.carCrash;
check('the crash varies each time, so it doesn\'t get tiring', crashFile.vary > 0 && crashFile.cooldown > 0);

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
