'use strict';

// Actual file:// packaging smoke. No game/engine mocks and no HTTP test server.
// The prefixed-only case exercises feature detection, not Safari compatibility.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.env.AUDIO_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const games = {
  moon: 'moon-phase-game.html', piano: 'sprunki-piano-game.html', addition: 'sprunki-addition-game.html',
  guess: 'sprunki-guess-game.html', baibain: 'baibain-game.html', food: 'food-quiz-game.html', english: 'english-game.html'
};
const trackUsers = new Set(['moon', 'piano', 'addition']);
const originalIds = 'oren raddy clukr funbot vineria gray brud garnold owakcx sky mrsun durple mrtree simon tunner mrfun wenda pinki jevin black'.split(' ');
const anpanIds = 'anpanman baikinman dokinchan shokupanman currypanman melonpanna rollpanna creampanda jamojisan batakosan'.split(' ');
const expectedIds = [...originalIds, ...anpanIds];

function observe({ prefixed }) {
  const calls = window.__offlineCalls = { contexts: 0, offlineContexts: 0, resumes: 0, starts: 0, bufferStarts: 0, media: 0, speech: 0, deviceDecodes: 0 };
  const Native = window.AudioContext || window.webkitAudioContext;
  if (Native) {
    const Wrapper = new Proxy(Native, { construct(Type, args) {
      calls.contexts++;
      // A real 44.1 kHz device context exposes accidental device-rate decoding.
      return Reflect.construct(Type, [{ ...args[0], sampleRate: 44100 }]);
    } });
    window.AudioContext = Wrapper;
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapper;
    const resume = Native.prototype.resume;
    Native.prototype.resume = function (...args) { calls.resumes++; return resume.apply(this, args); };
    const decode = Native.prototype.decodeAudioData;
    Native.prototype.decodeAudioData = function (...args) { calls.deviceDecodes++; return decode.apply(this, args); };
  }
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (Offline) {
    const Wrapper = new Proxy(Offline, { construct(Type, args) { calls.offlineContexts++; return Reflect.construct(Type, args); } });
    window.OfflineAudioContext = prefixed ? undefined : Wrapper;
    window.webkitOfflineAudioContext = Wrapper;
  }
  for (const Type of [window.AudioBufferSourceNode, window.OscillatorNode]) {
    const start = Type.prototype.start;
    Type.prototype.start = function (...args) { calls.starts++; if (this instanceof AudioBufferSourceNode) calls.bufferStarts++; return start.apply(this, args); };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { calls.media++; return play.apply(this, args); };
  if (window.speechSynthesis) {
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (...args) => { calls.speech++; return speak(...args); };
  }
}

function verifyFile(url) {
  const parsed = new URL(url);
  if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return;
  assert.equal(parsed.protocol, 'file:', `Nonlocal asset: ${url}`);
  parsed.search = ''; parsed.hash = '';
  const target = fs.realpathSync(fileURLToPath(parsed));
  const relative = path.relative(root, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Asset outside workspace: ${url}`);
  assert(fs.statSync(target).isFile(), `Not a file: ${url}`);
}

async function main() {
  const executablePath = process.env.CHROME_EXECUTABLE || process.env.AUDIO_BROWSER;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'msedge' }), args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
  const report = { browser: browser.version(), protocol: 'file:', outputContextRate: 44100, cases: [], failures: [] };
  try {
    for (const [game, prefixed] of [...Object.keys(games).map(id => [id, false]), ['moon', true]]) {
      const name = game + (prefixed ? '-prefixed-offline' : '');
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, offline: true, serviceWorkers: 'block' });
      const external = [], failedLocal = [], errors = [], loaded = new Set();
      await context.route(/^(https?|wss?):/i, route => { external.push(route.request().url()); return route.abort('internetdisconnected'); });
      if (context.routeWebSocket) await context.routeWebSocket(/.*/, socket => { external.push(socket.url()); socket.close(); });
      await context.addInitScript(observe, { prefixed });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^(https?|wss?):/.test(request.url())) external.push(request.url()); });
      page.on('requestfinished', request => { if (request.url().startsWith('file:')) loaded.add(request.url()); });
      page.on('requestfailed', request => { if (request.url().startsWith('file:')) failedLocal.push(`${request.url()}: ${request.failure()?.errorText}`); });
      const entry = { game: name, checks: [], failures: [] };
      report.cases.push(entry);
      async function check(label, action) {
        try { await action(); entry.checks.push(label); }
        catch (error) { const failure = `${name}: ${label}: ${error.message}`; entry.failures.push(failure); report.failures.push(failure); }
      }
      try {
        await page.goto(pathToFileURL(path.join(root, games[game])).href, { waitUntil: 'load' });
        await page.locator('#moonAudioSettings').waitFor();
        await page.waitForTimeout(650);
        await check('no autoplay or startup audio context', async () => {
          assert.deepEqual(await page.evaluate(() => window.__offlineCalls), { contexts: 0, offlineContexts: 0, resumes: 0, starts: 0, bufferStarts: 0, media: 0, speech: 0, deviceDecodes: 0 });
        });
        await check('shared engine and controls loaded once', async () => {
          const snapshot = await page.evaluate(() => ({ engine: typeof window.MoonAudio?.loadTrack, scripts: [...document.scripts].map(s => s.src).filter(Boolean), css: [...document.querySelectorAll('link[rel="stylesheet"]')].map(s => s.href), missingSheets: [...document.querySelectorAll('link[rel="stylesheet"]')].filter(s => !s.sheet).map(s => s.href), controls: document.querySelectorAll('#moonAudioSettings').length }));
          assert.equal(snapshot.engine, 'function'); assert.equal(snapshot.controls, 1);
          assert.deepEqual(snapshot.missingSheets, []);
          for (const file of ['games-audio.js', 'games-audio-controls.js']) assert.equal(snapshot.scripts.filter(src => new URL(src).pathname.endsWith('/' + file)).length, 1, file);
          assert.equal(snapshot.css.filter(src => new URL(src).pathname.endsWith('/games-audio-controls.css')).length, 1);
          for (const url of [...snapshot.scripts, ...snapshot.css]) verifyFile(url);
        });
        await check('manifest only on track-using games', async () => {
          assert.equal(await page.evaluate(() => !!window.MoonAudioManifest), trackUsers.has(game));
        });
        await check('referenced image assets decode', async () => {
          const result = await page.evaluate(async () => {
            const images = [...document.images].filter(img => img.getAttribute('src') || img.currentSrc);
            const failed = [];
            for (const img of images) { img.loading = 'eager'; try { await img.decode(); } catch { failed.push(img.currentSrc || img.src); } }
            return { urls: images.map(img => img.currentSrc || img.src), failed };
          });
          assert.deepEqual(result.failed, []); result.urls.forEach(verifyFile); entry.images = result.urls.length;
        });
        await check('controls open and close silently', async () => {
          const before = await page.evaluate(() => ({ ...window.__offlineCalls }));
          await page.locator('#moonAudioSettings').click();
          assert(await page.locator('#moonAudioDialog').evaluate(el => el.open));
          assert.equal(await page.locator('#moonAudioDialog input[type="range"]').count(), 3);
          await page.locator('#moonAudioDialog button').click();
          assert.deepEqual(await page.evaluate(() => window.__offlineCalls), before);
        });
        if (trackUsers.has(game)) {
          await check('all 30 packs (canonical 20 + generated original 10) decode via real engine at 48000 Hz', async () => {
            const manifest = await page.evaluate(() => window.MoonAudioManifest);
            assert.deepEqual(Object.keys(manifest.tracks), expectedIds);
            for (const id of anpanIds) {
              assert.equal(manifest.tracks[id].provenance, 'game-original');
              assert.equal(manifest.tracks[id].gain, .26);
            }
            for (const meta of Object.values(manifest.tracks)) verifyFile(new URL(meta.file, page.url()).href);
            const result = await page.evaluate(async () => {
              const tracks = [], failures = [];
              for (const id of Object.keys(MoonAudioManifest.tracks)) {
                try {
                  const { buffer, meta } = await MoonAudio.loadTrack(id);
                  let peak = 0; for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
                  tracks.push({ id, rate: buffer.sampleRate, channels: buffer.numberOfChannels, frames: buffer.length, duration: buffer.duration, loopEnd: meta.loopEnd, loopable: meta.loopable, peak });
                } catch (error) { failures.push(id + ': ' + error.message); }
              }
              return { tracks, failures, calls: { ...window.__offlineCalls } };
            });
            entry.decoded = result.tracks;
            assert.deepEqual(result.failures, []); assert.equal(result.tracks.length, 30);
            assert.deepEqual(result.tracks.map(track => track.id), expectedIds);
            assert.equal(result.calls.deviceDecodes, 0, 'Must not decode through arbitrary device context');
            for (const track of result.tracks) {
              assert.equal(track.rate, 48000, track.id); assert(track.peak > 0, track.id);
              if (track.id === 'black') {
                assert.equal(track.loopable, false); assert.equal(track.frames, 838147);
              } else {
                assert.equal(track.loopable, true); assert.equal(track.frames, 230400, track.id); assert.equal(track.loopEnd, 4.8, track.id);
              }
              if (anpanIds.includes(track.id)) assert.equal(track.channels, 2, track.id);
            }
          });
          await check('user-initiated sample playback', async () => {
            if (game === 'moon' || game === 'addition') {
              if (game === 'addition') await page.locator('#musicTrack').selectOption('oren');
              const toggle = page.locator(game === 'moon' ? '#musicButton' : '#musicToggle');
              await toggle.click();
              await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('oren'));
              assert((await page.evaluate(() => window.__offlineCalls.bufferStarts)) > 0);
              await toggle.click();
              await page.waitForFunction(() => MoonAudio.getMusicState().playing.length === 0);
              entry.sample = 'native music toggle: oren';
            } else {
              // Packaging probe uses the actual engine after a real trusted click.
              // It is intentionally not a piano hit/scoring workflow assertion.
              await page.evaluate(() => {
                document.querySelector('#moonAudioSettings').addEventListener('click', () => {
                  window.__sample = MoonAudio.setMusicSelection(['oren']);
                }, { once: true });
              });
              await page.locator('#moonAudioSettings').click();
              await page.evaluate(() => window.__sample);
              await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('oren'));
              assert((await page.evaluate(() => window.__offlineCalls.bufferStarts)) > 0);
              await page.evaluate(() => MoonAudio.stopMusic());
              await page.locator('#moonAudioDialog button').click();
              entry.sample = 'trusted-click engine packaging probe: oren (not piano scoring)';
            }
          });
        } else entry.sample = 'not applicable: no recorded-track playback';
        await check('no missing local loads or script errors or external requests', async () => {
          assert.deepEqual(errors, []); assert.deepEqual(failedLocal, []);
          assert.deepEqual([...new Set(external)], []);
          for (const url of loaded) verifyFile(url);
          const names = [...loaded].map(url => path.basename(new URL(url).pathname));
          for (const file of ['games-audio.js', 'games-audio-controls.js', 'games-audio-controls.css']) assert(names.includes(file), `No completed local load: ${file}`);
          if (trackUsers.has(game)) for (const id of expectedIds) assert(names.includes(id + '.js'), `No completed pack load: ${id}`);
        });
        entry.loadedLocalFiles = loaded.size;
        entry.externalRequests = [...new Set(external)];
      } catch (error) { const failure = `${name}: bootstrap: ${error.message}`; entry.failures.push(failure); report.failures.push(failure); }
      finally { await context.close(); }
      console.log(`${entry.failures.length ? 'FAIL' : 'PASS'} ${name}: ${entry.checks.length} checks, ${entry.loadedLocalFiles || 0} local loads`);
    }
  } finally { await browser.close(); }
  if (process.env.AUDIO_OFFLINE_JSON === '1') console.log(JSON.stringify(report, null, 2));
  else console.log(JSON.stringify({ browser: report.browser, cases: report.cases.length, allDecodedRates: [...new Set(report.cases.flatMap(entry => (entry.decoded || []).map(track => track.rate)))], externalRequests: report.cases.flatMap(entry => entry.externalRequests || []), failures: report.failures }, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
