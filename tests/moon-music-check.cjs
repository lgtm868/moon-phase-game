'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function installAudioContract() {
  const empty = () => ({ selected: [], playing: [], pending: [], errors: [] });
  let state = empty();
  const log = window.__music = { requests: [], stops: 0, ducks: [], buses: [], spoken: [], contexts: 0 };
  window.Audio = window.AudioContext = window.webkitAudioContext = function() {
    log.contexts++;
    throw Error('Moon must not construct an audio player or context');
  };
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const node = () => ({ gain: parameter, frequency: parameter, connect(target) { return target; },
    disconnect() {}, start() {}, stop() {} });
  const context = { createOscillator: node, createGain: node };
  const emit = () => window.dispatchEvent(new Event('moon:audio-state'));
  log.emit = value => { state = value; emit(); };
  window.MoonAudio = {
    unlock: () => Promise.resolve(context), getContext: () => context, now: () => 0,
    output: bus => { log.buses.push(bus); return node(); },
    setMusicSelection(ids) {
      state = { selected: [...ids], playing: state.playing.filter(id => ids.includes(id)),
        pending: ids.filter(id => !state.playing.includes(id)), errors: [] };
      emit();
      return new Promise((resolve, reject) => log.requests.push({ ids, resolve, reject }));
    },
    stopMusic() { log.stops++; state = empty(); emit(); },
    getMusicState: () => state,
    getVolumes: () => ({ voice: 0.37 }),
    effect() {}, setDucking: value => log.ducks.push(value),
    onSuspend: callback => { log.suspend = callback; }
  };
  speechSynthesis.speak = utterance => log.spoken.push(utterance);
  speechSynthesis.cancel = () => {};
}

async function checkMoonMusic(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/games-audio-manifest.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/games-audio.js*', route => route.fulfill({ contentType: 'text/javascript', body: `(${installAudioContract})();` }));
  const music = page.locator('#musicButton');
  try {
    await page.goto(url);
    assert.equal(await page.evaluate(() => __music.requests.length), 0, 'no autoplay');
    await page.locator('#tabFriends').click();
    assert.equal(await page.locator('.sprunki-choice').count(), 30);
    await music.click();
    assert.deepEqual(await page.evaluate(() => __music.requests[0].ids), ['oren']);
    assert.equal(await page.locator('.sprunki-choice').nth(0).getAttribute('aria-busy'), 'true');
    await page.evaluate(() => __music.emit({ selected: ['oren'], playing: ['oren'], pending: [], errors: [] }));
    assert.equal(await page.locator('.sprunki-choice').nth(0).getAttribute('aria-busy'), 'false');
    await page.locator('.sprunki-choice').nth(1).click();
    assert.deepEqual(await page.evaluate(() => __music.requests.at(-1).ids), ['oren', 'raddy']);
    assert.equal(await page.evaluate(() => __music.stops), 0, 'adding a stem does not restart the transport');
    assert.equal(await page.locator('.sprunki-choice').nth(1).getAttribute('aria-busy'), 'true');
    await page.evaluate(() => __music.emit({ selected: ['oren', 'raddy'], playing: ['oren'], pending: [], errors: [{ id: 'raddy', message: 'decode' }] }));
    assert.match(await page.locator('#audioStatus').innerText(), /ラディ/);
    assert.equal(await music.getAttribute('aria-pressed'), 'true', 'healthy peer remains on');
    await page.evaluate(() => __music.emit({ selected: ['oren', 'raddy'], playing: [], pending: [], errors: [{ id: 'oren', message: 'decode' }, { id: 'raddy', message: 'decode' }] }));
    assert.equal(await music.getAttribute('aria-pressed'), 'false');
    await music.click();
    await page.evaluate(() => __music.requests[0].reject(Error('old request')));
    assert.equal(await music.getAttribute('aria-pressed'), 'true', 'old rejected promise cannot stop retry');
    assert.ok(await page.locator('#audioStatus').isHidden());
    for (let i = 2; i < 30; i++) await page.locator('.sprunki-choice').nth(i).click();
    assert.deepEqual(await page.evaluate(() => __music.requests.at(-1).ids),
      ['oren', 'raddy', 'clukr', 'funbot', 'vineria', 'gray', 'brud', 'garnold', 'owakcx', 'sky',
        'mrsun', 'durple', 'mrtree', 'simon', 'tunner', 'mrfun', 'wenda', 'pinki', 'jevin', 'black']);
    await page.evaluate(() => {
      const ids = __music.requests.at(-1).ids;
      __music.emit({ selected: ids, playing: ids.filter(id => id !== 'black'), pending: [], errors: [{ id: 'black', message: 'loop-unverified' }] });
    });
    assert.equal(await music.getAttribute('aria-pressed'), 'true', '19 healthy peers remain on with Black selected');
    assert.match(await page.locator('#audioStatus').innerText(), /Black のおとは どうきの じゅんびちゅう/);
    for (let i = 0; i < 19; i++) await page.locator('.sprunki-choice').nth(i).click();
    await page.evaluate(() => __music.emit({ selected: ['black'], playing: [], pending: [], errors: [{ id: 'black', message: 'loop-unverified' }] }));
    assert.equal(await music.getAttribute('aria-pressed'), 'false', 'Black alone must not claim playback');
    assert.equal(await page.locator('.sprunki-choice').nth(19).getAttribute('aria-pressed'), 'true', 'Black image selection is retained');
    await page.locator('.sprunki-choice').nth(19).click();
    assert.ok(await music.isDisabled(), 'extras have no fabricated audio');
    assert.equal(await music.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.is-pending').count(), 0);
    await page.locator('.sprunki-choice').nth(0).click();
    for (const reason of ['pagehide', 'hidden', 'suspend', 'reset']) {
      await music.click();
      await page.evaluate(reason => {
        if (reason === 'suspend') { MoonAudio.stopMusic(); __music.suspend(); }
        else if (reason === 'reset') document.querySelector('#resetButton').click();
        else if (reason === 'hidden') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } else window.dispatchEvent(new Event(reason));
      }, reason);
      assert.equal(await music.getAttribute('aria-pressed'), 'false', reason);
      assert.deepEqual(await page.evaluate(() => MoonAudio.getMusicState().playing), []);
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pageshow'));
      });
      assert.equal(await music.getAttribute('aria-pressed'), 'false', 'no automatic resume');
    }
    await page.locator('#tabMoon').click();
    await page.locator('.phase-choice').nth(4).click();
    assert.equal(await page.evaluate(() => __music.ducks.at(-1)), true);
    assert.ok(Math.abs(await page.evaluate(() => __music.spoken.at(-1).volume) - 0.37) < 1e-6);
    await page.locator('.phase-choice').nth(8).click();
    await page.evaluate(() => __music.spoken.at(-2).onend());
    assert.equal(await page.evaluate(() => __music.ducks.at(-1)), true, 'old speech end cannot unduck current speech');
    await page.evaluate(() => __music.spoken.at(-1).onerror());
    assert.equal(await page.evaluate(() => __music.ducks.at(-1)), false);
    await page.locator('.phase-choice').nth(12).click();
    await page.locator('#voiceButton').click();
    assert.equal(await page.evaluate(() => __music.ducks.at(-1)), false, 'mute releases ducking');
    assert.ok(await page.evaluate(() => __music.buses.length > 0 && __music.buses.every(bus => bus === 'effects')));
    assert.equal(await page.evaluate(() => __music.contexts), 0);
    assert.ok(await page.locator('#albumButton').evaluate(button => button.classList.contains('is-new')));
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#albumButton').evaluate(button => button.classList.contains('is-new')), false);
    assert.deepEqual(errors, []);
    return { moonMusicContract: true, selectableStemIds: 20, silentExtras: 10, lifecycleStops: 4 };
  } finally { await page.close(); }
}
module.exports = { checkMoonMusic };

async function checkLiveMusic(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  try {
    await page.goto(url);
    await page.locator('#voiceButton').click();
    await page.locator('#musicButton').click();
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('oren'));
    await page.locator('#tabFriends').click();
    await page.locator('.sprunki-choice').nth(1).click();
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('raddy'));
    assert.deepEqual(await page.evaluate(() => [...MoonAudio.getMusicState().playing].sort()), ['oren', 'raddy']);
    for (let i = 2; i < 20; i++) await page.locator('.sprunki-choice').nth(i).click();
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.length === 19 && MoonAudio.getMusicState().errors.some(error => error.id === 'black'));
    assert.equal(await page.locator('#musicButton').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.sprunki-choice').nth(19).getAttribute('aria-pressed'), 'true');
    const blackError = await page.evaluate(() => MoonAudio.getMusicState().errors.find(error => error.id === 'black').message);
    assert.equal(blackError, 'loop-unverified');
    assert.match(await page.locator('#audioStatus').innerText(), /どうきの じゅんびちゅう/);
    for (let i = 0; i < 19; i++) await page.locator('.sprunki-choice').nth(i).click();
    await page.waitForFunction(() => document.querySelector('#musicButton').getAttribute('aria-pressed') === 'false');
    assert.deepEqual(await page.evaluate(() => MoonAudio.getMusicState().playing), []);
    await page.locator('.sprunki-choice').nth(0).click();
    await page.locator('#musicButton').click();
    await page.locator('#musicButton').click();
    assert.deepEqual(await page.evaluate(() => MoonAudio.getMusicState()), { selected: [], playing: [], pending: [], errors: [] });
    return { liveEngineDecodedAndStarted: 19, blackError, blackOnlyOff: true };
  } finally { await page.close(); }
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'moon-phase-game.html'), 'utf8');
  assert.ok(html.indexOf('games-audio-manifest.js') < html.indexOf('games-audio.js?v=20260912-polish'));
  assert.ok(html.indexOf('games-audio.js?v=20260912-polish') < html.indexOf('(() =>'));
  assert.doesNotMatch(html, /new Audio\(|new \(window.AudioContext|audioElement/);
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(target, (error, body) => {
      if (error) return res.writeHead(404).end();
      res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
      res.end(body);
    });
  });
  (async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
      console.log(await checkMoonMusic(browser, `http://127.0.0.1:${server.address().port}/moon-phase-game.html?standalone=1`));
      console.log(await checkLiveMusic(browser, `http://127.0.0.1:${server.address().port}/moon-phase-game.html?standalone=1`));
    } finally { await browser?.close(); server.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
