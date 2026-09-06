// Node-only regression: execute the production functions with a synthetic atlas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'moon-phase-game.html'), 'utf8');
const first = html.indexOf('      function moonTexture(');
const last = html.indexOf('      function drawSprunkiSpriteOnEarth(', first);
assert.ok(first >= 0 && last > first, 'production texture/render functions located');
const source = html.slice(first, last);
const TAU = 2 * Math.PI;
let checks = 0;

// Distinct atlas bands and meridians. No inverse camera transform in the oracle.
function marker(latitude, longitude) {
  if (latitude > 75) return 220;
  if (latitude < -75) return 12;
  const band = latitude > 45 ? 160 : latitude > 15 ? 128
    : latitude > -15 ? 96 : latitude > -45 ? 64 : 32;
  const meridian = Math.abs(longitude) < 45 ? 0 : longitude >= 45 && longitude < 135 ? 1
    : Math.abs(longitude) >= 135 ? 2 : 3;
  return band + meridian * 4;
}

function atlas(constant = null) {
  const width = 360, height = 180, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = constant === null ? marker(89.5 - y, x - 179.5) : constant;
    data.set([value, value, value, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

function harness(map = atlas(), program = source) {
  const context = vm.createContext({
    TAU, lunarMap: map, moonMarks: [], moonSurfaces: new Map(), moonFrames: new Map(),
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const canvas = { width: 0, height: 0, image: null };
        canvas.getContext = () => ({
          createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: image => { canvas.image = image; }
        });
        return canvas;
      }
    }
  });
  vm.runInContext(program, context, { filename: 'moon-phase-game.html:extracted-renderers', timeout: 1000 });
  return context;
}

function equal(actual, expected, label) {
  checks++;
  assert.equal(actual, expected, label);
}

function sample(context, x, y, angle, latitude, longitude, label) {
  equal(Math.round(context.moonTexture(x, y, angle) * 255), marker(latitude, longitude), label);
}

const directions = [
  { name: 'right', x: 1, y: 0 }, { name: 'up', x: 0, y: -1 },
  { name: 'left', x: -1, y: 0 }, { name: 'down', x: 0, y: 1 }
];
// At new moon Earth is right of the Moon; at first quarter it is above it.
// Each row lists body longitudes at screen right/up/left/down, by inspection.
const cardinalLongitudes = [
  [0, 90, 180, -90], [-90, 0, 90, 180],
  [180, -90, 0, 90], [90, 180, -90, 0]
];
const rings = [{ radius: 1, latitude: 0 }, { radius: Math.sqrt(3) / 2, latitude: 30 },
  { radius: .5, latitude: 60 }];

function polarLandmarks(context) {
  cardinalLongitudes.forEach((longitudes, quarter) => {
    const angle = quarter * TAU / 4;
    sample(context, 0, 0, angle, 90, 0, `north pole centered at ${quarter * 90} degrees`);
    for (const ring of rings) directions.forEach((direction, index) => {
      sample(context, direction.x * ring.radius, direction.y * ring.radius, angle,
        ring.latitude, longitudes[index], `polar ${quarter * 90}: ${direction.name}, latitude ${ring.latitude}`);
    });
  });
}

function earthLandmarks(context) {
  const points = [
    [0, 0, 0, 0], [1, 0, 0, 90], [-1, 0, 0, -90],
    [0, -1, 90, 0], [0, 1, -90, 0],
    [0, -.5, 30, 0], [0, .5, -30, 0],
    [0, -Math.sqrt(3) / 2, 60, 0], [0, Math.sqrt(3) / 2, -60, 0],
    [Math.sqrt(3) / 2, 0, 0, 60], [-Math.sqrt(3) / 2, 0, 0, -60]
  ];
  for (const [x, y, latitude, longitude] of points) {
    sample(context, x, y, null, latitude, longitude, `Earth view ${longitude}/${latitude}`);
    equal(context.moonTexture(x, y), context.moonTexture(x, y, null), 'omitted pole angle preserves Earth view');
  }
}

function render(context, view, angle = 0, radius = 32) {
  let result;
  const target = { drawImage(frame) { result = frame.image; } };
  if (view === 'above') context.drawMoonFromAbove(target, 0, 0, radius, angle);
  else if (view === 'earth') context.drawMoonPhase(target, 0, 0, radius, angle);
  // Identical light vectors intentionally stress view-only cache separation.
  else context.drawLitMoon(target, 0, 0, radius, -1, 0, 0, view === 'fixed-earth' ? null : angle);
  assert.ok(result && result.data.some(value => value !== 0), 'renderer produced pixels');
  return result;
}

function pixel(image, x, y) {
  const col = Math.min(image.width - 1, Math.floor((x + 1) * image.width / 2));
  const row = Math.min(image.height - 1, Math.floor((y + 1) * image.height / 2));
  return Array.from(image.data.slice((row * image.width + col) * 4, (row * image.width + col) * 4 + 4));
}

function sameFrame(actual, expected, label) {
  checks++;
  assert.equal(actual.width, expected.width, label);
  assert.equal(Buffer.compare(Buffer.from(actual.data), Buffer.from(expected.data)), 0, label);
}

function renderedLandmarks(context) {
  // Constant-color reference renders isolate texture selection from the shader.
  // Sample away from the pole/limb and atlas boundaries, including the dark side.
  cardinalLongitudes.forEach((longitudes, quarter) => {
    const angle = quarter * TAU / 4, actual = render(context, 'above', angle);
    directions.forEach((direction, index) => {
      const reference = render(harness(atlas(marker(60, longitudes[index]))), 'above', angle);
      checks++;
      assert.deepEqual(pixel(actual, direction.x * .5, direction.y * .5),
        pixel(reference, direction.x * .5, direction.y * .5), `rendered polar landmark ${quarter}/${direction.name}`);
    });
  });
  const full = render(context, 'earth', Math.PI);
  for (const [x, y, latitude, longitude] of [[0, 0, 0, 0], [0, -.5, 30, 0], [0, .5, -30, 0],
    [Math.sqrt(3) / 2, 0, 0, 60], [-Math.sqrt(3) / 2, 0, 0, -60]]) {
    const reference = render(harness(atlas(marker(latitude, longitude))), 'earth', Math.PI);
    checks++;
    assert.deepEqual(pixel(full, x, y), pixel(reference, x, y), `full Earth-view landmark ${longitude}/${latitude}`);
  }
}

function cacheOrder(context) {
  const cases = [
    { view: 'fixed-earth', angle: 0 },
    ...[0, 1, 2, 3].map(q => ({ view: 'fixed-pole', angle: q * TAU / 4 })),
    ...[0, 1, 2, 3].map(q => ({ view: 'above', angle: q * TAU / 4 })),
    ...[0, 1, 2, 3].map(q => ({ view: 'earth', angle: q * TAU / 4 }))
  ];
  const cold = cases.map(c => render(harness(), c.view, c.angle));
  assert.notDeepEqual(Buffer.from(cold[0].data), Buffer.from(cold[1].data), 'fixture distinguishes Earth and polar views');
  assert.notDeepEqual(Buffer.from(cold[1].data), Buffer.from(cold[2].data), 'fixture distinguishes rotation');
  for (const order of [cases.map((_, i) => i), cases.map((_, i) => i).reverse(), [4, 0, 2, 1, 3, 0, 4, 1]]) {
    for (const i of order) sameFrame(render(context, cases[i].view, cases[i].angle), cold[i], `cache order case ${i}`);
  }
  // Exercise eviction with many sizes, rotations and lighting vectors.
  for (let i = 0; i < 110; i++) render(context, i % 2 ? 'earth' : 'above', i * .071, 18 + i % 20);
  cases.forEach((c, i) => sameFrame(render(context, c.view, c.angle), cold[i], `cache after eviction ${i}`));
}

polarLandmarks(harness());
earthLandmarks(harness());
renderedLandmarks(harness());
cacheOrder(harness());

// Negative controls alter only in-memory test fixtures, never the HTML file.
const noRotation = harness();
const actualTexture = noRotation.moonTexture;
noRotation.moonTexture = (x, y, angle = null) => actualTexture(x, y, angle === null ? null : 0);
assert.throws(() => polarLandmarks(noRotation), assert.AssertionError, 'oracle rejects missing synchronous rotation');
const wrongHemisphere = harness();
wrongHemisphere.moonTexture = (x, y) => actualTexture(x, y, null);
assert.throws(() => polarLandmarks(wrongHemisphere), assert.AssertionError, 'oracle rejects reused Earth-facing texture');
const poisoned = harness();
class AliasedMap extends Map {
  get() { return this.value; }
  set(key, value) { this.value = value; return super.set(key, value); }
}
poisoned.moonSurfaces = new AliasedMap();
assert.throws(() => cacheOrder(poisoned), assert.AssertionError, 'oracle rejects a view-blind surface cache');
const poisonedFrames = harness();
poisonedFrames.moonFrames = new AliasedMap();
assert.throws(() => cacheOrder(poisonedFrames), assert.AssertionError, 'oracle rejects a view-blind frame cache');

console.log(`PASS: lunar polar/Earth landmarks, rendered texture, cache ordering/eviction (${checks} assertions; 4 negative controls).`);
