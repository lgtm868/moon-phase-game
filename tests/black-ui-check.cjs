'use strict';
// Entry-only integration: real decoding/clock, natural completion, faults and lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'node_modules/playwright'));
const { checkMoonMusic, checkLiveMusic } = require('./moon-music-check.cjs');
const root = path.resolve(__dirname, '..');
function probeSources() {
  window.__blackSources = [];
  const create = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function() {
    const source = create.call(this), start = source.start;
    source.start = function(when, offset, ...rest) {
      const record = { loop: source.loop, when, offset, duration: source.buffer?.duration, ended: false };
      window.__blackSources.push(record);
      source.addEventListener('ended', () => { record.ended = true; });
      return start.call(source, when, offset, ...rest);
    };
    return source;
  };
}
const games = [
  { file: 'moon-phase-game.html', button: '#musicButton', status: '#audioStatus', reset: '#resetButton' },
  { file: 'sprunki-addition-game.html', button: '#musicToggle', status: '#musicStatus', reset: '#restart' }
];
async function entry(browser, base, game, fault = false) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  await page.addInitScript(probeSources);
  if (fault) await page.route('**/sounds/packed/black.js*', route => route.abort());
  await page.goto(`${base}/${game.file}?standalone=1`);
  if (game.file.startsWith('moon')) {
    await page.locator('#voiceButton').click();
    await page.locator('#tabFriends').click();
    assert.equal(await page.locator('.sprunki-choice').count(), 35);
    for (const viewport of [{ width: 375, height: 812 }, { width: 1024, height: 600 }]) {
      await page.setViewportSize(viewport);
      const dimensions = await page.locator('.sprunki-choice').nth(19).evaluate(button => {
        const label = button.querySelector('span');
        return [label.scrollWidth, label.clientWidth, button.scrollWidth, button.clientWidth];
      });
      assert.ok(dimensions[0] <= dimensions[1] + 1 && dimensions[2] <= dimensions[3] + 1, `single-play label fits the existing picker: ${dimensions}`);
    }
    await page.locator('.sprunki-choice').nth(19).click();
    await page.locator('.sprunki-choice').nth(0).click();
  } else await page.locator('#musicTrack').selectOption('black');
  assert.equal(await page.evaluate(() => __blackSources.length), 0, 'entry never autoplays');
  return page;
}
async function play(page, game) {
  await page.locator(game.button).click();
  await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('black'));
  assert.equal(await page.locator(game.button).getAttribute('aria-pressed'), 'true');
}
async function live(browser, base, game) {
  const page = await entry(browser, base, game);
  try {
    await play(page, game);
    const source = await page.evaluate(() => __blackSources.at(-1));
    assert.equal(source.loop, false);
    assert.equal(source.offset, 0);
    assert.ok(source.duration > 17, 'full original Black decoded');
    if (!game.file.startsWith('moon')) await page.waitForFunction(() => document.querySelector('#musicStatus').textContent.includes('1かい'));
    assert.match(await page.locator(game.file.startsWith('moon') ? '.sprunki-choice:nth-child(20)' : game.status).innerText(), /1かい/);
    await page.waitForFunction(() => !MoonAudio.getMusicState().selected.includes('black'), null, { timeout: 30000 });
    assert.equal(await page.locator(game.button).getAttribute('aria-pressed'), 'false');
    if (game.file.startsWith('moon')) assert.equal(await page.locator('.sprunki-choice').nth(19).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => __blackSources.at(-1).ended), true);
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => __blackSources.length), 1, 'polling cannot replay');
    await play(page, game);
    assert.equal(await page.evaluate(() => __blackSources.length), 2, 'new gesture replays');
    for (const reason of ['reset', 'hidden', 'pagehide', 'suspend']) {
      if (reason !== 'reset') await play(page, game);
      await page.evaluate(({ reason, reset }) => {
        if (reason === 'reset') document.querySelector(reset).click();
        else if (reason === 'hidden') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } else if (reason === 'suspend') MoonAudio.suspend();
        else window.dispatchEvent(new Event('pagehide'));
      }, { reason, reset: game.reset });
      await page.waitForFunction(button => document.querySelector(button).getAttribute('aria-pressed') === 'false', game.button);
      assert.deepEqual(await page.evaluate(() => MoonAudio.getMusicState().playing), []);
      const count = await page.evaluate(() => __blackSources.length);
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pageshow'));
      });
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => __blackSources.length), count, 'no lifecycle auto-resume');
    }
    console.log(`PASS ${game.file}: natural end, full original, replay, four lifecycle stops`);
  } finally { await page.close(); }
  const broken = await entry(browser, base, game, true);
  try {
    await broken.locator(game.button).click();
    await broken.waitForFunction(status => /よめ/.test(document.querySelector(status).textContent), game.status);
    assert.equal(await broken.locator(game.button).getAttribute('aria-pressed'), 'false');
    assert.match(await broken.locator(game.status).innerText(), /よめ/);
    assert.doesNotMatch(await broken.locator(game.status).innerText(), /じゅんび/);
    await broken.unroute('**/sounds/packed/black.js*');
    await play(broken, game);
    console.log(`PASS ${game.file}: Black load fault and user retry`);
  } finally { await broken.close(); }
}
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(error ? '' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    if (!process.argv.includes('--entries-only')) {
      console.log(await checkMoonMusic(browser, `${base}/moon-phase-game.html?standalone=1`));
      console.log(await checkLiveMusic(browser, `${base}/moon-phase-game.html?standalone=1`));
    }
    for (const game of games) await live(browser, base, game);
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
