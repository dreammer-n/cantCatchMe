// Unit checks for the low-poly 2.5D maths (Node, no browser).
import { Projection, findView, visibleGroundRect } from '../src/render/projection.js';
import { box, convexHull, projectMesh, projectShadow, worldShadowOutline } from '../src/render/lowpoly.js';
import { atlasLayout, directionHeading, frameFor, measureCar } from '../src/render/carAtlas.js';
import { carMesh, carShadowPoints } from '../src/render/carModels.js';
import * as props from '../src/render/propModels.js';
import { RENDER, DEPTH, CAR_SIZE } from '../src/config/tuning.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const TAU = Math.PI * 2;
const deg = (r) => (r * 180 / Math.PI).toFixed(1);
const angled = new Projection(findView('angled'));

// --- Projection ---
{
  const flat = new Projection({ azimuthDeg: 0, elevationDeg: 90 });
  const p = flat.toScreen(123, 456, 50);
  check('azimuth 0 + elevation 90 is exactly the flat Milestone 1 view', near(p.x, 123) && near(p.y, 456) && flat.lift === 0);
}
for (const view of RENDER.views) {
  const pr = new Projection(view);
  const s = pr.toScreen(321, 789, 0);
  const g = pr.groundFromScreen(s.x, s.y);
  check(`${view.id}: screen -> ground round trip`, near(g.x, 321, 1e-6) && near(g.y, 789, 1e-6));
  check(`${view.id}: height raises things up the screen only`, near(pr.toScreen(10, 10, 40).x, pr.toScreen(10, 10, 0).x) && pr.toScreen(10, 10, 40).y < pr.toScreen(10, 10, 0).y);
  // On-screen heading agrees with where a small step along that heading actually lands.
  let worst = 0;
  for (let k = 0; k < 72; k++) {
    const h = k * TAU / 72;
    const a = pr.toScreen(100, 100), b = pr.toScreen(100 + Math.sin(h), 100 - Math.cos(h));
    const actual = Math.atan2(b.x - a.x, -(b.y - a.y));
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(actual - pr.screenHeading(h)), Math.cos(actual - pr.screenHeading(h)))));
  }
  check(`${view.id}: screenHeading matches real movement on screen`, worst < 1e-9);
  const step = 50, t = { x: pr.sinA, y: pr.cosA };
  check(`${view.id}: things nearer the viewer get a higher draw order`, pr.depthOf(500 + t.x * step, 500 + t.y * step) > pr.depthOf(500, 500));
  const sh = pr.shadowOffset(30), a = pr.toScreen(0, 0), b = pr.toScreen(sh.x, sh.y);
  check(`${view.id}: shadows fall to the left on screen`, b.x - a.x < -10 && Math.abs(b.y - a.y) < Math.abs(b.x - a.x) / 2, `${(b.x - a.x).toFixed(1)}, ${(b.y - a.y).toFixed(1)}`);
}
{
  const pr = new Projection(findView('angled'));
  const e = pr.toScreen(100, 0);
  check('angled: east is turned 40 deg clockwise on screen', near(e.x, 100 * Math.cos(40 * Math.PI / 180)) && near(e.y, 100 * Math.sin(40 * Math.PI / 180) * Math.sin(48 * Math.PI / 180)));
  const calls = []; const off = pr.onChange((p) => calls.push(p.viewId));
  pr.setView(findView('north-up')); off(); pr.setView(findView('angled'));
  check('view-change listeners fire and can be removed', calls.length === 1 && calls[0] === 'north-up');
  check('every view has a unique key for caching drawings', new Set(RENDER.views.map((v) => new Projection(v).key)).size === RENDER.views.length);
}

// --- Visible ground ---
{
  const pr = angled;
  const centre = pr.toScreen(2000, 2000);
  const zoom = 2 * 390 / 900;
  const r = visibleGroundRect(pr, centre.x, centre.y, 780, 1688, zoom, 0);
  const back = r.corners.map((c) => pr.toScreen(c.x, c.y));
  const halfW = 780 / zoom / 2, halfH = 1688 / zoom / 2;
  check('visible ground corners land exactly on the screen corners', near(back[0].x, centre.x - halfW, 1e-6) && near(back[2].y, centre.y + halfH, 1e-6));
  check('visible ground box contains the camera target', r.left < 2000 && r.right > 2000 && r.top < 2000 && r.bottom > 2000);
  const m = visibleGroundRect(pr, centre.x, centre.y, 780, 1688, zoom, 100);
  check('margin enlarges every side by 100', near(m.left, r.left - 100) && near(m.bottom, r.bottom + 100));
}

// --- Low-poly shapes ---
const visibleNames = (mesh, heading, pr) => projectMesh(mesh, heading, pr).flatMap((p) => p.faces.map((f) => f.name)).sort().join(',');
{
  const cube = [box(-20, 20, -20, 20, 0, 40, 0xb0b0b0)];
  check('angled: a box shows its top and two sides', visibleNames(cube, 0, angled) === 'back,right,top', visibleNames(cube, 0, angled));
  const straightDown = new Projection({ azimuthDeg: 0, elevationDeg: 90 });
  check('straight down: only the top is visible (why Milestone 1 looked flat)', visibleNames(cube, 0, straightDown) === 'top');
  const northUp = new Projection(findView('north-up'));
  check('north-up tilt: only the top and one side (why Milestone 1.5 still looked flat)', visibleNames(cube, 0, northUp) === 'back,top', visibleNames(cube, 0, northUp));
  const faces = Object.fromEntries(projectMesh(cube, 0, angled)[0].faces.map((f) => [f.name, f.color & 255]));
  check('flat shading: top brightest, lit side clearly brighter than shaded side', faces.top > faces.right && faces.right > faces.back * 1.2, JSON.stringify(faces));
  const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }, { x: 3, y: 7 }]);
  check('convex hull keeps only the outline', hull.length === 4);
  const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
  const flatShadow = projectShadow([box(-10, 10, -10, 10, 0, 0.001, 0)], 0, angled)[0];
  const footprint = [angled.toScreen(-10, -10), angled.toScreen(10, -10), angled.toScreen(10, 10), angled.toScreen(-10, 10)];
  check('a flat object casts a shadow the size of its footprint', near(area(flatShadow), area(footprint), 0.05), `${area(flatShadow).toFixed(2)} vs ${area(footprint).toFixed(2)}`);
  const tallShadow = projectShadow([box(-10, 10, -10, 10, 0, 60, 0)], 0, angled)[0];
  check('a tall object casts a longer shadow', area(tallShadow) > area(footprint) * 2);
}

// --- The car model ---
{
  const mesh = carMesh('player');
  const pts = mesh.flatMap((p) => p.verts);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), zs = pts.map((p) => p[2]);
  check('car body matches the physics footprint (44 x 84)', near(Math.max(...ys) - Math.min(...ys), CAR_SIZE.length) && Math.max(...xs) - Math.min(...xs) <= CAR_SIZE.width + 3.1,
    `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} x ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}`);
  check('car has real height (roof above body)', Math.max(...zs) >= 30);
  let alwaysTwoSides = true, alwaysRoof = true;
  for (let i = 0; i < RENDER.directions; i++) {
    const parts = projectMesh(mesh, directionHeading(i), angled);
    const body = parts.find((p) => p.layer === 1);
    const sides = body.faces.filter((f) => f.name !== 'top').length;
    if (sides < 1) alwaysTwoSides = false;
    if (!parts.find((p) => p.layer === 2).faces.some((f) => f.name === 'top')) alwaysRoof = false;
  }
  check('every direction shows body sides (not a flat image)', alwaysTwoSides);
  check('every direction shows the roof', alwaysRoof);
  // Height bands and consistent proportions in all 64 directions.
  let glassEverywhere = true, wheelsEverywhere = true, hoodOrBootEverywhere = true;
  const roofLift = [], widths = [];
  for (let i = 0; i < RENDER.directions; i++) {
    const parts = projectMesh(mesh, directionHeading(i), angled);
    const cabin = parts.find((p) => p.layer === 2 && p.faces.some((f) => f.name === 'top') && p.cam.length === 8 && Math.max(...p.cam.map((c) => c.z)) >= 29);
    if (!cabin.faces.some((f) => f.name !== 'top')) glassEverywhere = false;
    if (!parts.some((p) => p.layer === 0 && p.faces.length > 0 && p.cam.every((c) => c.z <= 14.01) && p.cam.some((c) => c.z === 0))) wheelsEverywhere = false;
    if (parts.filter((p) => p.layer === 1).reduce((n, p) => n + p.faces.filter((f) => f.name === 'top').length, 0) < 3) hoodOrBootEverywhere = false;
    // How high the roof stands above the car's own ground point, on screen.
    const roofTop = cabin.faces.find((f) => f.name === 'top').pts;
    const roofCam = cabin.cam.filter((c) => c.z >= 29);
    const groundY = roofCam.reduce((s, c) => s + c.v * angled.squash, 0) / roofCam.length;
    roofLift.push(groundY - roofTop.reduce((s, p) => s + p.y, 0) / roofTop.length);
  }
  check('every direction shows the glass cabin (windscreen, rear or side windows)', glassEverywhere);
  check('every direction shows tires', wheelsEverywhere);
  check('every direction shows hood, middle and boot tops as separate surfaces', hoodOrBootEverywhere);
  check('roof stands at the same screen height in every direction (no squashing when turning)', Math.max(...roofLift) - Math.min(...roofLift) < 1e-6, `${roofLift[0].toFixed(2)} units`);
  const faceShades = (h) => Object.fromEntries(projectMesh(mesh, h, angled).filter((p) => p.layer === 1).flatMap((p) => p.faces.map((f) => [f.name, (f.color >> 16) & 255])));
  const bodyShade = faceShades(0.6);
  const sideShades = Object.entries(bodyShade).filter(([k]) => k !== 'top').map(([, v]) => v);
  check('car: tops brightest, clearly brighter than the sides on average', bodyShade.top > Math.max(...sideShades) && bodyShade.top > sideShades.reduce((a, b) => a + b, 0) / sideShades.length + 30, JSON.stringify(bodyShade));
  // Live shadow outline: covers the car and stretches the way the light goes.
  const sp = carShadowPoints('player');
  const out = sp.map(() => ({ x: 0, y: 0 })), scratch = sp.map(() => ({ x: 0, y: 0 }));
  const n = worldShadowOutline(sp, 1000, 1000, 0.7, angled, out, scratch);
  const sh = angled.shadowOffset(20);
  const ext = Math.max(...out.slice(0, n).map((p) => (p.x - 1000) * sh.x + (p.y - 1000) * sh.y)) / Math.hypot(sh.x, sh.y);
  check('car shadow is one outline, reaching past the car toward the light direction', n >= 4 && n <= sp.length && ext > 40, `${n} points, reaches ${ext.toFixed(0)}`);
}

// --- Choosing a drawing for each heading ---
{
  const n = RENDER.directions, step = TAU / n;
  let worstRot = 0, ok = true, lastIndex = 0, maxJump = 0;
  for (let k = 0; k <= 7200; k++) {
    const h = (k / 7200) * TAU * 2 - TAU;
    const f = frameFor(h, angled, {});
    const idx = Number(f.frame.slice(3));
    if (!(idx >= 0 && idx < n)) ok = false;
    worstRot = Math.max(worstRot, Math.abs(f.rotation));
    if (k > 0) { const d = Math.min(Math.abs(idx - lastIndex), n - Math.abs(idx - lastIndex)); maxJump = Math.max(maxJump, d); }
    lastIndex = idx;
  }
  check('every heading maps to one of the drawings', ok);
  check('turning steps through neighbouring drawings one at a time', maxJump === 1);
  check('leftover rotation stays tiny (smooth 360 turning)', worstRot < step * 0.85, `max ${deg(worstRot)} deg (drawings every ${deg(step)} deg)`);
  check('north = dir0, east = dir16', frameFor(0, angled, {}).frame === 'dir0' && frameFor(Math.PI / 2, angled, {}).frame === `dir${n / 4}`);
}

// --- Memory and sizes ---
let totalMB = 0;
for (const view of RENDER.views) {
  const pr = new Projection(view);
  const layout = atlasLayout(measureCar('player', pr));
  const mb = layout.width * layout.height * 4 / 1e6;
  if (view.id === RENDER.defaultViewId) totalMB = mb;
  check(`${view.id}: car drawings fit a 2048 px texture`, layout.width <= 2048 && layout.height <= 2048, `${layout.width}x${layout.height} px, ${mb.toFixed(1)} MB graphics memory`);
}

// --- Draw order bands ---
{
  // Endless world: this far is about 5 weeks of non-stop driving in one direction.
  const far = 3e8;
  const ranges = RENDER.views.map((v) => { const pr = new Projection(v); return [DEPTH.objects + pr.depthOf(-far, -far), DEPTH.objects + pr.depthOf(far, far)]; });
  const lo = Math.min(...ranges.map((r) => r[0])), hi = Math.max(...ranges.map((r) => r[1]));
  check('standing objects stay between shadows and effects, however far the car drives', lo > DEPTH.shadows && hi < DEPTH.effects - 10, `${lo.toExponential(1)}..${hi.toExponential(1)}`);
  check('bands in order: ground < raised < shadows < objects', DEPTH.ground < DEPTH.raised && DEPTH.raised < DEPTH.shadows && DEPTH.shadows < DEPTH.objects);
}

// --- Props ---
{
  for (const name of ['police', 'interceptor', 'bearcat', 'helicopter', 'wreck', 'wreckRoof']) {
    check(`${name} car model shows faces from the angled camera`, projectMesh(carMesh(name), 0.3, angled).some((p) => p.faces.length > 0));
  }
  const models = [props.concreteBlock({ width: 60, length: 60, height: 50 }), props.barrier({ length: 160 }), props.pineTree(1), props.leafyTree(1), props.lampPost(), props.trafficCone(), props.island(400), props.luckyDie(0), props.hatchback(0xf08fa0), props.sedan(0xecc94b), props.van(0x3fbfa8), props.woodCrate(), props.shippingContainer({ width: 60, length: 130, height: 52, color: 'containerBlue' }), props.monument(), props.roundabout()];
  check('every prop model shows faces from the angled camera', models.every((m) => projectMesh(m, 0.3, angled).some((p) => p.faces.length > 0)));
  const faceCount = models.reduce((s, m) => s + m.reduce((t, p) => t + p.faces.length, 0), 0) + carMesh('player').reduce((t, p) => t + p.faces.length, 0);
  check('models stay low-poly', faceCount < 500, `${faceCount} faces for the car and all ${models.length} prop types`);
}

console.log(`\n(default view car drawings: ${totalMB.toFixed(1)} MB graphics memory)`);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
