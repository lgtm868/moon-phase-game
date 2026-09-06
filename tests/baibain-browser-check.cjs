const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'output', 'playwright');
fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return res.writeHead(404).end();
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(data);
  });
});

async function assertHorizontalFit(page, label) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('button, input, select, canvas')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
    }).map(el => ({ id: el.id, tag: el.tagName, text: el.textContent }))
  }));
  assert(layout.scrollWidth <= layout.width + 1, `${label}: horizontal document overflow ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.overflow, [], `${label}: controls exceed viewport`);
}

async function seek(page, seconds) {
  await page.locator('#timeline').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(seconds));
  await page.clock.runFor(50);
}

async function assertCount(page, seconds) {
  const expected = 1n << BigInt(Math.floor(seconds / 300));
  const actual = await page.locator('#exactCount').textContent();
  assert.equal(actual.replace(/[,\s個]/g, ''), expected.toString(), `Exact count at ${seconds} seconds`);
  assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false', 'Seeking pauses playback');
  assert.equal(await page.locator('#formula').textContent(), `2^${Math.floor(seconds / 300)} · ${Math.floor(seconds / 300)}回の倍増`);
}

async function assertSceneLabels(page, label) {
  const labels = await page.evaluate(() => window.__sceneLabels || []);
  assert(labels.length > 0, `${label}: scene actually renders captions`);
  const clipped = labels.filter(item => item.left < -1 || item.right > item.canvasWidth + 1 || item.y < 0 || item.y > item.canvasHeight);
  assert.deepEqual(clipped, [], `${label}: scene labels are visible`);
  const obscured = await page.evaluate(() => {
    const canvas = document.querySelector('#scene').getBoundingClientRect();
    const controls = document.querySelector('.camera-controls').getBoundingClientRect();
    return (window.__sceneLabels || []).filter(item =>
      item.left + canvas.left < controls.right && item.right + canvas.left > controls.left &&
      item.y + canvas.top + 5 > controls.top && item.y + canvas.top - 5 < controls.bottom);
  });
  assert.deepEqual(obscured, [], `${label}: camera controls do not obscure scene captions`);
  return labels.map(item => item.text);
}

async function checkCosmicScale(page, width, height) {
  const references = [
    { id: 'sun', label: '太陽', milestone: 'sun-diameter' },
    { id: 'solar-system', label: '海王星', milestone: 'solar-system-diameter' },
    { id: 'milky-way', label: '天の川', milestone: 'milky-way-diameter' },
    { id: 'observable-universe', label: '観測可能', milestone: 'observable-universe-diameter' }
  ];
  await page.locator('#reference').selectOption('auto');
  await page.locator('#range').selectOption('86400');
  const milestones = await page.evaluate(() => BaibainModel.milestones());
  let previousCaption = '';
  for (const reference of references) {
    const milestone = milestones.find(item => item.id === reference.milestone);
    assert(milestone && Number.isFinite(milestone.seconds), `${reference.milestone}: available before 24h`);
    await seek(page, milestone.seconds - 1);
    await assertCount(page, milestone.seconds - 1);
    const before = await page.locator('#referenceLabel').textContent();
    await page.locator('#openMilestones').click();
    await page.locator('#milestonesDialog').waitFor({ state: 'visible' });
    await page.locator(`#cosmicMilestones [data-time="${milestone.seconds}"]`).click();
    assert.ok(await page.locator('#milestonesDialog').isHidden(), 'Jump closes the dialog and reveals the scene');
    await page.clock.runFor(100);
    await assertCount(page, milestone.seconds);
    const after = await page.locator('#referenceLabel').textContent();
    assert.match(after, new RegExp(reference.label), `${reference.id}: active scale label`);
    assert.notEqual(after, before, `${reference.id}: reference changes at its boundary`);
    assert.notEqual(after, previousCaption, `${reference.id}: new cosmic scale caption`);
    previousCaption = after;
    assert.equal(await page.locator('#spaceComparison').isVisible(), true);
    const ratio = await page.locator('#referenceRatio').textContent();
    assert(!/NaN|Infinity|undefined/.test(ratio), `${reference.id}: finite ratio`);
    await assertHorizontalFit(page, `${reference.id} ${width}x${height}`);
    const captions = await assertSceneLabels(page, `${reference.id} ${width}x${height}`);
    assert.match(captions.join(' '), new RegExp(reference.label), `${reference.id}: canvas caption agrees with readout`);
    if (height > 400) await page.screenshot({ path: path.join(artifacts, `baibain-cosmic-${reference.id}-${width}x${height}.png`), fullPage: true });
  }
  await seek(page, 86400);
  assert.match(await page.locator('#referenceLabel').textContent(), /観測可能/);
  await seek(page, 25500);
  assert.match(await page.locator('#referenceLabel').textContent(), /地球/);
  await seek(page, 0);
  for (const reference of [{ id: 'earth', label: '地球' }, ...references]) {
    await page.locator('#reference').selectOption(reference.id);
    await page.clock.runFor(100);
    assert.equal(await page.locator('#spaceComparison').isVisible(), true, `${reference.id}: manual selection opens comparison even at initial count`);
    assert.match(await page.locator('#referenceLabel').textContent(), new RegExp(reference.label));
    await assertCount(page, 0);
    await seek(page, 86400);
    assert.equal(await page.locator('#reference').inputValue(), reference.id, 'Seeking retains manual reference choice');
    assert.match(await page.locator('#referenceLabel').textContent(), new RegExp(reference.label));
    const captions = await assertSceneLabels(page, `Manual ${reference.id} ${width}x${height}`);
    assert.match(captions.join(' '), new RegExp(reference.label), `${reference.id}: manual canvas caption agrees with readout`);
    await seek(page, 0);
  }
  await page.locator('#reference').selectOption('auto');
  await page.clock.runFor(100);
  assert.equal(await page.locator('#spaceComparison').isVisible(), false, 'Auto returns to tabletop when rewound');
}

async function checkControls(page) {
  for (const seconds of [0, 299, 300, 599, 600, 3599, 3600]) {
    await seek(page, seconds);
    await assertCount(page, seconds);
  }
  await seek(page, 299);
  assert.equal(await page.locator('#next').textContent(), '00:01');
  await seek(page, 300);
  assert.equal(await page.locator('#next').textContent(), '05:00');
  await page.locator('#reset').click();
  await page.locator('#step').click();
  await assertCount(page, 300);
  assert.equal(await page.locator('#elapsed').textContent(), '00:05:00');
  for (const speed of [1, 60, 300, 1800]) {
    await page.locator('#reset').click();
    await page.locator('#speed').selectOption(String(speed));
    await page.locator('#play').click();
    await page.clock.runFor(1050);
    const seconds = Number(await page.locator('#timeline').inputValue());
    assert(seconds >= speed * 0.98 && seconds <= speed * 1.1, `Speed ${speed}: advanced ${seconds}s`);
    await page.locator('#play').click();
    const stopped = await page.locator('#elapsed').textContent();
    await page.clock.runFor(1100);
    assert.equal(await page.locator('#elapsed').textContent(), stopped, `Speed ${speed}: pause holds time`);
  }
  for (const view of ['close', 'wide', 'auto']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.clock.runFor(50);
    assert.equal(await page.locator('[data-view][aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#openMilestones').click();
  await page.locator('[data-time="25500"]').click();
  assert.ok(await page.locator('#milestonesDialog').isHidden());
  await assertCount(page, 25500);
  await page.locator('#range').selectOption('10800');
  await assertCount(page, 10800);
  assert.equal(await page.locator('#timeline').getAttribute('max'), '10800');
  await page.locator('#range').selectOption('86400');
  await seek(page, 86399);
  await page.locator('#speed').selectOption('1800');
  await page.locator('#play').click();
  await page.clock.runFor(100);
  await assertCount(page, 86400);
  assert.equal(await page.locator('#elapsed').textContent(), '24:00:00');
  assert.equal(await page.locator('#step').isDisabled(), true);
  assert.match(await page.locator('#nextLabel').textContent(), /完了/);
  assert(!/NaN|Infinity|undefined/.test(await page.locator('.readout').innerText()), '24h readouts remain finite and defined');
  await page.locator('#play').click();
  await page.clock.runFor(100);
  assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true');
  assert(Number(await page.locator('#timeline').inputValue()) < 300, 'Play at the end restarts');
  await page.locator('#reset').click();
  await assertCount(page, 0);
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const failures = [];
  try {
    for (const [width, height] of [[1440, 960], [390, 844], [320, 568], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => failures.push(error.message));
      page.on('response', response => {
        if (/baibain.*\.(html|js)(?:\?|$)/.test(response.url()) && !response.ok()) failures.push(`${response.status()} ${response.url()}`);
      });
      await page.addInitScript(() => {
        const transform = CanvasRenderingContext2D.prototype.setTransform;
        CanvasRenderingContext2D.prototype.setTransform = function(...args) {
          if (this.canvas.id === 'scene') window.__sceneStartsFrame = true;
          return transform.apply(this, args);
        };
        const text = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(value, x, y, ...rest) {
          if (this.canvas.id === 'scene') {
            if (window.__sceneStartsFrame) { window.__sceneLabels = []; window.__sceneStartsFrame = false; }
            const width = this.measureText(value).width;
            const left = x - (this.textAlign === 'center' ? width / 2 : this.textAlign === 'right' || this.textAlign === 'end' ? width : 0);
            (window.__sceneLabels ||= []).push({ text: value, left, right: left + width, y, canvasWidth: this.canvas.clientWidth, canvasHeight: this.canvas.clientHeight });
          }
          return text.call(this, value, x, y, ...rest);
        };
      });
      await page.clock.install();
      await page.goto(`${base}/baibain-game.html?standalone=1`);
      await page.evaluate(() => document.fonts.ready);
      await page.clock.runFor(50);
      assert.equal(await page.locator('#exactCount').textContent(), '1 個', 'Simulator initializes');
      await assertHorizontalFit(page, `${width}x${height}`);
      await page.screenshot({ path: path.join(artifacts, `baibain-${width}x${height}.png`), fullPage: true });
      if (width === 1440) await checkControls(page);
      await checkCosmicScale(page, width, height);
      await page.locator('#range').selectOption('86400');
      for (const seconds of [3600, 13200, 25500, 86400]) {
        await seek(page, seconds);
        await assertCount(page, seconds);
        await assertHorizontalFit(page, `${width}x${height} at ${seconds}s`);
        if (width >= 390 && height > 400) {
          await page.clock.runFor(1600); // Let the intentionally animated camera settle after seeking.
          await page.screenshot({ path: path.join(artifacts, `baibain-${width}x${height}-${seconds}s.png`), fullPage: true });
          await assertSceneLabels(page, `${width}x${height} at ${seconds}s`);
        }
      }
      await page.locator('[data-view="close"]').click();
      await page.clock.runFor(1600);
      await assertCount(page, 86400);
      if (width === 390) await page.screenshot({ path: path.join(artifacts, 'baibain-close-24h-mobile.png'), fullPage: true });
      await page.locator('[data-view="auto"]').click();
      await page.clock.runFor(1600);
      await page.close();
    }
    for (const [width, height] of [[390, 844], [320, 568]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(`${base}/index.html?game=baibain`);
      const frame = await (await page.locator('#gameFrame').elementHandle()).contentFrame();
      await frame.locator('#play').waitFor();
      await assertHorizontalFit(page, `Integrated wrapper ${width}`);
      await assertHorizontalFit(frame, `Integrated simulator ${width}`);
      assert.equal(await page.locator('.game-menu-card[data-nav-game="baibain"]').getAttribute('aria-current'), 'page');
      const playRect = await frame.locator('#play').boundingBox();
      assert(playRect.y < height, `Integrated ${width}: play button starts within viewport`);
      await page.screenshot({ path: path.join(artifacts, `baibain-integrated-${width}x${height}.png`), fullPage: true });
      await page.locator('#gameMenuToggle').click();
      await page.locator('#gameMenu').waitFor({ state: 'visible' });
      await page.locator('.game-menu-card[data-nav-game="moon"]').click();
      const moon = await (await page.locator('#gameFrame').elementHandle()).contentFrame();
      await moon.locator('#space').waitFor();
      assert.ok(await moon.locator('a[href="index.html?game=baibain"]').isHidden(), 'Embedded Moon uses the shared navigation');
      assert.equal(await page.locator('.game-menu-card[data-nav-game="moon"]').getAttribute('aria-current'), 'page');
      await page.locator('#gameMenuToggle').click();
      await page.locator('#gameMenu').waitFor({ state: 'visible' });
      const links = await page.locator('.game-menu-card[data-nav-game]').evaluateAll(elements => elements.map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, left: r.left, right: r.right, linkWidth: r.width, width: innerWidth };
      }));
      assert(links.length > 0 && links.every(link => link.linkWidth > 0 && link.left >= -1 && link.right <= link.width + 1), `Moon navigation links fit ${width}: ${JSON.stringify(links)}`);
      await page.locator('.game-menu-card[data-nav-game="baibain"]').click();
      await page.waitForURL(/game=baibain/);
      await page.frameLocator('#gameFrame').locator('#play').waitFor();
      assert.equal(await page.locator('.game-menu-card[data-nav-game="baibain"]').getAttribute('aria-current'), 'page');
      assert.equal(page.frames().length, 2, 'Game switch replaces the frame without nesting');
      await page.close();
    }
    const direct = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    direct.on('pageerror', error => failures.push(error.message));
    await direct.goto(`${base}/moon-phase-game.html?standalone=1`);
    await direct.locator('a.local-menu').click();
    await direct.waitForURL(/game=moon/);
    await direct.locator('#gameMenuToggle').click();
    await direct.locator('.game-menu-card[data-nav-game="baibain"]').click();
    await direct.waitForURL(/game=baibain/);
    await direct.frameLocator('#gameFrame').locator('#play').waitFor();
    assert.equal(direct.frames().length, 2, 'Standalone Moon entry opens the shared wrapper without nesting');
    await direct.goto(`${base}/baibain-game.html?standalone=1&t=84900`);
    await direct.waitForFunction(() => document.querySelector('#referenceLabel').textContent.includes('観測可能'));
    await assertCount(direct, 84900);
    assert.equal(await direct.locator('#range').inputValue(), '86400');
    await direct.screenshot({ path: path.join(artifacts, 'baibain-cosmic-direct-universe.png'), fullPage: true });
    await direct.close();
    assert.deepEqual(failures, [], 'No browser JavaScript errors');
    console.log('PASS: Baibain exact count boundaries, playback controls, all four cosmic threshold jumps, five manual references, reference rewind/persistence, 24h completion, four viewports and cosmic captions, canvas label fit, mobile integration and Moon entry, and JavaScript errors.');
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
