'use strict';
// Lifecycle-only browser regression. No quiz rounds, rankings, layout matrix or publication.
// Native speech is controlled explicitly; actual acoustic output is not measured.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { createHash } = require('node:crypto');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(path.join(runtime, 'node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const games = [
  { id: 'moon', file: 'moon-phase-game.html', read: '#phaseSummary', mute: '#voiceButton', restart: '#resetButton', lang: 'ja-JP' },
  { id: 'piano', file: 'sprunki-piano-game.html' },
  { id: 'addition', file: 'sprunki-addition-game.html', read: '#read', mute: '#sound', restart: '#restart', lang: 'ja-JP' },
  { id: 'guess', file: 'sprunki-guess-game.html', read: '#listen', mute: '#sound', restart: '#again', lang: 'ja-JP' },
  { id: 'food', file: 'food-quiz-game.html', read: '#listen', mute: '#sound', restart: '#changeDifficulty', lang: 'ja-JP', prepare: '#startButton' },
  { id: 'english', file: 'english-game.html', read: '#listen', mute: '#sound', restart: '#again', lang: 'en-US' },
  { id: 'baibain', file: 'baibain-game.html' }
];
const failures = [], passes = [];
const startedAt = new Date().toISOString();
const sourceHashes = {};
const hashSource = filename => createHash('sha256').update(fs.readFileSync(path.join(root, filename))).digest('hex');
function saveReport() {
  const report = {
    startedAt, finishedAt: new Date().toISOString(), passed: passes.length, failed: failures.length,
    scope: 'Seven standalone HTML pages; native speech events mocked; real navigation; no acoustic or layout validation.',
    games: games.map(game => ({ id: game.id, file: game.file, nativeSpeech: !!game.read,
      passed: passes.filter(item => item.startsWith(game.id + ':')).length,
      failures: failures.filter(item => item.game === game.id) })),
    passes, failures, sourceHashes,
    sourcesChangedDuringRun: Object.keys(sourceHashes).filter(filename => hashSource(filename) !== sourceHashes[filename])
  };
  const directory = path.join(root, 'output', 'audio-polish');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'audio-lifecycle-report.json');
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
  console.log('Report: ' + filename);
}
function check(game, name, actual, expected = true) {
  try { assert.deepEqual(actual, expected); passes.push(game.id + ': ' + name); }
  catch { const failure = { game: game.id, check: name, actual, expected }; failures.push(failure); console.error('FAIL ' + JSON.stringify(failure)); }
}
function installSpeechProbe() {
  window.__moonRankingBootstrapped = true;
  window.MoonRanking = { complete() {} };
  const state = window.__audioLifecycle = { records: [], cancels: 0, duck: false, hidden: false, errors: [] };
  const voices = [{ lang: 'ja-JP', name: 'Japanese test voice' }, { lang: 'en-US', name: 'English test voice' }];
  const synth = {
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    get speaking() { return state.records.some(r => r.status === 'speaking'); },
    get pending() { return state.records.some(r => r.status === 'queued'); },
    speak(u) { state.records.push({ utterance: u, status: 'queued' }); },
    cancel() { state.cancels++; for (const r of state.records) if (['queued', 'speaking'].includes(r.status)) r.status = 'canceled'; }
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  window.SpeechSynthesisUtterance = function(text) { this.text = text; this.volume = 1; this.lang = ''; };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.hidden ? 'hidden' : 'visible' });
  state.fire = (index, type, error = 'network') => {
    const record = state.records.at(index);
    if (!record) throw new Error('No utterance for ' + type);
    if (record.status !== 'canceled') {
      if (type === 'start') record.status = 'speaking';
      if (type === 'end' || type === 'error') record.status = 'ended';
    }
    record.utterance['on' + type]?.({ type, error });
  };
  state.snapshot = () => ({
    count: state.records.length, cancels: state.cancels, duck: state.duck,
    active: state.records.filter(r => ['queued', 'speaking'].includes(r.status)).map(r => ({ volume: r.utterance.volume, lang: r.utterance.lang })),
    statuses: state.records.map(r => r.status)
  });
  addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)));
}

(async () => {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__audio_lifecycle_blank') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Audio lifecycle navigation</title>'); return; }
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
    fs.readFile(filename, (error, data) => { response.writeHead(error ? 404 : 200, { 'Content-Type': type }); response.end(error ? '' : data); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const game of games) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      await context.addInitScript(installSpeechProbe);
      const page = await context.newPage(), runtimeErrors = [];
      page.setDefaultTimeout(5000);
      page.on('pageerror', error => runtimeErrors.push(error.message));
      const snap = () => page.evaluate(() => __audioLifecycle.snapshot());
      // Lifecycle controls may be offscreen in a different phase (e.g. restart).
      // Dispatch their real DOM handlers without playing through a completion flow.
      const press = selector => page.locator(selector).evaluate(el => el.click());
      const fire = (index, type, error) => page.evaluate(({ index, type, error }) => __audioLifecycle.fire(index, type, error), { index, type, error });
      const read = async () => {
        const count = (await snap()).count;
        await press(game.read);
        check(game, 'read creates one utterance', (await snap()).count, count + 1);
      };
      try {
        console.log('Checking ' + game.id);
        sourceHashes[game.file] = hashSource(game.file);
        sourceHashes['games-audio.js'] ??= hashSource('games-audio.js');
        const response = await page.goto(base + '/' + game.file + '?standalone=1', { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200, 'Game served locally');
        assert(await page.locator('script[src*="games-audio.js"]').count(), (await page.content()).slice(0, 500));
        check(game, 'no initial native autoplay', (await snap()).count, 0);
        await page.evaluate(() => {
          const original = MoonAudio.setDucking;
          MoonAudio.setDucking = value => { __audioLifecycle.duck = !!value; return original(value); };
          MoonAudio.setVolumes({ music: .41, effects: .32, voice: .23 });
          addEventListener('pagehide', () => localStorage.setItem('__audioLifecycleLeave', JSON.stringify(__audioLifecycle.snapshot())));
        });
        check(game, 'independent persisted volumes', await page.evaluate(() => JSON.parse(localStorage.getItem('moon-audio-settings-v1'))), { music: .41, effects: .32, voice: .23 });
        if (game.read) {
          if (game.prepare) await press(game.prepare);
          await read();
          check(game, 'new speech uses voice gain and language', (await snap()).active, [{ volume: .23, lang: game.lang }]);
          await fire(-1, 'start');
          check(game, 'speech ducks music', (await snap()).duck);
          const old = (await snap()).count - 1;
          await read(); await fire(-1, 'start');
          check(game, 'replacement cancels old utterance', (await snap()).statuses[old], 'canceled');
          for (const type of ['end', 'error', 'start']) await fire(old, type);
          check(game, 'stale callbacks preserve current duck', (await snap()).duck);
          await fire(-1, 'end'); check(game, 'end clears duck', (await snap()).duck, false);
          await read(); await fire(-1, 'start'); await fire(-1, 'error');
          check(game, 'error clears duck', (await snap()).duck, false);
          await read(); await fire(-1, 'start');
          await press(game.mute);
          check(game, 'local mute cancels active speech', (await snap()).active, []);
          for (const type of ['start', 'end', 'error']) await fire(-1, type);
          check(game, 'stale events cannot undo mute', (await snap()).duck, false);
          const mutedCount = (await snap()).count;
          await press(game.restart);
          check(game, 'restart respects local mute', (await snap()).count, mutedCount);
          if (game.prepare) await press(game.prepare);
          await press(game.mute); await read(); await fire(-1, 'start');
          const beforeRestart = (await snap()).count - 1;
          await press(game.restart);
          check(game, 'restart cancels current utterance', (await snap()).statuses[beforeRestart], 'canceled');
          const duckAfterRestart = (await snap()).duck;
          for (const type of ['end', 'error', 'start']) await fire(beforeRestart, type);
          check(game, 'stale restart callbacks do not change duck', (await snap()).duck, duckAfterRestart);
          if (game.prepare) await press(game.prepare);
          await read(); await fire(-1, 'start');
          await page.evaluate(() => MoonAudio.setVolumes({ voice: 0 }));
          check(game, 'shared voice zero silences current speech', (await snap()).active.filter(r => r.volume !== 0), []);
          await press(game.read);
          check(game, 'next utterance honors zero voice', (await snap()).active.every(r => r.volume === 0));
          check(game, 'voice mute preserves other gains', await page.evaluate(() => MoonAudio.getVolumes()), { music: .41, effects: .32, voice: 0 });
          await page.evaluate(() => MoonAudio.setVolumes({ voice: .61 }));
          await read(); await fire(-1, 'start');
          await page.evaluate(() => { __audioLifecycle.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
          check(game, 'hidden cancels speech synchronously', (await snap()).active, []);
          for (const type of ['start', 'end', 'error']) await fire(-1, type);
          check(game, 'hidden stale events cannot re-duck', (await snap()).duck, false);
          const hiddenCount = (await snap()).count;
          await press(game.read);
          check(game, 'late read while hidden is suppressed', (await snap()).count, hiddenCount);
          const beforeVisible = (await snap()).count;
          await page.evaluate(() => { __audioLifecycle.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
          check(game, 'visibility restore does not autoplay speech', (await snap()).count, beforeVisible);
          await read(); await fire(-1, 'start');
          const suspension = await page.evaluate(() => { MoonAudio.suspend(); return __audioLifecycle.snapshot(); });
          check(game, 'shared suspend cancels native speech synchronously', suspension.active, []);
          check(game, 'shared suspend clears duck', suspension.duck, false);
          for (const type of ['start', 'error', 'end']) await fire(-1, type);
          check(game, 'suspend stale events cannot re-duck', (await snap()).duck, false);
          await read(); await fire(-1, 'start');
        } else {
          check(game, 'native speech not used (Web Audio only)', (await snap()).count, 0);
          await page.evaluate(() => MoonAudio.suspend());
        }
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        check(game, 'pagehide clears native speech', (await snap()).active, []);
        check(game, 'pagehide clears duck', (await snap()).duck, false);
        const hiddenCount = (await snap()).count;
        if (game.id === 'baibain') {
          // This game intentionally reloads a bfcache-restored, destroyed canvas.
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
          ]);
          await page.evaluate(() => addEventListener('pagehide', () => localStorage.setItem('__audioLifecycleLeave', JSON.stringify(__audioLifecycle.snapshot()))));
        } else await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        check(game, 'bfcache pageshow does not autoplay speech', (await snap()).count, hiddenCount);
        if (game.read) {
          await read(); await fire(-1, 'start');
          check(game, 'post-pageshow voice gain preserved', (await snap()).active, [{ volume: .61, lang: game.lang }]);
        }
        check(game, 'no rejected audio promises', await page.evaluate(() => __audioLifecycle.errors), []);
        await page.evaluate(() => localStorage.removeItem('__audioLifecycleLeave'));
        await page.goto(base + '/__audio_lifecycle_blank');
        const navigationReport = await page.evaluate(() => JSON.parse(localStorage.getItem('__audioLifecycleLeave')));
        check(game, 'real navigation reports pagehide', !!navigationReport);
        if (navigationReport) check(game, 'real navigation cancels before leaving', navigationReport.active, []);
        check(game, 'no runtime errors', runtimeErrors, []);
      } catch (error) {
        failures.push({ game: game.id, check: 'test setup/execution', actual: error.stack });
        console.error(game.id + ': ' + error.stack + '\n' + JSON.stringify(runtimeErrors));
      } finally { await context.close(); }
      console.log(`${game.id}: ${passes.filter(p => p.startsWith(game.id + ':')).length} passed, ${failures.filter(f => f.game === game.id).length} failed`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`Audio lifecycle: ${passes.length} passed; ${failures.length} failed. Native utterance events mocked; no acoustic, quiz-flow or layout claims.`);
  saveReport();
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
