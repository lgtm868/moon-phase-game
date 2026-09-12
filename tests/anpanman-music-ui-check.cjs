'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/anpanman-music-ui');
const ids = ['anpanman', 'baikinman', 'dokinchan', 'shokupanman', 'currypanman', 'melonpanna', 'rollpanna', 'creampanda', 'jamojisan', 'batakosan'];
const report = [];
function probe() {
  window.__starts = [];
  window.__buffers = new WeakMap();
  const start = AudioBufferSourceNode.prototype.start;
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function(when, offset, ...args) {
    const record = { id: __buffers.get(this.buffer), when, offset, loop: this.loop,
      loopStart: this.loopStart, loopEnd: this.loopEnd, duration: this.buffer?.duration, stopped: false };
    this.__record = record;
    __starts.push(record);
    return start.call(this, when, offset, ...args);
  };
  AudioBufferSourceNode.prototype.stop = function(...args) {
    if (this.__record) this.__record.stopped = true;
    return stop.apply(this, args);
  };
}
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(error ? 404 : 200, { 'Content-Type': type }).end(error ? '' : data);
  });
});
async function check(browser, base, width, height, embedded, fullAudio) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const errors = [], failedRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => failedRequests.push(`${r.failure()?.errorText} ${r.url()}`));
  await page.addInitScript(probe);
  const entry = { width, height, embedded, errors, failedRequests };
  report.push(entry);
  try {
    await page.goto(`${base}/${embedded ? 'index.html?game=moon' : 'moon-phase-game.html?standalone=1'}`);
    let frame = page.mainFrame();
    if (embedded) {
      await page.waitForFunction(() => document.querySelector('#gameFrame')?.contentDocument?.readyState === 'complete');
      frame = await (await page.$('#gameFrame')).contentFrame();
    }
    await frame.locator('#tabFriends').click();
    if (await frame.locator('#voiceButton').getAttribute('aria-pressed') === 'true') await frame.locator('#voiceButton').click();
    const choices = frame.locator('.sprunki-choice'), music = frame.locator('#musicButton');
    assert.equal(await choices.count(), 35);
    assert.deepEqual(await frame.evaluate(() => MoonAudio.getMusicState().selected), []);
    await frame.evaluate(async ids => {
      for (const id of ids) { const track = await MoonAudio.loadTrack(id); __buffers.set(track.buffer, id); }
      const ctx = MoonAudio.getContext();
      window.__analyser = ctx.createAnalyser();
      __analyser.fftSize = 2048;
      MoonAudio.output('music').connect(__analyser);
    }, ids);
    await choices.nth(20).click();
    await choices.nth(0).click();
    const playing = expected => frame.waitForFunction(expected => {
      const s = MoonAudio.getMusicState();
      return !s.pending.length && !s.errors.length && s.playing.length === expected.length && expected.every(id => s.playing.includes(id));
    }, expected, { timeout: 15000 });
    const audible = () => frame.waitForFunction(() => {
      const data = new Float32Array(__analyser.fftSize);
      __analyser.getFloatTimeDomainData(data);
      return Math.max(...data.map(Math.abs)) > 0.0001;
    });
    await music.click();
    await playing([ids[0]]);
    await audible();
    if (fullAudio) {
      await page.waitForTimeout(300);
      await choices.nth(21).click();
      await playing(ids.slice(0, 2));
      const starts = await frame.evaluate(() => __starts.filter(s => s.id));
      const first = starts.find(s => s.id === 'anpanman'), joined = starts.find(s => s.id === 'baikinman');
      const delta = joined.when - first.when;
      assert(Math.abs(delta / 2.4 - Math.round(delta / 2.4)) < 1e-6, 'join at bar boundary');
      assert(Math.abs(joined.offset - ((delta % 4.8) + 4.8) % 4.8) < 1e-6, 'two-bar phase offset');
      entry.phaseJoin = { delta, offset: joined.offset };
      for (let i = 2; i < 10; i++) await choices.nth(20 + i).click();
      await playing(ids);
      await page.waitForTimeout(9700);
      await playing(ids);
      await audible();
      const all = await frame.evaluate(() => __starts.filter(s => s.id));
      assert.equal(all.length, 10, 'adding stems never restarts existing voices');
      for (const s of all) {
        assert(s.loop && Math.abs(s.duration - 4.8) < 0.001 && Math.abs(s.loopEnd - s.loopStart - 4.8) < 0.001);
        assert(Math.abs(s.offset - (((s.when - first.when) % 4.8) + 4.8) % 4.8) < 1e-6);
      }
      entry.twoCycles = true;
      await music.click();
      await page.waitForTimeout(150);
      assert.deepEqual(await frame.evaluate(() => MoonAudio.getMusicState().playing), []);
      assert(await frame.evaluate(() => __starts.filter(s => s.id).every(s => s.stopped)));
      const silent = await frame.evaluate(() => {
        const data = new Float32Array(__analyser.fftSize); __analyser.getFloatTimeDomainData(data);
        return Math.max(...data.map(Math.abs));
      });
      assert(silent < 0.0001, 'music output muted');
      for (let i = 1; i < 10; i++) await choices.nth(20 + i).click();
      await music.click();
      await playing([ids[0]]);
      for (let i = 1; i < 10; i++) {
        await choices.nth(20 + i).click();
        await choices.nth(19 + i).click();
        await playing([ids[i]]);
        await audible();
      }
      entry.individualTracks = 10;
      await music.click();
      await music.click();
      await music.click();
      await page.waitForTimeout(2700);
      assert.deepEqual(await frame.evaluate(() => MoonAudio.getMusicState().playing), [], 'late loads cannot restart mute');
      assert.equal(await music.getAttribute('aria-pressed'), 'false');
      for (let i = 0; i < 9; i++) await choices.nth(20 + i).click();
    } else {
      for (let i = 1; i < 10; i++) await choices.nth(20 + i).click();
      await playing(ids);
      await music.click();
    }
    await frame.locator('.sprunki-choice img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    entry.layout = await choices.evaluateAll(buttons => buttons.map((button, i) => {
      const b = button.getBoundingClientRect(), t = button.querySelector('span').getBoundingClientRect();
      return { i, title: button.title, aria: button.getAttribute('aria-label'),
        clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1 || t.left < b.left - 1 || t.right > b.right + 1 || t.top < b.top - 1 || t.bottom > b.bottom + 1 };
    }));
    assert(entry.layout.every(b => !b.clipped));
    assert(entry.layout.slice(20, 30).every(b => b.title.includes('\u30aa\u30ea\u30b8\u30ca\u30eb') && b.aria.includes(b.title)));
    entry.overflow = await frame.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth + 1, y: document.documentElement.scrollHeight > innerHeight + 1 }));
    assert(!entry.overflow.x && !entry.overflow.y);
    assert(await frame.locator('#audioStatus').isHidden());
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    await page.screenshot({ path: path.join(output, `${width}x${height}-${embedded ? 'embedded' : 'direct'}.png`) });
    entry.pass = true;
  } catch (error) {
    entry.failure = error.stack;
    await page.screenshot({ path: path.join(output, `${width}x${height}-failure.png`) });
  } finally { await page.close(); }
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }) });
    const base = `http://127.0.0.1:${server.address().port}`;
    await check(browser, base, 1024, 600, true, true);
    await check(browser, base, 390, 844, false, false);
  } finally {
    await browser?.close(); server.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.length, 2);
  assert(report.every(r => r.pass), 'Review report and failure screenshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
