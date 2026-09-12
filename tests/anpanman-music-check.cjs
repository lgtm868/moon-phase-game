'use strict';

// Native Chrome decoding and real audio-clock scheduling; no human audition.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const ids = ['anpanman', 'baikinman', 'dokinchan', 'shokupanman', 'currypanman', 'melonpanna', 'rollpanna', 'creampanda', 'jamojisan', 'batakosan'];
const canon = ['oren', 'raddy', 'clukr', 'funbot', 'vineria', 'gray', 'brud', 'garnold', 'owakcx', 'sky', 'mrsun', 'durple', 'mrtree', 'simon', 'tunner', 'mrfun', 'wenda', 'pinki', 'jevin', 'black'];
const digest = data => createHash('sha256').update(data).digest('hex');
const pcmHash = track => digest(Buffer.concat(track.data.map(channel => Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength))));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function checkPCM() {
  const { renderTracks } = require('../tools/anpanman-score.cjs');
  const first = renderTracks(), second = renderTracks();
  assert.deepEqual(first.map(t => t.id).sort(), [...ids].sort());
  assert.deepEqual(second.map(t => t.id), first.map(t => t.id));
  const metrics = first.map((track, i) => {
    assert.equal(track.rate, 48000, track.id);
    assert.equal(track.data.length, 2, track.id + ': stereo instrumental');
    for (const channel of track.data) {
      assert.ok(channel instanceof Float32Array);
      assert.equal(channel.length, 230400);
    }
    assert.equal(pcmHash(track), pcmHash(second[i]), track.id + ': deterministic PCM');
    assert.equal(track.title, second[i].title);
    assert.equal(track.instrument, second[i].instrument);
    assert.equal(track.gain, second[i].gain);
    assert.ok(typeof track.title === 'string' && track.title.trim());
    assert.ok(typeof track.instrument === 'string' && track.instrument.trim());
    assert.ok(Number.isFinite(track.gain) && track.gain > 0 && track.gain <= 2);
    let sum = 0, power = 0, peak = 0;
    for (const channel of track.data) {
      let channelSum = 0;
      for (const sample of channel) {
        assert.ok(Number.isFinite(sample), track.id + ': finite PCM');
        channelSum += sample; sum += sample; power += sample * sample; peak = Math.max(peak, Math.abs(sample));
      }
      assert.ok(Math.abs(channelSum / channel.length) < .001, track.id + ': channel DC');
    }
    const mean = sum / 460800, rms = Math.sqrt(power / 460800);
    const jump = Math.max(...track.data.map(channel => Math.abs(channel[0] - channel.at(-1))));
    assert.ok(peak < 1, track.id + ': no clipping');
    assert.ok(jump <= 1 / 32768, track.id + ': continuous loop endpoint');
    assert.ok(Math.abs(mean) < .001, track.id + ': negligible DC');
    assert.ok(rms > .005 && rms < .2, track.id + ': modest nonzero RMS ' + rms);
    assert.ok(rms * track.gain > .005 && rms * track.gain < .12, track.id + ': gain-adjusted RMS');
    assert.ok(peak * track.gain <= .8, track.id + ': gain-adjusted headroom');
    return { id: track.id, sha256: pcmHash(track), mean, rms, peak, jump };
  });
  assert.equal(new Set(metrics.map(t => t.sha256)).size, 10, '10 distinct waveforms');
  const sandbox = { window: {} };
  vm.runInNewContext(read('games-audio-manifest.js'), sandbox);
  const manifest = JSON.parse(JSON.stringify(sandbox.window.MoonAudioManifest));
  assert.equal(manifest.bpm, 100); assert.equal(manifest.beatsPerBar, 4);
  assert.deepEqual(Object.keys(manifest.tracks).sort(), [...canon, ...ids].sort(), '20 canon + 10 original tracks, no MOD audio');
  for (const id of ids) {
    const meta = manifest.tracks[id];
    assert.equal(meta.loopable, true); assert.equal(meta.beats, 8);
    assert.equal(meta.loopStart, 0); assert.equal(meta.loopEnd, 4.8);
    const registrations = [];
    vm.runInNewContext(read(meta.file), { window: { MoonAudio: { registerAsset: (key, asset) => registrations.push({ key, asset }) } } });
    assert.equal(registrations.length, 1); assert.equal(registrations[0].key, id);
    const asset = registrations[0].asset;
    for (const field of ['loopable', 'beats', 'loopStart', 'loopEnd', 'gain']) assert.equal(asset[field], meta[field], id + ': pack ' + field);
    assert.equal(asset.type, 'audio/wav');
  }
  assert.equal(manifest.tracks.black.loopable, false);
  assert.equal(manifest.tracks.black.beats, null);
  console.log('PASS deterministic PCM, 10 distinct loops, endpoint/DC/peak/RMS, 30-track manifest');
  return metrics;
}

function installProbe() {
  const probe = window.__anpan = { sources: [], buffers: {}, errors: [] };
  addEventListener('unhandledrejection', event => probe.errors.push(String(event.reason)));
  const original = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function(...args) {
    const node = original.apply(this, args), record = { node, starts: [], stops: [], ended: [], disconnected: false };
    probe.sources.push(record);
    const start = node.start, stop = node.stop, disconnect = node.disconnect;
    node.start = function(...values) {
      record.starts.push({ args: values, clock: node.context.currentTime });
      return start.apply(node, values);
    };
    node.stop = function(...values) { record.stops.push(values); return stop.apply(node, values); };
    node.disconnect = function(...values) { record.disconnected = true; return disconnect.apply(node, values); };
    node.addEventListener('ended', event => record.ended.push(event.isTrusted));
    return node;
  };
  probe.snapshot = () => ({ state: MoonAudio.getMusicState(), errors: probe.errors,
    sources: probe.sources.map(record => ({
      id: Object.keys(probe.buffers).find(id => probe.buffers[id] === record.node.buffer) || 'unknown',
      loop: record.node.loop, loopStart: record.node.loopStart, loopEnd: record.node.loopEnd,
      rate: record.node.buffer?.sampleRate, frames: record.node.buffer?.length,
      playbackRate: record.node.playbackRate.value, detune: record.node.detune.value,
      starts: record.starts, stops: record.stops, ended: record.ended, disconnected: record.disconnected
    })) });
}

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  page.on('pageerror', error => { page.__errors.push(error.message); });
  page.__errors = [];
  await page.addInitScript(installProbe);
  await page.goto(url);
  await page.locator('#voiceButton').click();
  await page.locator('#tabFriends').click();
  return page;
}
const choice = (page, id) => page.locator('.sprunki-choice').filter({ has: page.locator(`img[src$="/${id}.png"]`) });
const snapshot = page => page.evaluate(() => __anpan.snapshot());

async function checkBrowser(browser, url) {
  const page = await openPage(browser, url);
  try {
    assert.equal((await snapshot(page)).sources.length, 0, 'no autoplay');
    const decoded = await page.evaluate(async ids => {
      return Promise.all([...ids, 'oren', 'black'].map(async id => {
        const { buffer, meta } = await MoonAudio.loadTrack(id);
        __anpan.buffers[id] = buffer;
        let mean = 0, power = 0, peak = 0, jump = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const data = buffer.getChannelData(c);
          let sum = 0;
          for (const sample of data) { sum += sample; power += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
          mean = Math.max(mean, Math.abs(sum / data.length));
          jump = Math.max(jump, Math.abs(data[0] - data.at(-1)));
        }
        return { id, rate: buffer.sampleRate, frames: buffer.length, duration: buffer.duration,
          channels: buffer.numberOfChannels, mean, rms: Math.sqrt(power / (buffer.length * buffer.numberOfChannels)), peak, jump, meta };
      }));
    }, ids);
    for (const t of decoded.filter(t => ids.includes(t.id))) {
      assert.equal(t.rate, 48000); assert.equal(t.frames, 230400); assert.equal(t.duration, 4.8);
      assert.equal(t.channels, 2);
      assert.ok(t.peak < 1 && t.rms > .005 && t.rms < .2 && Math.abs(t.mean) < .001 && t.jump <= 1 / 32768, t.id + ': decoded PCM quality');
    }
    assert.equal((await snapshot(page)).sources.length, 0, 'decoding does not play audio');
    await page.locator('#musicButton').click();
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('oren'));
    await page.waitForFunction(() => MoonAudio.now() > __anpan.sources[0].starts[0].args[0] + .2);
    // One UI event batch isolates a single selection generation and shared bar.
    await page.evaluate(ids => {
      for (const id of ids) document.querySelector(`.sprunki-choice img[src$="/${id}.png"]`).parentElement.click();
    }, ids);
    await page.waitForFunction(() => __anpan.sources.length === 11);
    const joined = await snapshot(page), epoch = joined.sources[0].starts[0].args[0];
    const loops = joined.sources.filter(s => ids.includes(s.id));
    assert.equal(loops.length, 10);
    assert.equal(new Set(loops.map(s => s.starts[0].args[0])).size, 1, 'all 10 join the same next bar');
    for (const source of loops) {
      assert.equal(source.loop, true); assert.equal(source.loopStart, 0); assert.equal(source.loopEnd, 4.8);
      assert.equal(source.rate, 48000); assert.equal(source.frames, 230400);
      assert.equal(source.playbackRate, 1); assert.equal(source.detune, 0);
      const start = source.starts[0], expected = epoch + Math.ceil((start.clock + .08 - epoch) / 2.4) * 2.4;
      assert.ok(Math.abs(start.args[0] - expected) < 1e-6, source.id + ': next bar on existing epoch');
      assert.ok(start.args[0] > start.clock);
      assert.ok(Math.abs(start.args[1] - ((start.args[0] - epoch) % 4.8 + 4.8) % 4.8) < 1e-6, source.id + ': shared phrase phase');
      assert.equal(start.args.length, 2);
    }
    await page.waitForFunction(ids => ids.every(id => MoonAudio.getMusicState().playing.includes(id)), ids);
    assert.deepEqual((await snapshot(page)).state.errors, []);
    assert.equal(await page.locator('.sprunki-choice[data-mod="true"]').count(), 5);
    await page.locator('.sprunki-choice[data-mod="true"]').evaluateAll(buttons => buttons.forEach(button => button.click()));
    await page.waitForTimeout(100);
    assert.equal((await snapshot(page)).sources.length, 11, 'MOD choices remain silent');
    await choice(page, ids[0]).click();
    await page.waitForTimeout(100);
    const removed = await snapshot(page);
    assert.ok(!removed.state.selected.includes(ids[0]));
    assert.ok(removed.sources.find(s => s.id === ids[0]).disconnected, 'deselected voice disconnected');
    await page.locator('.sprunki-choice').nth(19).click();
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('black'));
    const black = (await snapshot(page)).sources.find(s => s.id === 'black');
    assert.equal(black.loop, false); assert.equal(black.playbackRate, 1); assert.equal(black.detune, 0);
    assert.equal(black.starts[0].args[1], 0); assert.equal(black.starts[0].args.length, 2);
    await page.waitForFunction(() => __anpan.sources.some(s => s.node.buffer === __anpan.buffers.black && s.ended.includes(true)), null, { timeout: 25000 });
    const ended = await snapshot(page);
    assert.equal(ended.sources.find(s => s.id === 'black').stops.length, 0, 'Black ends naturally');
    assert.ok(!ended.state.selected.includes('black'));
    assert.equal(ended.state.playing.length, 10, 'Oren and nine Anpan loops survive Black end');
    assert.equal(ended.sources.length, 12);
    assert.ok(ended.sources.filter(s => s.loop && s.id !== ids[0]).every(s => s.stops.length === 0), 'peers never restarted');
    await page.locator('.sprunki-choice[data-mod="true"]').first().click();
    await page.waitForTimeout(200);
    assert.equal((await snapshot(page)).sources.length, 12, 'stale UI selection cannot replay Black');
    await page.locator('#musicButton').click();
    await page.waitForTimeout(2700);
    const muted = await snapshot(page);
    assert.deepEqual(muted.state, { selected: [], playing: [], pending: [], errors: [] });
    assert.equal(muted.sources.length, 12, 'music off cannot resurrect at next bar');
    assert.ok(muted.sources.every(s => s.disconnected));
    assert.deepEqual(muted.errors, []); assert.deepEqual(page.__errors, []);
    console.log('PASS native 48kHz decode, 10 UI-selected loops on shared epoch, silent MOD, deselection, mute, natural Black one-shot');
  } finally { await page.close(); }
}

async function checkPendingCancellation(browser, url, reason) {
  const page = await openPage(browser, url);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requested = false;
  await page.route(url => url.pathname.endsWith('/sounds/packed/anpanman.js'), async route => { requested = true; await gate; await route.continue(); });
  try {
    await page.locator('#musicButton').click();
    await page.waitForFunction(() => MoonAudio.getMusicState().playing.includes('oren'));
    await choice(page, 'anpanman').click();
    await page.waitForFunction(() => MoonAudio.getMusicState().pending.includes('anpanman'));
    for (let i = 0; !requested && i < 100; i++) await page.waitForTimeout(20);
    assert.ok(requested, 'pending asset request must actually be held');
    if (reason === 'deselect') await choice(page, 'anpanman').click();
    else if (reason === 'mute') await page.locator('#musicButton').click();
    else await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    release();
    await page.evaluate(() => MoonAudio.loadTrack('anpanman'));
    if (reason === 'hidden') await page.evaluate(() => {
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await page.waitForTimeout(2700);
    const result = await snapshot(page);
    assert.equal(result.sources.length, 1, reason + ': late asset completion cannot create a source');
    assert.deepEqual(result.state.selected, reason === 'deselect' ? ['oren'] : []);
    assert.deepEqual(result.state.playing, reason === 'deselect' ? ['oren'] : []);
    assert.deepEqual(result.state.pending, []); assert.deepEqual(result.state.errors, []);
    assert.deepEqual(result.errors, []); assert.deepEqual(page.__errors, []);
    if (reason !== 'deselect') assert.equal(await page.locator('#musicButton').getAttribute('aria-pressed'), 'false');
    console.log('PASS pending decode cancellation: ' + reason + ', no resurrection after next bar');
  } finally { release(); await page.close(); }
}

async function main() {
  checkPCM();
  const { chromium } = require(process.env.AUDIO_PLAYWRIGHT || process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'node_modules/playwright'));
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(target, (error, body) => {
      if (error) return res.writeHead(404).end();
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' }[path.extname(target)];
      res.setHeader('Content-Type', type || 'application/octet-stream'); res.end(body);
    });
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const executablePath = process.env.AUDIO_BROWSER || process.env.CHROME_EXECUTABLE;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'chrome' }) });
    const url = `http://127.0.0.1:${server.address().port}/moon-phase-game.html?standalone=1`;
    await checkBrowser(browser, url);
    for (const reason of ['deselect', 'mute', 'hidden']) await checkPendingCancellation(browser, url, reason);
    console.log('PASS Anpanman music regression (no audition or publication)');
  } finally {
    await browser?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkPCM, checkBrowser, checkPendingCancellation };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
