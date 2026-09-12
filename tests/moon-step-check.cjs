'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const TAU = Math.PI * 2, DAYS = 29.53059, EPS = 1e-8;
const ages = [0, 1, 2, 5, DAYS / 4, 9, 12, 13, DAYS / 2, 15.5, 16.5, 17.5, DAYS * 3 / 4, 24, 26, 28];
const stops = [...new Set([...ages, ...Array.from({ length: 30 }, (_, i) => i)])].sort((a, b) => a - b).map(age => age / DAYS * TAU);
const normalize = value => (value % TAU + TAU) % TAU;
const distance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const near = (a, b, label) => assert.ok(distance(a, b) < EPS, `${label}: ${a} vs ${b}`);
const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'moon-phase-game.html')).href;
const source = fs.readFileSync(path.join(root, 'moon-phase-game.html'), 'utf8').replace(/\r\n/g, '\n');
const marker = '      buildPhasePicker();\n      updateAlbumCount();';
assert.equal(source.split(marker).length, 2, 'one initialization point for read-only test probe');
// Instrument only the browser response, never the application file or its behavior.
const fixture = source.replace(marker, '      window.__moonStepRead = () => ({ phase, ages: [...phaseAges] });\n' + marker);
const read = page => page.evaluate(() => window.__moonStepRead().phase);
const click = (page, selector) => page.locator(selector).evaluate(button => button.click());
const key = (page, value) => page.locator('#space').dispatchEvent('keydown', { key: value });
async function settle(page) { await page.clock.runFor(400); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  const errors = [];
  try {
    for (const reducedMotion of ['reduce', 'no-preference']) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion });
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.clock.pauseAt(new Date());
      await page.addInitScript(() => {
        window.__spoken = [];
        window.__speechCancels = 0;
        speechSynthesis.speak = utterance => __spoken.push(utterance.text);
        speechSynthesis.cancel = () => { window.__speechCancels++; };
      });
      await page.route('**/moon-phase-game.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
      await page.goto(url);
      assert.deepEqual(await page.evaluate(() => __moonStepRead().ages), ages, 'named ages remain authoritative');
      assert.equal(await page.locator('#phaseList button').count(), 16);
      await click(page, '#resetButton');
      const observed = [await read(page)];
      for (let i = 1; i <= stops.length; i++) {
        await click(page, '#stepButton');
        if (reducedMotion === 'no-preference') await settle(page);
        const actual = await read(page), previous = observed.at(-1);
        near(actual, stops[i % stops.length], `cycle ${reducedMotion} step ${i}`);
        const delta = normalize(actual - previous);
        assert.ok(delta > EPS && delta <= TAU / DAYS + EPS, `maximum one-day gap: ${delta}`);
        observed.push(actual);
      }
      for (const age of ages) assert.ok(observed.some(angle => distance(angle, age / DAYS * TAU) < EPS), `visits named age ${age}`);
      for (let i = 1; i <= stops.length; i++) {
        await key(page, 'ArrowLeft');
        if (reducedMotion === 'no-preference') await settle(page);
        near(await read(page), stops[(stops.length - i) % stops.length], `reverse cycle ${i}`);
      }
      await click(page, '#resetButton');
      for (const input of ['ArrowRight', 'ArrowUp', 'ArrowDown']) {
        await key(page, input);
        if (reducedMotion === 'no-preference') await settle(page);
      }
      near(await read(page), stops[1], 'up/right forward and down backward');
      await click(page, '#resetButton');
      await page.evaluate(() => { for (let i = 0; i < 6; i++) document.querySelector('#stepButton').click(); });
      await page.clock.runFor(2200);
      near(await read(page), stops[6], 'rapid inputs accumulate against pending destination');
      await click(page, '#resetButton');
      for (let i = 0; i < 3; i++) {
        const angle = await read(page);
        const box = await page.locator('#space').boundingBox();
        const radius = Math.min(box.width * .32, box.height * .37);
        await page.mouse.click(box.x + box.width * .58 - Math.cos(angle) * radius,
          box.y + box.height * .52 + Math.sin(angle) * radius);
      }
      await page.clock.runFor(1200);
      near(await read(page), stops[3], 'moon taps use pending destination without pointerdown cancelling it');

      if (reducedMotion === 'no-preference') {
        await click(page, '#resetButton');
        await page.evaluate(() => {
          for (let i = 0; i < 3; i++) document.querySelector('#stepButton').click();
          document.querySelector('#space').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        });
        let mixedPrevious = await read(page), mixedTravel = 0;
        for (let i = 0; i < 20; i++) {
          await page.clock.runFor(16);
          const current = await read(page);
          mixedTravel += distance(current, mixedPrevious);
          mixedPrevious = current;
        }
        near(mixedPrevious, stops[2], 'rapid direction change retains queued destination');
        assert.ok(mixedTravel <= stops[3] + EPS, `rapid direction change avoids near-full revolution: ${mixedTravel}`);
        for (const direction of [-1, 1]) {
          await click(page, '#resetButton');
          if (direction === 1) { await key(page, 'ArrowLeft'); await settle(page); }
          let previous = await read(page), travel = 0, movingSamples = 0;
          await key(page, direction === 1 ? 'ArrowRight' : 'ArrowLeft');
          for (let i = 0; i < 20; i++) {
            await page.clock.runFor(16);
            const current = await read(page);
            const delta = Math.atan2(Math.sin(current - previous), Math.cos(current - previous));
            assert.ok(delta * direction >= -EPS, 'wrap never reverses direction');
            travel += Math.abs(delta);
            if (Math.abs(delta) > EPS) movingSamples++;
            previous = current;
          }
          assert.ok(movingSamples >= 3, 'movement has multiple intermediate frames');
          assert.ok(travel <= TAU / DAYS + EPS, 'wrap uses short path');
          near(previous, direction === 1 ? 0 : stops.at(-1), 'wrap settles by 320ms');
        }
        for (const reason of ['reset', 'picker', 'quiz', 'drag', 'hidden', 'pagehide']) {
          await click(page, '#tabMoon');
          await click(page, '#resetButton');
          await click(page, '#stepButton');
          await page.clock.runFor(80);
          assert.ok(await read(page) > EPS && await read(page) < stops[1] - EPS, `${reason}: interrupt in flight`);
          if (reason === 'reset') await click(page, '#resetButton');
          if (reason === 'picker') await page.locator('#phaseList button').nth(8).evaluate(button => button.click());
          if (reason === 'quiz') await click(page, '#tabQuiz');
          if (reason === 'drag') {
            const box = await page.locator('#space').boundingBox();
            const x = box.x + box.width * .58, y = box.y + box.height * .52;
            const r = Math.min(box.width * .32, box.height * .37);
            await page.mouse.move(x - r, y);
            await page.mouse.down();
            await page.mouse.move(x, y + r, { steps: 4 });
            await page.mouse.up();
          }
          if (reason === 'hidden' || reason === 'pagehide') await page.evaluate(reason => {
            if (reason === 'hidden') {
              Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
              document.dispatchEvent(new Event('visibilitychange'));
            } else window.dispatchEvent(new Event('pagehide'));
          }, reason);
          const expected = await read(page);
          const spoken = await page.evaluate(() => __spoken.length);
          await page.clock.runFor(1200);
          near(await read(page), expected, `${reason}: no stale animation write`);
          assert.equal(await page.evaluate(() => __spoken.length), spoken, `${reason}: no stale completion speech`);
          if (reason === 'reset') near(expected, 0, 'reset wins');
          if (reason === 'picker') near(expected, Math.PI, 'picker wins');
          if (reason === 'drag') assert.ok(distance(expected, Math.PI / 2) < Math.PI / 180, 'drag wins within pointer coordinate precision');
          if (reason === 'hidden') await page.evaluate(() => {
            delete document.hidden;
            document.dispatchEvent(new Event('visibilitychange'));
          });
        }
      }
      console.log(`PASS ${reducedMotion}: ${stops.length} stops, <=1-day gaps, all named anchors, reverse and rapid inputs`);
      await page.close();
    }
    assert.deepEqual(errors, [], 'no browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
