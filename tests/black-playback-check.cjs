'use strict';

// Real-time browser audio, not accelerated/offline rendering or human audition.
// Only the final late-end callbacks are deliberately injected race probes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const reportDir = path.join(root, 'output', 'black-playback');
const tracked = ['games-audio.js', 'games-audio-manifest.js', 'sounds/black.mp3', 'sounds/oren.wav', 'sounds/packed/black.js', 'sounds/packed/oren.js'];
const hashes = () => Object.fromEntries(tracked.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const report = { startedAt: new Date().toISOString(), scope: 'Real AudioContext clock and native MP3 decoding; no UI integration, no human audition, no publication. Late-end injection is marked separately.', checks: [], stages: [], sourceHashes: hashes() };
function check(name, run) { run(); report.checks.push(name); console.log('PASS ' + name); }

function installProbe() {
  const probe = window.probe = { sources: [], events: [], errors: [], snapshots: [] };
  addEventListener('unhandledrejection', event => probe.errors.push(String(event.reason)));
  addEventListener('moon:audio-state', event => probe.events.push({ wall: performance.now(), time: window.MoonAudio?.now(), state: event.detail }));
  const original = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function(...args) {
    const node = original.apply(this, args);
    const record = { node, starts: [], stops: [], ends: [], disconnected: false };
    probe.sources.push(record);
    const start = node.start, stop = node.stop, disconnect = node.disconnect;
    node.start = function(...values) {
      record.starts.push({ args: values, time: this.context.currentTime, wall: performance.now() });
      return start.apply(this, values);
    };
    node.stop = function(...values) { record.stops.push(values); return stop.apply(this, values); };
    node.disconnect = function(...values) { record.disconnected = true; return disconnect.apply(this, values); };
    node.addEventListener('ended', event => {
      record.ends.push({ trusted: event.isTrusted, time: node.context.currentTime, wall: performance.now() });
      // Snapshot after the engine's onended handler has cleared its state.
      queueMicrotask(() => probe.snapshots.push({ reason: 'native-ended', state: MoonAudio.getMusicState() }));
    });
    return node;
  };
  probe.snapshot = () => ({
    time: MoonAudio.now(), wall: performance.now(), contextState: MoonAudio.getContext().state,
    state: MoonAudio.getMusicState(), events: probe.events.slice(), endedStates: probe.snapshots.slice(), errors: probe.errors.slice(),
    sources: probe.sources.map(record => ({
      id: record.node.buffer === probe.black?.buffer ? 'black' : record.node.buffer === probe.oren?.buffer ? 'oren' : 'unknown',
      loop: record.node.loop, loopStart: record.node.loopStart, loopEnd: record.node.loopEnd,
      playbackRate: record.node.playbackRate.value, detune: record.node.detune.value,
      duration: record.node.buffer.duration, frames: record.node.buffer.length, rate: record.node.buffer.sampleRate,
      starts: record.starts, stops: record.stops, ends: record.ends, disconnected: record.disconnected
    }))
  });
  probe.peak = async () => {
    const data = new Float32Array(probe.analyser.fftSize);
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      probe.analyser.getFloatTimeDomainData(data);
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return peak;
  };
}

async function main() {
  let browser, page;
  const allowed = new Set(['/games-audio.js', '/games-audio-manifest.js', '/sounds/packed/black.js', '/sounds/packed/oren.js']);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      // Suppress optional controls in this isolated engine fixture, not in game files.
      res.end('<!doctype html><meta charset="utf-8"><title>Black playback regression</title><script id="moonAudioControlsScript"></script><script src="/games-audio-manifest.js"></script><script src="/games-audio.js"></script><button id="start">Start audio check</button>');
    } else if (allowed.has(pathname)) {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(fs.readFileSync(path.join(root, pathname.slice(1))));
    } else res.writeHead(404).end();
  });
  const snapshot = async label => {
    const value = await page.evaluate(() => probe.snapshot());
    report.stages.push({ label, ...value }); return value;
  };
  try {
    let packed;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'sounds/packed/black.js'), 'utf8'), { window: { MoonAudio: { registerAsset(id, asset) { assert.equal(id, 'black'); packed = asset; } } } });
    check('Black pack is the unchanged original MP3 with no verified beat period', () => {
      assert.equal(packed.type, 'audio/mpeg'); assert.equal(packed.loopable, false); assert.equal(packed.beats, null);
      assert(Buffer.from(packed.data, 'base64').equals(fs.readFileSync(path.join(root, 'sounds/black.mp3'))));
    });
    const { chromium } = require(process.env.AUDIO_PLAYWRIGHT || path.join(runtime, 'node_modules/playwright'));
    browser = await chromium.launch({ headless: true, ...(process.env.AUDIO_BROWSER ? { executablePath: process.env.AUDIO_BROWSER } : { channel: 'chrome' }) });
    report.browser = browser.version();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    page = await browser.newPage();
    page.on('pageerror', error => { (report.pageErrors ||= []).push(error.message); });
    await page.addInitScript(installProbe);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      document.querySelector('#start').addEventListener('click', () => {
        probe.ready = (async () => {
          const ctx = await MoonAudio.unlock();
          [probe.black, probe.oren] = await Promise.all([MoonAudio.loadTrack('black'), MoonAudio.loadTrack('oren')]);
          probe.previewSourceCount = probe.sources.length;
          probe.analyser = ctx.createAnalyser(); probe.analyser.fftSize = 2048;
          const sink = ctx.createGain(); sink.gain.value = 0;
          MoonAudio.output('music').connect(probe.analyser); probe.analyser.connect(sink); sink.connect(ctx.destination);
          await MoonAudio.setMusicSelection(['oren']);
        })();
      });
    });
    await page.locator('#start').click();
    await page.evaluate(() => probe.ready);
    await page.waitForFunction(() => MoonAudio.now() > probe.sources[0].starts[0].args[0] + .3);
    await page.evaluate(() => MoonAudio.setMusicSelection(['oren', 'black']));
    const joined = await snapshot('black-queued-next-bar');
    const oren = joined.sources[0], black = joined.sources[1];
    check('Preview does not play; Black queues on next bar at phase zero without stretch/crop', () => {
      assert.equal(joined.sources.length, 2); assert.equal(oren.id, 'oren'); assert.equal(oren.loop, true);
      assert.equal(black.id, 'black'); assert.equal(black.loop, false);
      assert.equal(black.frames, 838147); assert.equal(black.rate, 48000);
      assert.equal(black.duration, 838147 / 48000);
      assert.equal(black.playbackRate, 1); assert.equal(black.detune, 0);
      assert.equal(black.starts[0].args.length, 2, 'No duration argument truncates playback');
      assert.equal(black.starts[0].args[1], 0); assert.equal(black.stops.length, 0);
      const expected = oren.starts[0].args[0] + Math.ceil((black.starts[0].time + .08 - oren.starts[0].args[0]) / 2.4) * 2.4;
      assert(Math.abs(black.starts[0].args[0] - expected) < 1e-6);
      assert(black.starts[0].args[0] > black.starts[0].time);
      assert.deepEqual(joined.state.errors, []);
    });
    assert.equal(await page.evaluate(() => probe.previewSourceCount), 0);
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('black'));
    report.mixPeak = await page.evaluate(() => probe.peak());
    assert(report.mixPeak > .0001, 'Real audio graph has nonzero samples');
    await snapshot('both-playing');
    console.log('Waiting for the full original Black buffer to end naturally...');
    await page.waitForFunction(() => probe.sources[1].ends.length === 1, null, { timeout: 25000 });
    const ended = await snapshot('black-natural-end');
    check('Native natural end clears Black and emits state while Oren continues without restart', () => {
      const result = ended.sources[1], end = result.ends[0];
      assert.equal(end.trusted, true); assert.equal(result.stops.length, 0);
      const elapsed = end.time - result.starts[0].args[0];
      assert(elapsed >= result.duration - .05 && elapsed < result.duration + .75, `Audio clock duration ${elapsed}`);
      assert(end.wall - result.starts[0].wall >= (result.duration - .1) * 1000, 'No accelerated or simulated natural end');
      assert(result.disconnected);
      assert.deepEqual(ended.state.selected, ['oren']); assert.deepEqual(ended.state.playing, ['oren']);
      assert.deepEqual(ended.state.pending, []); assert.deepEqual(ended.state.errors, []);
      assert.deepEqual(ended.events.at(-1).state.selected, ['oren']);
      assert.equal(ended.sources[0].starts.length, 1); assert.equal(ended.sources[0].stops.length, 0);
      assert.equal(ended.sources[0].ends.length, 0); assert.equal(ended.sources[0].disconnected, false);
      assert.equal(ended.sources.length, 2);
    });
    report.orenAfterBlackPeak = await page.evaluate(() => probe.peak());
    assert(report.orenAfterBlackPeak > .0001, 'Oren still produces real samples after Black finishes');
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await MoonAudio.setMusicSelection(['oren', 'black']); });
    const stale = await snapshot('unchanged-stale-selection');
    check('Unchanged stale selection cannot repeat Black', () => {
      assert.equal(stale.sources.length, 2); assert.deepEqual(stale.state.selected, ['oren']);
    });
    await page.evaluate(async () => {
      await MoonAudio.setMusicSelection(['oren']);
      await MoonAudio.setMusicSelection(['oren', 'black']);
    });
    const replay = await snapshot('explicit-replay-queued');
    check('Explicit omit/reselect replays Black at next bar from zero and retains Oren', () => {
      const next = replay.sources[2];
      assert.equal(replay.sources.length, 3); assert.equal(next.id, 'black'); assert.equal(next.loop, false);
      assert.equal(next.starts[0].args[1], 0); assert.equal(next.duration, black.duration);
      const expected = oren.starts[0].args[0] + Math.ceil((next.starts[0].time + .08 - oren.starts[0].args[0]) / 2.4) * 2.4;
      assert(Math.abs(next.starts[0].args[0] - expected) < 1e-6);
      assert.equal(replay.sources[0].starts.length, 1); assert.equal(replay.sources[0].stops.length, 0);
    });
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('black'));
    await page.evaluate(() => { probe.lateEnd = probe.sources[2].node.onended; MoonAudio.suspend(); });
    await page.waitForFunction(() => MoonAudio.getContext().state === 'suspended');
    await page.evaluate(() => {
      // Deterministic stale delivery; native-ended timing after suspend is browser-dependent.
      probe.lateEnd(); probe.sources[1].node.onended();
    });
    const muted = await snapshot('muted-with-injected-late-end');
    check('Mute disconnects voices; injected late ends cannot resurrect selected or playing state', () => {
      assert.equal(muted.contextState, 'suspended'); assert.equal(muted.sources.length, 3);
      assert.deepEqual(muted.state.selected, []); assert.deepEqual(muted.state.playing, []); assert.deepEqual(muted.state.pending, []);
      assert(muted.sources.every(record => record.disconnected));
      assert(muted.sources[2].stops.length > 0 && muted.sources[0].stops.length > 0);
    });
    // Resume only the clock, not selection, to let any genuine stop-ended events drain.
    await page.evaluate(() => MoonAudio.unlock());
    await page.waitForFunction(() => probe.sources[2].ends.some(event => event.trusted));
    const drained = await snapshot('native-stopped-end-drained');
    check('Native delayed stop-end after resume does not restart music', () => {
      assert.equal(drained.sources.length, 3); assert.deepEqual(drained.state.selected, []); assert.deepEqual(drained.state.playing, []);
    });
    await page.evaluate(() => MoonAudio.setMusicSelection(['oren', 'black']));
    await page.evaluate(() => probe.lateEnd());
    const replacement = await snapshot('new-session-survives-old-end');
    check('Explicit new session survives a stale callback from the muted Black', () => {
      assert.equal(replacement.sources.length, 5); assert.deepEqual(replacement.state.selected, ['oren', 'black']);
      assert.equal(replacement.sources[4].stops.length, 0);
      assert.deepEqual(replacement.errors, []); assert.deepEqual(report.pageErrors || [], []);
    });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error);
    if (page) { try { await snapshot('failure'); } catch (_) {} }
    throw error;
  } finally {
    if (page) { try { await page.evaluate(() => MoonAudio.dispose()); } catch (_) {} }
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    report.finishedAt = new Date().toISOString(); report.finalSourceHashes = hashes();
    report.sourcesChangedDuringRun = tracked.filter(file => report.sourceHashes[file] !== report.finalSourceHashes[file]);
    if (report.sourcesChangedDuringRun.length) { report.status = 'failed'; process.exitCode = 1; }
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status.toUpperCase()}: ${report.checks.length} checks. Report: ${path.join(reportDir, 'report.json')}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
