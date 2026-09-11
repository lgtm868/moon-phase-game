'use strict';
// One readiness gate, then focused visual artifacts. No audio suite or publication.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(path.join(runtime, 'node_modules/playwright'));
const { PNG } = require(path.join(runtime, 'node_modules/pngjs'));
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'roster-responsive-qa');
const mods = ['acid', 'tox', 'sulfur', 'mard', 'mrbear'];
const anpan = ['anpanman', 'baikinman', 'dokinchan', 'shokupanman', 'currypanman', 'melonpanna', 'rollpanna', 'creampanda', 'jamojisan', 'batakosan'];
const files = [...mods.map(id => `assets/sprunki-mods/${id}.png`), ...anpan.map(id => `assets/anpanman/${id}.png`)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
  const deadline = Date.now() + Number(process.env.ASSET_WAIT_MS || 1800000), cache = new Map();
  let last = '';
  while (Date.now() < deadline) {
    const pending = [];
    for (const file of files) {
      const target = path.join(root, file);
      if (!fs.existsSync(target)) { pending.push(file); continue; }
      const stat = fs.statSync(target), key = `${stat.mtimeMs}:${stat.size}`;
      if (Date.now() - stat.mtimeMs < 3000) { pending.push(file + ': settling'); continue; }
      if (cache.get(file)?.key !== key) {
        try {
          const png = PNG.sync.read(fs.readFileSync(target));
          let transparent = 0;
          for (let i = 3; i < png.data.length; i += 4) if (png.data[i] < 8) transparent++;
          cache.set(file, { key, valid: png.width >= 256 && png.height >= 256 && transparent / (png.width * png.height) > .15 });
        } catch { cache.set(file, { key, valid: false }); }
      }
      if (!cache.get(file).valid) pending.push(file + ': alpha/resolution');
    }
    if (!pending.length) { console.log('READY: 15 settled, decoded PNGs with transparent backgrounds'); return; }
    const state = pending.join(', ');
    if (state !== last) { console.log('WAIT: ' + state); last = state; }
    await sleep(15000);
  }
  throw Error('Readiness deadline reached; no browser tests were run');
}
function drawProbe() {
  window.__rosterDraws = {};
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    if (this.canvas.id === 'space' && source instanceof HTMLImageElement && /(?:sprunki-|assets\/anpanman\/|assets\/sprunki-mods\/)/.test(source.src)) {
      const box = this.canvas.getBoundingClientRect();
      window.__rosterDraws[source.src.split('/').pop()] = { args, width: box.width, height: box.height };
    }
    return draw.call(this, source, ...args);
  };
}
async function geometry(frame, selector) {
  return frame.locator(selector).evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect(), label = button.querySelector('span'), image = button.querySelector('img');
    const text = label.getBoundingClientRect();
    return { name: label.textContent, visible: box.width > 0 && box.height > 0,
      overflow: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
      textOutside: text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1,
      image: image.complete && image.naturalWidth > 0,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height } };
  }));
}
(async () => {
  await ready();
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      const type = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(error ? 404 : 200, { 'Content-Type': type }); res.end(error ? '' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, report = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const game of ['moon', 'piano']) for (const [width, height, embedded] of [[1024, 600, false], [1024, 600, true], [1180, 820, false], [390, 844, false]]) {
      const name = `${game}-${width}x${height}-${embedded ? 'embedded' : 'direct'}`;
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(drawProbe);
      await page.route(/^https?:/, route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      const file = game === 'moon' ? 'moon-phase-game.html' : 'sprunki-piano-game.html';
      try {
        await page.goto(embedded ? `${base}/index.html?game=${game}` : `${base}/${file}?standalone=1`);
        let frame = page.mainFrame();
        if (embedded) { await page.waitForFunction(() => document.querySelector('#gameFrame')?.contentDocument?.readyState === 'complete'); frame = await (await page.$('#gameFrame')).contentFrame(); await frame.waitForSelector(game === 'moon' ? '#tabFriends' : '#menuButton'); }
        await frame.locator(game === 'moon' ? '#tabFriends' : '#menuButton').click();
        const selector = game === 'moon' ? '.sprunki-choice' : '.character-button', buttons = frame.locator(selector);
        assert.equal(await buttons.count(), game === 'moon' ? 35 : 25);
        await frame.locator(selector + ' img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
        if (game === 'moon') {
          await frame.locator('#voiceButton').click();
          for (let i = 1; i < 35; i++) await buttons.nth(i).click();
          assert.equal(await frame.locator('.sprunki-choice[aria-pressed="true"]').count(), 35);
          await frame.waitForFunction(() => Object.keys(__rosterDraws).length === 35);
        } else {
          for (let i = 0; i < 25; i++) { await buttons.nth(i).click(); assert.equal(await buttons.nth(i).getAttribute('aria-pressed'), 'true'); }
          await buttons.last().scrollIntoViewIfNeeded();
        }
        await page.screenshot({ path: path.join(output, name + '.png') });
        const boxes = await geometry(frame, selector);
        const overflow = await frame.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth + 1, y: document.documentElement.scrollHeight > innerHeight + 1 }));
        const draws = game === 'moon' ? await frame.evaluate(() => window.__rosterDraws) : null;
        const cropped = draws ? Object.entries(draws).filter(([, value]) => {
          const [x, y, w, h] = value.args; return x < -1 || y < -1 || x + w > value.width + 1 || y + h > value.height + 1;
        }).map(([id]) => id) : [];
        const issues = boxes.filter(box => !box.visible || !box.image || box.overflow || box.textOutside);
        if (game === 'piano') {
          await frame.locator('#menuCloseButton').click();
          await frame.locator('#heroFace').evaluate(image => image.decode());
          assert((await frame.locator('#heroFace').getAttribute('src')).endsWith('/mrbear.png'));
          await page.screenshot({ path: path.join(output, name + '-instrument.png') });
        }
        report.push({ name, count: boxes.length, overflow, issues, cropped, errors });
        console.log(JSON.stringify(report.at(-1)));
      } catch (error) {
        await page.screenshot({ path: path.join(output, name + '-failure.png') });
        report.push({ name, error: error.message });
      } finally { await page.close(); }
    }
  } finally {
    await browser?.close(); server.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  assert(report.every(item => !item.error && !item.issues.length && !item.cropped.length && !item.errors.length && !item.overflow.x && !item.overflow.y), 'Review focused report and screenshots');
  console.log('PASS focused geometry/rendering. Screenshot inspection still required.');
})().catch(error => { console.error(error); process.exitCode = 1; });
