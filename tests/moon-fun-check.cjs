'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'output', 'playwright', 'moon-album');
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
  const errors = [];
  try {
    for (const embedded of [false, true]) for (const [width, height] of [[1024, 600], [1180, 820], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(root, embedded ? 'index.html' : 'moon-phase-game.html')).href + '?game=moon');
      const game = embedded ? page.frameLocator('#gameFrame') : page;
      await game.locator('#albumButton').waitFor();
      assert.match(await game.locator('#albumButton').innerText(), /0\/16/);
      await game.locator('#albumButton').click();
      assert.equal(await game.locator('#albumGrid button:disabled').count(), 16);
      await game.locator('#albumClose').click();
      await game.locator('#voiceButton').click();
      for (let i = 0; i < 16; i++) await game.locator('#phaseList button').nth(i).click();
      await game.locator('#phaseList button').nth(15).click();
      assert.match(await game.locator('#albumButton').innerText(), /16\/16/);
      assert.equal(await game.locator('#phaseList .is-found').count(), 16);
      await game.locator('#albumButton').click();
      assert.equal(await game.locator('#albumGrid .collected').count(), 16);
      assert.match(await game.locator('#albumStatus').innerText(), /ぜんぶ/);
      const bounds = await game.locator('#moonAlbum').evaluate(dialog => {
        const r = dialog.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: innerWidth, height: innerHeight,
          clipped: [...dialog.querySelectorAll('button')].some(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) };
      });
      assert(bounds.top >= 0 && bounds.bottom <= bounds.height && bounds.left >= 0 && bounds.right <= bounds.width);
      assert.equal(bounds.clipped, false);
      await page.screenshot({ path: path.join(artifacts, `${embedded ? 'embedded' : 'direct'}-${width}.png`) });
      await game.locator('#albumGrid button').nth(8).click();
      assert.equal(await game.locator('#moonAlbum').evaluate(el => el.open), false);
      assert.equal(await game.locator('#phaseName').innerText(), 'まんげつ');
      await page.reload();
      assert.match(await game.locator('#albumButton').innerText(), /16\/16/);
      console.log(`PASS moon album ${embedded ? 'embedded' : 'direct'} ${width}x${height}`);
      await context.close();
    }
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('blocked'); } });
      Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('blocked'); } });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'moon-phase-game.html')).href);
    await page.locator('#phaseList button').nth(8).click();
    assert.match(await page.locator('#albumButton').innerText(), /1\/16/);
    await page.locator('#tabQuiz').click();
    await page.locator('#phaseSummary').click();
    assert.match(await page.locator('#albumButton').innerText(), /1\/16/, 'Quiz reference does not award observations');
    await context.close();
    for (const rejects of [false, true]) {
      const safeContext = await browser.newContext();
      const safePage = await safeContext.newPage();
      safePage.on('pageerror', error => errors.push(error.message));
      await safePage.goto(pathToFileURL(path.join(root, 'moon-phase-game.html')).href);
      await safePage.waitForFunction(() => window.MoonRanking?.ready);
      await safePage.evaluate(rejects => {
        window.MoonRanking.complete = () => {
          if (rejects) return Promise.reject(new Error('unavailable ranking'));
          throw new Error('unavailable ranking');
        };
      }, rejects);
      await safePage.locator('#voiceButton').click();
      await safePage.locator('#tabQuiz').click();
      for (let i = 0; i < 20; i++) {
        const source = Number(await safePage.locator('#quizPanel').getAttribute('data-source-angle'));
        const options = safePage.locator('#quizOptions button');
        const angles = await options.evaluateAll(buttons => buttons.map(button => Number(button.dataset.angle)));
        const correct = angles.findIndex(angle => Math.abs(angle - source) < 1e-8);
        assert(correct >= 0);
        await options.nth(correct).click();
        assert.equal(await safePage.locator('#quizNext').isEnabled(), true, 'Ranking failure cannot block Next');
        await safePage.locator('#quizNext').click();
      }
      await safeContext.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS persistence, blocked storage, duplicate observation, quiz isolation and album replay');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
