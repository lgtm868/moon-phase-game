/* Focused real-engine UI checks, independent of the full gameplay matrix.
 * PLAYWRIGHT_MODULE / CHROME_EXECUTABLE use the shared browser-test convention.
 * AUDIO_UI_ROUTES and AUDIO_UI_MODES optionally narrow diagnostic runs.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const games = {
  moon: 'moon-phase-game.html', piano: 'sprunki-piano-game.html', addition: 'sprunki-addition-game.html',
  guess: 'sprunki-guess-game.html', baibain: 'baibain-game.html', food: 'food-quiz-game.html', english: 'english-game.html'
};
const routes = (process.env.AUDIO_UI_ROUTES || Object.keys(games).join(',')).split(',');
const modes = (process.env.AUDIO_UI_MODES || 'standalone,embedded').split(',');
assert(routes.every(route => Object.hasOwn(games, route)));
assert(modes.every(mode => ['standalone', 'embedded'].includes(mode)));
const report = { cases: [], failures: [] };

// Observe native APIs without replacing their behavior or the engine's API.
function observeAudio() {
  const calls = window.__audioUICalls = { contexts: 0, resumes: 0, starts: 0, media: 0, speech: 0 };
  const Native = window.AudioContext || window.webkitAudioContext;
  if (Native) {
    const Wrapped = new Proxy(Native, { construct(target, args) { calls.contexts++; return Reflect.construct(target, args); } });
    window.AudioContext = Wrapped;
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
    const resume = Native.prototype.resume;
    Native.prototype.resume = function (...args) { calls.resumes++; return resume.apply(this, args); };
  }
  for (const Type of [window.AudioBufferSourceNode, window.OscillatorNode]) {
    if (!Type) continue;
    const start = Type.prototype.start;
    Type.prototype.start = function (...args) { calls.starts++; return start.apply(this, args); };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { calls.media++; return play.apply(this, args); };
  if (window.speechSynthesis) {
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (...args) => { calls.speech++; return speak(...args); };
  }
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return res.writeHead(404).end();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' }).end(data);
  });
});

async function main() {
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    for (const width of [320, 1024]) for (const mode of modes) for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 600 } });
      await context.addInitScript(observeAudio);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      const entry = { route, mode, width, checks: [], issues: [] };
      report.cases.push(entry);
      try {
        async function ready() {
          const frame = mode === 'embedded' ? page.frameLocator('#gameFrame') : page;
          await frame.locator('#moonAudioSettings').waitFor();
          return mode === 'embedded' ? await (await page.locator('#gameFrame').elementHandle()).contentFrame() : page.mainFrame();
        }
        await page.goto(`${base}/${mode === 'embedded' ? `index.html?game=${route}` : `${games[route]}?standalone=1`}`);
        let frame = await ready();
        await frame.evaluate(() => document.fonts.ready);
        assert.equal(await frame.locator('#moonAudioSettings').count(), 1, 'One launcher');
        assert.equal(await frame.locator('#moonAudioDialog').count(), 1, 'One dialog');
        const box = await frame.locator('#moonAudioSettings').boundingBox();
        assert(box && box.width === 44 && box.height === 44 && box.x >= 0 && box.x + box.width <= width, 'Visible 44px launcher');
        if (mode === 'embedded') assert.equal((await page.locator('#gameNavigation').boundingBox()).height, 56, '56px shell');
        const before = await frame.evaluate(() => ({
          calls: { ...window.__audioUICalls }, volumes: MoonAudio.getVolumes(),
          toggles: [...document.querySelectorAll('[aria-pressed]')].map(el => [el.id, el.getAttribute('aria-pressed')])
        }));
        assert.deepEqual(before.calls, { contexts: 0, resumes: 0, starts: 0, media: 0, speech: 0 }, 'No startup audio before interaction');
        await frame.locator('#moonAudioSettings').click();
        assert.equal(await frame.locator('#moonAudioDialog').evaluate(el => el.open), true);
        assert.equal(await frame.locator('#moonAudioSettings').getAttribute('aria-expanded'), 'true');
        await page.waitForTimeout(100);
        const openingCalls = await frame.evaluate(() => window.__audioUICalls);
        entry.openingCalls = openingCalls;
        if (JSON.stringify(openingCalls) !== JSON.stringify(before.calls)) entry.issues.push('Opening created audio activity: ' + JSON.stringify(openingCalls));
        assert.deepEqual(await frame.evaluate(() => MoonAudio.getVolumes()), before.volumes, 'Opening must not change settings');
        if (!entry.issues.length) entry.checks.push('silent-open');

        for (const [key, value] of Object.entries({ music: '0.23', effects: '0', voice: '1' })) {
          const slider = frame.locator(`#moonAudio-${key}`);
          assert.equal(await slider.getAttribute('min'), '0');
          assert.equal(await slider.getAttribute('max'), '1');
          await slider.fill(value);
          assert.equal(await slider.getAttribute('aria-valuetext'), `${Math.round(Number(value) * 100)}%`);
        }
        const expected = { music: .23, effects: 0, voice: 1 };
        assert.deepEqual(await frame.evaluate(() => MoonAudio.getVolumes()), expected);
        assert.deepEqual(await frame.evaluate(() => JSON.parse(localStorage.getItem('moon-audio-settings-v1'))), expected);
        await frame.evaluate(() => MoonAudio.setVolumes({ effects: .42 }));
        expected.effects = .42;
        assert.equal(await frame.locator('#moonAudio-effects').inputValue(), '0.42', 'External volume event sync');
        await frame.locator('#moonAudio-effects').focus();
        for (let i = 0; i < 8; i++) {
          await page.keyboard.press('Tab');
          assert(await frame.evaluate(() => !document.hasFocus() || document.querySelector('#moonAudioDialog').contains(document.activeElement)), 'Modal focus stays inside page dialog; browser chrome may receive focus');
        }
        if (route === 'piano') {
          await frame.locator('#moonAudio-music').focus();
          for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL']) {
            await page.keyboard.down(code);
            assert.equal(await frame.locator('#piano .is-active').count(), 0, 'Settings key must not press a piano key');
            await page.keyboard.up(code);
          }
          entry.checks.push('piano-keyboard-isolation');
        }
        const settingsCalls = await frame.evaluate(() => window.__audioUICalls);
        if (JSON.stringify(settingsCalls) !== JSON.stringify(before.calls)) entry.issues.push('Settings produced audio activity: ' + JSON.stringify(settingsCalls));
        assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('[aria-pressed]')].map(el => [el.id, el.getAttribute('aria-pressed')])), before.toggles, 'Existing ON/OFF states unchanged');
        await page.keyboard.press('Escape');
        await frame.waitForFunction(() => document.activeElement?.id === 'moonAudioSettings'
          && document.querySelector('#moonAudioSettings').getAttribute('aria-expanded') === 'false');
        assert.equal(await frame.locator('#moonAudioDialog').evaluate(el => el.open), false);
        assert.equal(await frame.locator('#moonAudioSettings').getAttribute('aria-expanded'), 'false');
        entry.checks.push('volume-range-event-sync', 'escape-focus', 'mute-unchanged');

        await page.reload(); frame = await ready();
        assert.deepEqual(await frame.evaluate(() => MoonAudio.getVolumes()), expected, 'Persisted after real reload');
        await frame.locator('#moonAudioSettings').click();
        for (const [key, value] of Object.entries(expected)) assert.equal(await frame.locator(`#moonAudio-${key}`).inputValue(), String(value));
        await frame.locator('#moonAudioDialog button').click();
        await frame.waitForFunction(() => document.activeElement?.id === 'moonAudioSettings'
          && document.querySelector('#moonAudioSettings').getAttribute('aria-expanded') === 'false');
        entry.checks.push('reload-persistence', 'close-button-focus');
        if (route === 'piano') {
          // Positive control: prove the keyboard detector responds outside the dialog.
          await frame.locator('#piano').click({ position: { x: 2, y: 2 } });
          await page.keyboard.down('KeyA');
          assert(await frame.locator('#piano .is-active').count() > 0, 'Positive control: real piano key responds');
          await page.keyboard.up('KeyA');
          entry.checks.push('piano-positive-control');
        }
        assert.deepEqual(errors, [], 'No page exceptions or missing local resources');
        assert.deepEqual(entry.issues, [], 'Volume-only interactions must remain silent');
        console.log(`PASS ${route} ${mode} ${width}: ${entry.checks.join(', ')}`);
      } catch (error) {
        entry.error = error.message;
        report.failures.push({ route, mode, width, error: error.message, resourceErrors: errors });
        console.error(`FAIL ${route} ${mode} ${width}: ${error.message}`);
      } finally { await context.close(); }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    const output = path.join(root, 'output', 'playwright', 'audio-controls-ui');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  assert.equal(report.failures.length, 0, `${report.failures.length}/${report.cases.length} audio UI cases failed; see output/playwright/audio-controls-ui/report.json`);
  console.log(`PASS ${report.cases.length} audio UI route/mode/viewport cases`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
