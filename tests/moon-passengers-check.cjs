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
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(data);
  });
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
    for (const viewport of [{ width: 1024, height: 768 }, { width: 375, height: 667 }]) {
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
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}x${viewport.height}: keyboard toggle, both bodies, orbital movement, multiple characters, tabs, disable, no autoplay or script errors`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
