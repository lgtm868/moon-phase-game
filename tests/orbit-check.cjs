const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
let mirroredFixture = null;
// Negative control: change only the served response, never the production file.
if (process.env.ORBIT_MIRRORED_FIXTURE === '1') {
  mirroredFixture = fs.readFileSync(path.join(root, 'moon-phase-game.html'), 'utf8');
  for (const [current, original] of [
    ['const moonY = centerY + Math.sin(p) * orbitRadius;', 'const moonY = centerY - Math.sin(p) * orbitRadius;'],
    ['snapPhase(Math.atan2(dy, -dx));', 'snapPhase(Math.atan2(-dy, -dx));']
  ]) {
    assert.equal(mirroredFixture.split(current).length, 2, `negative-control fixture must replace exactly one: ${current}`);
    mirroredFixture = mirroredFixture.replace(current, original);
  }
  console.log('Negative control: serving old mirrored orbit and drag geometry; this run must fail.');
}
let url;
const server = http.createServer((req, res) => {
  const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (mirroredFixture !== null && target === path.join(root, 'moon-phase-game.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(mirroredFixture);
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(data);
  });
});
const artifacts = process.env.ORBIT_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'moon-orbit-'));
const diagonal = Math.SQRT1_2;
// Explicit north-side compass oracle, independent of the production polar transform.
const directions = [
  { name: 'new-left', degrees: 0, x: -1, y: 0 },
  { name: 'waxing-lower-left', degrees: 45, x: -diagonal, y: diagonal },
  { name: 'first-quarter-bottom', degrees: 90, x: 0, y: 1 },
  { name: 'waxing-lower-right', degrees: 135, x: diagonal, y: diagonal },
  { name: 'full-right', degrees: 180, x: 1, y: 0 },
  { name: 'waning-upper-right', degrees: 225, x: diagonal, y: -diagonal },
  { name: 'last-quarter-top', degrees: 270, x: 0, y: -1 },
  { name: 'waning-upper-left', degrees: 315, x: -diagonal, y: -diagonal }
];
const angularDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

async function geometry(page) {
  const box = await page.locator('#space').boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100, 'visible orbit canvas');
  return { box, cx: box.width * .58, cy: box.height * .52,
    radius: Math.min(box.width * .32, box.height * .37) };
}

async function rasterMoon(page, g) {
  return page.locator('#space').evaluate((canvas, { cx, cy, radius }) => {
    const { width, height } = canvas, sx = width / canvas.clientWidth, sy = height / canvas.clientHeight;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    const band = Math.max(14, Math.min(canvas.clientWidth, canvas.clientHeight) * .052) + 4;
    // Find the large neutral illuminated component in the orbital annulus.
    // Background stars are tiny; the Sun and Earth are outside this annulus.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (Math.abs(Math.hypot((x + .5) / sx - cx, (y + .5) / sy - cy) - radius) > band) continue;
      const i = (y * width + x) * 4, r = data[i], green = data[i + 1], b = data[i + 2];
      if (r > 55 && Math.abs(r - green) < 10 && b > r * .92 && b < r * 1.02) mask[y * width + x] = 1;
    }
    let largest = { count: 0 };
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start]) continue;
      const pending = [start]; mask[start] = 0;
      let count = 0, minX = width, maxX = 0, minY = height, maxY = 0;
      while (pending.length) {
        const index = pending.pop(), x = index % width, y = Math.floor(index / width);
        count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
          if (next >= 0 && mask[next]) { mask[next] = 0; pending.push(next); }
        }
      }
      if (count > largest.count) largest = { count, minX, maxX, minY, maxY };
    }
    return { count: largest.count / (sx * sy), x: (largest.maxX + 1) / sx,
      y: (largest.minY + largest.maxY + 1) / (2 * sy),
      width: (largest.maxX - largest.minX + 1) / sx,
      height: (largest.maxY - largest.minY + 1) / sy };
  }, g);
}

async function checkPosition(page, g, direction, label) {
  const actual = await rasterMoon(page, g);
  assert.ok(actual.count > 100, `${label}: nonblank lunar disk ${JSON.stringify(actual)}`);
  near(actual.x, g.cx + direction.x * g.radius, 2.5, `${label}: rendered center X`);
  near(actual.y, g.cy + direction.y * g.radius, 2.5, `${label}: rendered center Y`);
  assert.ok(actual.height > actual.width * 1.5, `${label}: top-down disk is a left-lit half`);
  return actual;
}

async function checkLight(page, g, direction, index) {
  const light = await page.evaluate(({ g, direction }) => {
    const canvas = document.querySelector('#space'), ctx = canvas.getContext('2d');
    const sx = canvas.width / canvas.clientWidth, sy = canvas.height / canvas.clientHeight;
    const x = g.cx + direction.x * g.radius, y = g.cy + direction.y * g.radius;
    const sample = (px, py) => [...ctx.getImageData(Math.round(px * sx), Math.round(py * sy), 1, 1).data];
    const radius = Math.max(14, Math.min(canvas.clientWidth, canvas.clientHeight) * .052);
    const sun = sample(Math.max(25, canvas.clientWidth * .075), g.cy);
    const left = sample(x - radius * .5, y), right = sample(x + radius * .5, y);
    const phase = document.querySelector('#phaseMoon'), pctx = phase.getContext('2d');
    const bytes = pctx.getImageData(0, 0, phase.width, phase.height).data;
    let total = 0, bright = 0, leftBright = 0, rightBright = 0;
    for (let py = 0; py < phase.height; py++) for (let px = 0; px < phase.width; px++) {
      if (Math.hypot(px + .5 - phase.width / 2, py + .5 - phase.height / 2) > phase.width * .36) continue;
      total++;
      if (bytes[(py * phase.width + px) * 4] > 40) {
        bright++; if (px < phase.width / 2) leftBright++; else rightBright++;
      }
    }
    return { sun, left, right, fraction: bright / total, leftBright, rightBright };
  }, { g, direction });
  assert.ok(light.sun[0] > 200 && light.sun[1] > 120 && light.sun[2] < 180, 'Sun visibly on the left');
  assert.ok(light.left[0] > 80 && light.right[0] < 40, `${direction.name}: orbit illumination ${JSON.stringify(light)}`);
  near(light.fraction, [0, .5, 1, .5][index], .08, `${direction.name}: Earth-view illuminated fraction`);
  if (index === 1) assert.ok(light.rightBright > light.leftBright * 10, 'Earth-view waxing stays RIGHT');
  if (index === 3) assert.ok(light.leftBright > light.rightBright * 10, 'Earth-view waning stays LEFT');
}

async function dragTo(page, g, from, target) {
  const point = d => ({ x: g.box.x + g.cx + d.x * g.radius, y: g.box.y + g.cy + d.y * g.radius });
  const start = point(from), end = point(target);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

async function checkProgression(page, g) {
  await page.locator('#resetButton').click();
  let previous = await rasterMoon(page, g), previousAngle = 0;
  for (let step = 1; step <= 16; step++) {
    await page.locator('#stepButton').click();
    const angle = Number(await page.locator('#space').getAttribute('aria-valuenow'));
    const delta = (angle - previousAngle + 360) % 360;
    assert.ok(delta > 0 && delta < 90, `step ${step}: positive phase progression, including wrap (${previousAngle} -> ${angle})`);
    const actual = await rasterMoon(page, g);
    const cross = (previous.x - g.cx) * (actual.y - g.cy) - (previous.y - g.cy) * (actual.x - g.cx);
    assert.ok(cross < -g.radius * g.radius * .1, `step ${step}: observed motion is counterclockwise in screen coordinates`);
    near(Math.hypot(actual.x - g.cx, actual.y - g.cy), g.radius, 3, `step ${step}: fixed orbit radius`);
    if (step % 4 === 0) await checkPosition(page, g, directions[(step / 2) % 8], `step ${step}`);
    previous = actual; previousAngle = angle;
  }
  await page.locator('#resetButton').click();
  await page.locator('#playButton').click();
  await page.clock.runFor(1000);
  const angle = Number(await page.locator('#space').getAttribute('aria-valuenow'));
  assert.ok(angle > 5 && angle < 30, `playback advances positive phase: ${angle}`);
  const actual = await rasterMoon(page, g);
  assert.ok(actual.y > g.cy + g.radius * .08 && actual.x < g.cx, 'playback from new travels down, counterclockwise');
  await page.locator('#playButton').click();
}

async function checkQuizCardinals(page) {
  let checked = 0;
  for (const [tab, offset] of [['#tabQuiz', 0], ['#tabChallenge', 90]]) {
    await page.locator(tab).click();
    const seen = new Set();
    for (let question = 0; question < 20; question++) {
      const source = Number(await page.locator('#quizPanel').getAttribute('data-source-angle')) * 180 / Math.PI;
      const cardinal = directions.find(d => d.degrees % 90 === 0 && angularDistance(source, d.degrees) < 1e-7);
      const choices = await page.locator('#quizOptions button').evaluateAll(buttons => buttons.map(b => ({
        id: b.dataset.phase, degrees: Number(b.dataset.angle) * 180 / Math.PI
      })));
      const answers = choices.filter(c => angularDistance(c.degrees, (source + offset) % 360) < 1e-7);
      assert.equal(answers.length, 1, 'unique geometrically correct quiz answer');
      const answer = answers[0], wrong = choices.find(c => c.id !== answer.id);
      const g = await geometry(page);
      const originalAngle = await page.locator('#space').getAttribute('aria-valuenow');
      if (cardinal) {
        seen.add(cardinal.degrees); checked++;
        await checkPosition(page, g, cardinal, `${tab} source ${cardinal.name}`);
        await page.locator(`#quizOptions button[data-phase="${wrong.id}"]`).click();
        await checkPosition(page, g, cardinal, `${tab} wrong answer preserves ${cardinal.name}`);
        assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), originalAngle);
      }
      await page.locator(`#quizOptions button[data-phase="${answer.id}"]`).click();
      assert.equal(await page.locator('#quizNext').isDisabled(), false, 'correct answer accepted');
      if (cardinal) {
        await checkPosition(page, g, cardinal, `${tab} solved preserves SOURCE ${cardinal.name}`);
        assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), originalAngle);
      }
      await page.locator('#quizNext').click();
    }
    assert.deepEqual([...seen].sort((a, b) => a - b), [0, 90, 180, 270], `${tab}: bounded deck covers four sources`);
  }
  return checked;
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/moon-phase-game.html`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const errors = [], report = [];
  try {
    for (const [width, height, deviceScaleFactor] of [[1280, 800, 1], [390, 844, 2], [740, 360, 1]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(10000);
      try {
        await page.clock.install();
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);
        await page.locator('#voiceButton').click();
        const g = await geometry(page);
        const cardinals = [];
        for (let index = 0; index < 4; index++) {
          const direction = directions[index * 2];
          await page.locator('.phase-choice').nth(index * 4).click();
          await page.locator('#space').screenshot({ path: path.join(artifacts, `${width}-${direction.name}.png`) });
          assert.equal(Number(await page.locator('#space').getAttribute('aria-valuenow')), direction.degrees);
          cardinals.push(await checkPosition(page, g, direction, `${width}: ${direction.name}`));
          await checkLight(page, g, direction, index);
        }
        // Non-sequential targets distinguish all quadrants and cross the 0/360 seam.
        for (const index of [0, 4, 2, 6, 1, 5, 3, 7, 0]) {
          const target = directions[index];
          // Start on a side: the compact layout has real controls over the top arc.
          await dragTo(page, g, directions[index === 0 ? 4 : 0], target);
          const actual = Number(await page.locator('#space').getAttribute('aria-valuenow'));
          assert.ok(angularDistance(actual, target.degrees) <= 1, `${width} drag ${target.name}: ${actual}`);
          await checkPosition(page, g, target, `${width} drag ${target.name}`);
        }
        await checkProgression(page, g);
        const quizCardinals = width === 1280 ? await checkQuizCardinals(page) : 0;
        report.push({ width, height, deviceScaleFactor, cardinals, dragChecks: 9, forwardSteps: 16, quizCardinals });
      } finally { await page.close(); }
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log(JSON.stringify({ passed: true, artifacts, report }, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { server.close(); console.error(error); process.exitCode = 1; });
