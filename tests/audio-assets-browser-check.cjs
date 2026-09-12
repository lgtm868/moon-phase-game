'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { root } = require('../tools/build-audio-assets.cjs');
const originalIds = 'oren raddy clukr funbot vineria gray brud garnold owakcx sky mrsun durple mrtree simon tunner mrfun wenda pinki jevin black'.split(' ');
const anpanIds = 'anpanman baikinman dokinchan shokupanman currypanman melonpanna rollpanna creampanda jamojisan batakosan'.split(' ');
const ids = [...originalIds, ...anpanIds];

async function main() {
  const playwright = require(process.env.AUDIO_PLAYWRIGHT || 'playwright');
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.AUDIO_BROWSER ? { executablePath: process.env.AUDIO_BROWSER } : { channel: 'msedge' }) });
  const allowed = new Set(['/tests/audio-assets-fixture.html', '/games-audio-manifest.js', ...ids.map(id => `/sounds/packed/${id}.js`)]);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!allowed.has(pathname)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html' : 'application/javascript');
    res.end(fs.readFileSync(path.join(root, pathname.slice(1))));
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const url of [pathToFileURL(path.join(root, 'tests/audio-assets-fixture.html')).href, `http://127.0.0.1:${server.address().port}/tests/audio-assets-fixture.html`]) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      const result = await page.evaluate(async () => {
        const results = [];
        for (const [id, entry] of Object.entries(window.MoonAudioManifest.tracks)) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL('../' + entry.file, location.href).href;
            script.onload = resolve; script.onerror = () => reject(new Error('Pack failed: ' + id));
            document.head.append(script);
          });
          const call = window.assetCalls.at(-1), asset = call.asset;
          for (const key of ['title', 'instrument', 'provenance']) {
            if (asset[key] !== entry[key]) throw Error(id + ': metadata mismatch: ' + key);
          }
          const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
          const decoder = new OfflineAudioContext(2, 1, 48000);
          const buffer = await decoder.decodeAudioData(bytes.buffer.slice(0));
          if (!asset.loopable) {
            const rendering = new OfflineAudioContext(buffer.numberOfChannels, 96000, 48000);
            const source = rendering.createBufferSource(); source.buffer = buffer;
            const gain = rendering.createGain(); gain.gain.value = asset.gain;
            source.connect(gain).connect(rendering.destination); source.start(0); source.stop(.8);
            const output = (await rendering.startRendering()).getChannelData(0);
            let peak = 0, afterStop = 0;
            for (let i = 0; i < output.length; i++) {
              peak = Math.max(peak, Math.abs(output[i]));
              if (i >= 40000) afterStop = Math.max(afterStop, Math.abs(output[i]));
            }
            results.push({ id, registeredId: call.id, previewOnly: true, frames: buffer.length, duration: buffer.duration, loopable: asset.loopable, beats: asset.beats, peak, afterStop, metadataMatch: ['loopable', 'beats', 'loopStart', 'loopEnd', 'gain'].every(k => asset[k] === entry[k]) });
            continue;
          }
          const rendering = new OfflineAudioContext(buffer.numberOfChannels, 3 * buffer.length, 48000);
          const source = rendering.createBufferSource(); source.buffer = buffer;
          source.loop = true; source.loopStart = asset.loopStart; source.loopEnd = asset.loopEnd;
          source.connect(rendering.destination); source.start(0);
          const rendered = await rendering.startRendering();
          let repeatError = 0, peak = 0;
          for (let c = 0; c < rendered.numberOfChannels; c++) {
            const data = rendered.getChannelData(c);
            for (let i = 0; i < buffer.length; i++) {
              repeatError = Math.max(repeatError, Math.abs(data[i] - data[i + buffer.length]), Math.abs(data[i] - data[i + buffer.length * 2]));
              peak = Math.max(peak, Math.abs(data[i]));
            }
          }
          const context441 = new OfflineAudioContext(2, 1, 44100);
          const buffer441 = await context441.decodeAudioData(bytes.buffer.slice(0));
          // Keep the asset at 48 kHz; let the output renderer resample its loop.
          // Direct decode into a 44.1 kHz context can truncate a frame in Chromium.
          const render441 = new OfflineAudioContext(buffer.numberOfChannels, 211680 * 3, 44100);
          const source441 = render441.createBufferSource(); source441.buffer = buffer;
          source441.loop = true; source441.loopStart = 0; source441.loopEnd = 4.8;
          source441.connect(render441.destination); source441.start(0);
          const output441 = await render441.startRendering();
          let repeatError441 = 0;
          for (let c = 0; c < output441.numberOfChannels; c++) {
            const data = output441.getChannelData(c);
            // Skip filter startup, compare full second/third periods instead.
            for (let i = 0; i < 211680; i++) repeatError441 = Math.max(repeatError441, Math.abs(data[i + 211680] - data[i + 423360]));
          }
          results.push({ id, registeredId: call.id, frames: buffer.length, frames441: buffer441.length, channels: buffer.numberOfChannels, repeatError, repeatError441, peak, metadataMatch: ['loopable', 'beats', 'loopStart', 'loopEnd', 'gain'].every(k => asset[k] === entry[k]) });
        }
        return { results, calls: window.assetCalls.length };
      });
      assert.deepEqual(errors, []); assert.equal(result.calls, 30);
      assert.deepEqual(result.results.map(row => row.id), ids, 'Decode every canonical and generated track, no extras');
      for (const row of result.results) {
        assert.equal(row.id, row.registeredId); assert(row.metadataMatch);
        if (anpanIds.includes(row.id)) assert.equal(row.channels, 2, row.id + ': generated stereo retained');
        if (row.previewOnly) {
          assert.equal(row.id, 'black'); assert.equal(row.loopable, false); assert.equal(row.beats, null);
          assert.equal(row.frames, 838147); assert.equal(row.duration, 838147 / 48000);
          assert(row.peak > 0 && row.peak < .17); assert.equal(row.afterStop, 0);
          continue;
        }
        assert.equal(row.frames, 230400);
        assert([211679, 211680].includes(row.frames441), 'Record known direct-decode resampling rounding, not the recommended path');
        assert(row.peak > 0 && row.peak < 1); assert(row.repeatError < 1e-6, `${row.id}: repeat error ${row.repeatError}`);
        assert(row.repeatError441 < 1e-5, `${row.id}: device-rate loop error ${row.repeatError441}`);
      }
      const loops = result.results.filter(r => !r.previewOnly);
      assert.equal(loops.filter(row => anpanIds.includes(row.id)).length, 10);
      console.log(`PASS ${new URL(url).protocol}: 30 dynamic classic scripts; Black MP3 preview stops without looping; 29 loops with 230400-frame decode; 48 kHz loop error ${Math.max(...loops.map(r => r.repeatError))}; 44.1 kHz output loop error ${Math.max(...loops.map(r => r.repeatError441))}.`);
      console.log(`Direct device-rate decode lengths: ${[...new Set(loops.map(r => r.frames441))]}; use the documented 48 kHz decode path.`);
      await page.close();
    }
    console.log(`PASS browser ${browser.version()}; no human audition claimed.`);
  } finally {
    await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
