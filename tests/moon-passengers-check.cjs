'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return res.writeHead(404).end();
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(data);
  });
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
    for (const viewport of [{ width: 1024, height: 768 }, { width: 375, height: 667 }, { width: 844, height: 390 }]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Observe actual sprite painting without changing the game's state or drawing.
      await page.addInitScript(() => {
        window.__sprites = [];
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        const paint = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.clearRect = function(...args) {
          if (this.canvas.id === 'space') window.__sprites = [];
          return clear.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
          if (this.canvas.id === 'space' && image instanceof HTMLImageElement) {
            window.__sprites.push({ src: image.src, x: args[0], y: args[1], w: args[2], h: args[3] });
          }
          return paint.call(this, image, ...args);
        };
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/moon-phase-game.html?standalone=1`);
      await page.locator('#tabFriends').click();
      await page.waitForFunction(() => __sprites.length === 1);
      const toggle = page.locator('#moonPassengersButton');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await toggle.focus();
      await page.keyboard.press('Space');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      const before = await page.evaluate(() => __sprites);
      assert.equal(before.length, 2, 'selected character paints on both bodies');
      assert.equal(before[0].src, before[1].src);
      assert(before[1].h < before[0].h, 'passenger scales to the smaller moon');
      await page.locator('#stepButton').click();
      const after = await page.evaluate(() => __sprites);
      assert.equal(after[0].x, before[0].x, 'Earth passenger stays put');
      assert.notEqual(after[1].x, before[1].x, 'moon passenger follows the orbit');
      await page.locator('.sprunki-choice').nth(1).click();
      await page.waitForFunction(() => __sprites.length === 4);
      await page.locator('#tabMoon').click();
      await page.locator('#tabFriends').click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'placement survives tab changes');
      await toggle.click();
      await page.waitForFunction(() => __sprites.length === 2);
      assert.equal(await page.locator('.sprunki-choice[aria-pressed="true"]').count(), 2, 'placement preserves selection');
      assert.equal(await page.locator('#musicButton').getAttribute('aria-pressed'), 'false', 'placement does not start music');
      await page.waitForFunction(() => [...document.querySelectorAll('.sprunki-choice img')].every(image => image.complete && image.naturalWidth));
      await page.locator('.sprunki-choice').evaluateAll(buttons => buttons.forEach(button => {
        if (button.getAttribute('aria-pressed') !== 'true') button.click();
      }));
      await toggle.click();
      assert.equal(await page.locator('#nextPassengersButton').count(), 0, 'no paging needed');
      const checkCrowd = async expected => {
        const { sprites, width, height } = await page.evaluate(() => ({ sprites: __sprites,
          width: document.querySelector('#space').clientWidth, height: document.querySelector('#space').clientHeight }));
        assert.equal(sprites.length, expected, 'every selected character is painted on each enabled body');
        assert.equal(new Set(sprites.map(sprite => sprite.src)).size, 100, 'all 100 distinct characters appear in the same frame');
        for (let i = 0; i < sprites.length; i++) {
          const sprite = sprites[i];
          assert(sprite.w > 0 && sprite.h > 0);
          assert(sprite.x >= 0 && sprite.y >= 0 && sprite.x + sprite.w <= width + 0.01 && sprite.y + sprite.h <= height + 0.01, 'entire sprite stays inside canvas');
          for (const other of sprites.slice(i + 1)) {
            const overlapX = Math.min(sprite.x + sprite.w, other.x + other.w) - Math.max(sprite.x, other.x);
            const overlapY = Math.min(sprite.y + sprite.h, other.y + other.h) - Math.max(sprite.y, other.y);
            assert(overlapX <= 0.01 || overlapY <= 0.01, 'no character obscures another');
          }
        }
      };
      // Exercise the complete orbit, including switches between horizontal and vertical partitions.
      for (let step = 0; step < 36; step++) {
        await checkCrowd(200);
        await page.locator('#stepButton').click();
      }
      await page.screenshot({ path: `/tmp/moon-all-passengers-${viewport.width}.png` });
      await toggle.click();
      await checkCrowd(100);
      assert.equal(await page.locator('.sprunki-choice[aria-pressed="true"]').count(), 100, 'all selections stay active');
      assert.equal(await page.locator('#musicButton').getAttribute('aria-pressed'), 'false', 'display changes do not autoplay');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}x${viewport.height}: moon placement, orbital movement, all 100 characters simultaneously, no overlap or clipping throughout the orbit, no autoplay or script errors`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
